import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// Ingest for live machine data.
//
// A small poller on the plant floor reads a machine over Modbus TCP and POSTs here.
// Nothing in the plant is reachable from the internet: the poller makes an outbound
// call to this endpoint and that is the only direction data ever travels.
//
// Shape of a request:
//   POST /api/machines/readings
//   x-machine-token: <MACHINE_INGEST_TOKEN>
//   { "machine_code": "WRP-SFK",
//     "readings": [ { "recorded_at": "2026-10-16T18:00:00Z", "counter_total": 1324 } ] }
//
// A single reading may also be sent on its own, without the array.

type Incoming = {
  recorded_at?: string
  counter_total?: number | null
  state?: string | null
  speed?: number | null
  alarm_code?: string | null
  raw?: unknown
  source?: string | null
}

// Statuses the machines board already uses. Maintenance is a human decision and is
// never overwritten by a reading: somebody took the machine out of service on purpose.
const STATUS_RUNNING = 'Running'
const STATUS_IDLE = 'Idle'
const STATUS_DOWN = 'Down'
const STATUS_MAINTENANCE = 'Maintenance'

function sameToken(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  const expected = process.env.MACHINE_INGEST_TOKEN || ''
  if (!expected) {
    return NextResponse.json(
      { error: 'Machine ingest is not configured on the server yet. MACHINE_INGEST_TOKEN is not set.' },
      { status: 503 }
    )
  }

  const presented =
    req.headers.get('x-machine-token') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!presented || !sameToken(presented, expected)) {
    return NextResponse.json({ error: 'Not authorized to post machine readings.' }, { status: 401 })
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is missing its database credentials.' }, { status: 503 })
  }
  const sb = createSupabaseAdminClient()

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body was not valid JSON.' }, { status: 400 })
  }

  const list: Incoming[] = Array.isArray(body?.readings)
    ? body.readings
    : Array.isArray(body)
    ? body
    : [body]
  if (!list.length) {
    return NextResponse.json({ error: 'No readings in the request.' }, { status: 400 })
  }
  if (list.length > 500) {
    return NextResponse.json({ error: 'Too many readings in one request. Send 500 or fewer.' }, { status: 400 })
  }

  // Find the machine, by id or by the code printed on the board.
  const machineId: string | null = body?.machine_id ?? null
  const machineCode: string | null = body?.machine_code ?? null
  if (!machineId && !machineCode) {
    return NextResponse.json({ error: 'Give either machine_id or machine_code.' }, { status: 400 })
  }
  const q = sb.from('machines').select('id, name, machine_code, status, telemetry_enabled').limit(2)
  const { data: machines, error: mErr } = machineId
    ? await q.eq('id', machineId)
    : await q.eq('machine_code', machineCode as string)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
  if (!machines?.length) {
    return NextResponse.json(
      { error: 'No machine matches ' + (machineId || machineCode) + '.' },
      { status: 404 }
    )
  }
  if (machines.length > 1) {
    return NextResponse.json(
      { error: 'More than one machine carries the code ' + machineCode + '. Give machine_id instead.' },
      { status: 409 }
    )
  }
  const machine = machines[0] as any

  // Normalize and sort oldest first, so the running counter can be walked in order.
  const rows: { recorded_at: string; r: Incoming }[] = []
  for (const r of list) {
    const t = r?.recorded_at ? new Date(r.recorded_at) : null
    if (!t || Number.isNaN(t.getTime())) {
      return NextResponse.json({ error: 'A reading is missing a valid recorded_at.' }, { status: 400 })
    }
    rows.push({ recorded_at: t.toISOString(), r })
  }
  rows.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))

  // The last counter we already hold from before this batch. produced_delta is worked out
  // here rather than at read time, because subtracting running totals later goes wrong the
  // moment one sample is missing.
  const { data: prevRows, error: pErr } = await sb
    .from('machine_readings')
    .select('counter_total, recorded_at')
    .eq('machine_id', machine.id)
    .lt('recorded_at', rows[0].recorded_at)
    .not('counter_total', 'is', null)
    .order('recorded_at', { ascending: false })
    .limit(1)
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  let prev: number | null = prevRows?.length ? Number(prevRows[0].counter_total) : null

  let resets = 0
  const toWrite = rows.map(({ recorded_at, r }) => {
    const counter = num(r.counter_total)
    let delta: number | null = null
    let reset = false
    if (counter !== null) {
      if (prev === null) {
        // First reading we have ever held for this machine. We know the total but not how
        // much of it was made since the last sample, so the delta stays empty rather than
        // crediting the whole lifetime count to this minute.
        delta = null
      } else if (counter >= prev) {
        delta = counter - prev
      } else {
        // The counter went backwards, so the PLC was reset or rolled over. Count only from
        // zero to the new value; anything made between the last sample and the reset is lost.
        reset = true
        resets++
        delta = counter
      }
      prev = counter
    }
    return {
      machine_id: machine.id,
      recorded_at,
      counter_total: counter,
      produced_delta: delta,
      counter_reset: reset,
      state: r.state ?? null,
      speed: num(r.speed),
      alarm_code: r.alarm_code ?? null,
      raw: r.raw ?? null,
      source: r.source || 'modbus-tcp',
    }
  })

  const { error: wErr } = await sb
    .from('machine_readings')
    .upsert(toWrite, { onConflict: 'machine_id,recorded_at' })
  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })

  // Keep the board in step with the floor, but only for a machine somebody has switched
  // telemetry on for, so a hand-typed status is never overwritten by accident.
  const last = toWrite[toWrite.length - 1]
  let newStatus: string | null = null
  if (machine.telemetry_enabled) {
    if (machine.status === STATUS_MAINTENANCE) {
      newStatus = null
    } else if (last.alarm_code) {
      newStatus = STATUS_DOWN
    } else if (last.state) {
      const s = String(last.state).toLowerCase()
      newStatus = s.startsWith('run') ? STATUS_RUNNING : s.startsWith('alarm') || s.startsWith('down') || s.startsWith('fault') ? STATUS_DOWN : STATUS_IDLE
    } else if (last.produced_delta !== null) {
      newStatus = last.produced_delta > 0 ? STATUS_RUNNING : STATUS_IDLE
    }
  }
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
  if (newStatus && newStatus !== machine.status) patch.status = newStatus
  const { error: uErr } = await sb.from('machines').update(patch).eq('id', machine.id)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    machine: machine.machine_code || machine.name,
    stored: toWrite.length,
    counter_total: last.counter_total,
    produced_delta: last.produced_delta,
    counter_resets: resets,
    status: (patch.status as string) || machine.status,
  })
}
