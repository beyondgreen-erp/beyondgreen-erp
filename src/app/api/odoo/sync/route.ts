/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/odoo/sync  — daily job (Vercel cron, see vercel.json) for the Civil Doody Odoo link.
 * For each database (testing, live): pull open delivery orders, resend any shipment Odoo has not
 * accepted (live resends stay off while live writes are off), and save a report row.
 * When the report email is switched on (odoo_sync_settings), the report for the chosen database is
 * emailed once per day to the customer with Rudy on cc.
 *   ?preview=1   signed-in staff only: email the report to yourself and nobody else.
 * Safe to run any number of times. The cron has no staff session, so an unauthenticated call can
 * only do the idempotent sync; the once-a-day rule keeps it from ever mailing the customer twice.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { odooInfo, type OdooTarget } from '@/lib/odoo'
import { runOdooSync, sendReport } from '@/lib/odooSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function staffEmail(): Promise<string | null> {
  try {
    const sb = await createSupabaseServerClient()
    const { data } = await sb.auth.getUser()
    const e = (data.user?.email || '').toLowerCase()
    return /@(beyondgreenbiotech\.com|byndgrn\.com)$/.test(e) ? e : null
  } catch { return null }
}
function isCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (secret) return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') === secret || req.headers.get('x-cron-secret') === secret
  return (req.headers.get('user-agent') || '').toLowerCase().includes('vercel-cron')
}

export async function GET(req: NextRequest) {
  const staff = await staffEmail()
  if (!staff && !isCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const preview = req.nextUrl.searchParams.get('preview') === '1'
  if (preview && !staff) return NextResponse.json({ error: 'Sign in to send a preview' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const { data: settings } = await admin.from('odoo_sync_settings').select('*').eq('id', 1).maybeSingle()
  const out: any = { ok: true, targets: {} }
  for (const target of ['test', 'live'] as OdooTarget[]) {
    if (!odooInfo(target).hasKey) { out.targets[target] = { skipped: 'no API key set' }; continue }
    try {
      const run = await runOdooSync(admin, target, staff ? 'manual' : 'daily')
      const r: any = { pulled: run.pulled, new_orders: run.new_orders.length, shipments: run.shipments.length, problems: run.problems.length }
      if (settings && target === settings.report_target) {
        if (preview) {
          const res = await sendReport(admin, run, [staff!], [], { preview: true })
          r.email = res.ok ? `preview sent to ${staff}` : `preview failed: ${res.error}`
        } else if (settings.report_enabled) {
          // One customer email per database per day (Pacific time), no matter how often this runs.
          const { data: mailed } = await admin.from('odoo_sync_runs').select('emailed_at').eq('target', target).not('emailed_at', 'is', null).order('emailed_at', { ascending: false }).limit(1).maybeSingle()
          const pt = (d: string | Date) => new Date(d).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })
          if (mailed?.emailed_at && pt(mailed.emailed_at) === pt(new Date())) r.email = 'already sent today'
          else {
            const split = (s: string) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
            const res = await sendReport(admin, run, split(settings.report_to), split(settings.report_cc))
            r.email = res.ok ? 'sent' : `failed: ${res.error}`
          }
        } else r.email = 'report email is switched off'
      }
      out.targets[target] = r
    } catch (e: any) { out.targets[target] = { error: e?.message || String(e) } }
  }
  return NextResponse.json(out)
}
