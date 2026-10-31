'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'

interface Machine { id: string; name: string; machine_code: string; status: string; location: string | null; notes: string | null; is_active: boolean;
  make: string | null; model: string | null; description: string | null; serial_number: string | null; equipment_type: string | null; equipment_group: string | null }
interface OpenWo { wo_number: number; status: string; machine_id: string; scheduled_hours: number | null; qty_required: number | null; qty_produced: number | null; item_part_number: string | null; group_name: string | null; customer: string | null }

// Machine states. Running pulses green, Paused blinks amber, everything else (Idle, Down, Maintenance) is red.
const STATE = {
  Running: { label: 'Running', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', dot: 'bg-emerald-500 animate-pulse', glow: 'run-glow', color: '#1E9E6A' },
  Paused: { label: 'Paused', text: 'text-amber-800', bg: 'bg-amber-50', border: 'border-amber-300', dot: 'bg-amber-500 blink', glow: 'pause-blink', color: '#E0A21B' },
  Off: { label: 'Off / down', text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', dot: 'bg-red-500', glow: 'off-glow', color: '#E5231B' },
} as const
type StateKey = keyof typeof STATE
function stateOf(status: string): StateKey { return status === 'Running' ? 'Running' : status === 'Paused' ? 'Paused' : 'Off' }

// Production boards. Each board draws from one machine section.
const SECTIONS = [
  { key: 'cut', name: 'Cutlery Molding', flow: 'Injection molding, then kitting or secondary', board: 'walmart',
    match: (m: Machine) => m.equipment_group === 'MOLDING' && !m.machine_code.startsWith('MLD') },
  { key: 'pla', name: 'PLA Injection Molding', flow: 'Molded parts, then secondary operations', board: null as string | null,
    match: (m: Machine) => m.machine_code.startsWith('MLD') },
  { key: 'straw', name: 'Straw Extrusion', flow: 'Extrusion, then wrapper or crimping', board: 'straw',
    match: (m: Machine) => m.equipment_group === 'STRAWS' },
  { key: 'bag', name: 'Bag Extrusion', flow: 'Blown film, then bag conversion', board: null as string | null,
    match: (m: Machine) => m.equipment_group === 'EXTRUDER' || m.equipment_group === 'CONVERSION' },
]
const BOARDS = [
  { key: 'all', label: 'All production boards' },
  { key: 'walmart', label: 'Walmart Production' },
  { key: 'straw', label: 'Straw Production' },
]
const CAPACITY_HOURS = 22
const CLOSED = ['Complete', 'QC Passed', 'Cancelled']

// Icon artwork for each machine type (64 x 48 viewBox).
const ICONS: Record<string, string> = {
  inj: '<rect x="2" y="36" width="60" height="8" rx="2"/><rect x="5" y="40" width="4" height="8"/><rect x="55" y="40" width="4" height="8"/><rect x="5" y="18" width="5" height="18" rx="1"/><rect x="12" y="20" width="12" height="16" rx="1"/><rect x="24" y="23" width="32" height="9" rx="4"/><path d="M40 4h14l-5 13h-4z"/><rect x="45" y="17" width="4" height="7"/><rect x="56" y="22" width="6" height="12" rx="1"/>',
  blown: '<rect x="14" y="2" width="40" height="3" rx="1"/><rect x="14" y="2" width="3" height="40"/><rect x="51" y="2" width="3" height="40"/><path d="M28 30 C24 20 26 9 34 6 C42 9 44 20 40 30z"/><rect x="27" y="30" width="14" height="6" rx="1"/><rect x="2" y="32" width="26" height="6" rx="3"/><rect x="10" y="42" width="48" height="5" rx="1"/>',
  conv: '<circle cx="12" cy="20" r="10"/><rect x="2" y="31" width="60" height="6" rx="1"/><rect x="5" y="37" width="4" height="10"/><rect x="55" y="37" width="4" height="10"/><rect x="30" y="12" width="14" height="19" rx="2"/><rect x="48" y="24" width="14" height="3" rx="1"/><rect x="48" y="28" width="14" height="3" rx="1"/>',
  straw: '<path d="M6 2h13l-5 12h-3z"/><rect x="2" y="15" width="28" height="10" rx="4"/><rect x="30" y="13" width="6" height="14" rx="1"/><rect x="36" y="19" width="26" height="3"/><rect x="2" y="36" width="60" height="7" rx="2"/><rect x="5" y="43" width="4" height="5"/><rect x="55" y="43" width="4" height="5"/>',
  wrap: '<rect x="16" y="8" width="32" height="22" rx="3"/><rect x="24" y="2" width="16" height="6" rx="1"/><rect x="2" y="30" width="60" height="5" rx="2"/><circle cx="6" cy="32.5" r="3"/><circle cx="58" cy="32.5" r="3"/><rect x="8" y="38" width="48" height="6" rx="1"/><rect x="10" y="44" width="4" height="4"/><rect x="50" y="44" width="4" height="4"/>',
  bend: '<circle cx="34" cy="18" r="14"/><rect x="2" y="16" width="18" height="4" rx="1"/><rect x="2" y="22" width="18" height="4" rx="1"/><rect x="48" y="12" width="14" height="4" rx="1"/><rect x="48" y="20" width="14" height="4" rx="1"/><rect x="4" y="34" width="56" height="8" rx="2"/><rect x="8" y="42" width="4" height="6"/><rect x="52" y="42" width="4" height="6"/>',
}
function kindOf(m: Machine): string {
  const c = m.machine_code.toUpperCase()
  if (c.startsWith('STR-EXT')) return 'straw'
  if (c.startsWith('WRP')) return 'wrap'
  if (c.startsWith('BEDR')) return 'bend'
  if (m.equipment_group === 'CONVERSION') return 'conv'
  if (m.equipment_group === 'EXTRUDER') return 'blown'
  return 'inj'
}

function MachineIcon({ kind, pct, color, size = 52 }: { kind: string; pct: number; color: string; size?: number }) {
  const h = Math.round(size * 0.75)
  const svg = (fill: string) => (
    <svg width={size} height={h} viewBox="0 0 64 48" fill={fill} aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0 }} dangerouslySetInnerHTML={{ __html: ICONS[kind] || ICONS.inj }} />
  )
  return (
    <div style={{ position: 'relative', width: size, height: h }}>
      {svg('#C3CEC6')}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct}%`, overflow: 'hidden', transition: 'height .6s ease' }}>
        <svg width={size} height={h} viewBox="0 0 64 48" fill={color} aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0 }} dangerouslySetInnerHTML={{ __html: ICONS[kind] || ICONS.inj }} />
      </div>
    </div>
  )
}

const empty = { name: '', machine_code: '', status: 'Idle', location: '', notes: '',
  make: '', model: '', description: '', serial_number: '', equipment_type: '', equipment_group: '' }
type F = typeof empty
function dbErr(e: { code?: string; message: string; hint?: string }) { console.error(e); return [e.message, e.code && `(${e.code})`, e.hint && `Hint: ${e.hint}`].filter(Boolean).join(' — ') }

export default function MachineStatusPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Machine[]>([])
  const [wos, setWos] = useState<OpenWo[]>([])
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState('all')
  const [selected, setSelected] = useState<Machine | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Machine | null>(null)
  const [form, setForm] = useState<F>(empty)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await sb.from('machines').select('*').order('name')
    if (data) setRows(data as Machine[])
    const { data: w } = await sb.from('work_orders')
      .select('wo_number,status,machine_id,scheduled_hours,qty_required,qty_produced,item_part_number,group_name,sales_orders!work_orders_sales_order_id_fkey(customers(company_name))')
      .not('machine_id', 'is', null)
      .order('created_at', { ascending: false })
    setWos(((w ?? []) as any[]).filter(x => !CLOSED.includes(x.status)).map(x => ({
      wo_number: x.wo_number, status: x.status, machine_id: x.machine_id, scheduled_hours: x.scheduled_hours,
      qty_required: x.qty_required, qty_produced: x.qty_produced, item_part_number: x.item_part_number, group_name: x.group_name,
      customer: x.sales_orders?.customers?.company_name ?? null,
    })))
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line
  useEffect(() => {
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 600) }
    const ch = sb.channel('machine-status-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, bump)
      .subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb]) // eslint-disable-line

  const active = rows.filter(r => r.is_active)
  const woByMachine = useMemo(() => {
    const map: Record<string, OpenWo[]> = {}
    for (const w of wos) (map[w.machine_id] ||= []).push(w)
    return map
  }, [wos])
  const hoursOf = (id: string) => (woByMachine[id] || []).reduce((s, w) => s + (Number(w.scheduled_hours) || 0), 0)

  const shownSections = SECTIONS.filter(s => board === 'all' || s.board === board)
  const counts = { Running: 0, Paused: 0, Off: 0 }
  active.forEach(m => { counts[stateOf(m.status)]++ })
  const totalOpen = wos.length
  const totalBooked = active.reduce((s, m) => s + hoursOf(m.id), 0)

  function openAdd() { setEditing(null); setForm(empty); setErr(''); setOpen(true) }
  function openEdit(r: Machine) {
    setEditing(r)
    setForm({ name: r.name, machine_code: r.machine_code, status: r.status, location: r.location ?? '', notes: r.notes ?? '',
      make: r.make ?? '', model: r.model ?? '', description: r.description ?? '', serial_number: r.serial_number ?? '', equipment_type: r.equipment_type ?? '', equipment_group: r.equipment_group ?? '' })
    setErr(''); setOpen(true)
  }
  function close() { setOpen(false); setTimeout(() => { setEditing(null); setForm(empty) }, 300) }
  useItemDeepLink(rows, openEdit)

  async function setStatus(m: Machine, status: string) {
    const { error } = await sb.from('machines').update({ status, updated_at: new Date().toISOString() }).eq('id', m.id)
    if (error) { alert('Could not update the machine: ' + error.message); return }
    setSelected({ ...m, status }); load()
  }

  async function save() {
    if (!form.name.trim() || !form.machine_code.trim()) { setErr('Machine Name and Code are required.'); return }
    setErr(''); setSaving(true)
    const t = (v: string) => v.trim() || null
    const p = { name: form.name.trim(), machine_code: form.machine_code.trim(), status: form.status, location: t(form.location), notes: t(form.notes),
      make: t(form.make), model: t(form.model), description: t(form.description), serial_number: t(form.serial_number),
      equipment_type: t(form.equipment_type), equipment_group: t(form.equipment_group) }
    const { error } = editing ? await sb.from('machines').update({ ...p, updated_at: new Date().toISOString() }).eq('id', editing.id) : await sb.from('machines').insert({ ...p, is_active: true })
    if (error) { setErr(dbErr(error)); setSaving(false); return }
    setSaving(false); close(); load()
  }
  async function toggleArchive() {
    if (!editing) return
    await sb.from('machines').update({ is_active: !editing.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id)
    close(); load()
  }
  async function handleDelete() {
    if (!editing) return
    if (!confirm('Permanently delete this machine? This cannot be undone.')) return
    const { error } = await sb.from('machines').delete().eq('id', editing.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    close(); load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <style>{`
        @keyframes runGlow{0%,100%{filter:drop-shadow(0 0 0 rgba(30,158,106,0))}50%{filter:drop-shadow(0 0 7px rgba(30,158,106,.95))}}
        @keyframes blinkAmber{0%,100%{opacity:1}50%{opacity:.15}}
        .run-glow{animation:runGlow 1.2s ease-in-out infinite}
        .pause-blink{animation:blinkAmber .9s steps(2,start) infinite}
        .off-glow{filter:drop-shadow(0 0 4px rgba(229,35,27,.95))}
        .blink{animation:blinkAmber .9s steps(2,start) infinite}
      `}</style>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Machine Status</h1>
          <p className="text-gray-500 text-sm mt-0.5">Each machine shows how much of its 22 hour day is booked. Work orders come from the production boards.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="machines" filename="machines" columns={[
            { header: 'Name', dbKey: 'name', example: 'Injection Molder 1', required: true },
            { header: 'Machine Code', dbKey: 'machine_code', example: 'IM-01', required: true },
            { header: 'Status', dbKey: 'status', example: 'Idle' },
            { header: 'Department', dbKey: 'equipment_group', example: 'MOLDING' },
            { header: 'Equipment Type', dbKey: 'equipment_type', example: 'Injection Molding' },
            { header: 'Location', dbKey: 'location', example: 'Bay A' },
            { header: 'Make', dbKey: 'make', example: 'Hwamda' },
            { header: 'Model', dbKey: 'model', example: 'HMD270M8-SPV' },
            { header: 'Serial Number', dbKey: 'serial_number', example: 'WM029AA' },
            { header: 'Description', dbKey: 'description', example: 'Molding M/C' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">Add Machine</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Running</span><p className="text-2xl font-bold text-emerald-600">{counts.Running} / {active.length}</p></div>
        <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Paused</span><p className="text-2xl font-bold text-amber-600">{counts.Paused}</p></div>
        <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Off or down</span><p className="text-2xl font-bold text-red-600">{counts.Off}</p></div>
        <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Open work orders</span><p className="text-2xl font-bold text-[#1A1D2E]">{totalOpen} <span className="text-sm font-medium text-gray-500">· {totalBooked.toFixed(1)} h booked</span></p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-xs font-semibold text-gray-500 mr-1">Show work orders from</span>
        {BOARDS.map(b => (
          <button key={b.key} onClick={() => setBoard(b.key)} aria-pressed={board === b.key}
            className={`text-sm font-medium px-3.5 py-2 rounded-full border transition-colors ${board === b.key ? 'bg-[#13201A] text-white border-[#13201A]' : 'bg-white text-[#1A1D2E] border-[#D5DED7] hover:border-gray-400'}`}>{b.label}</button>
        ))}
      </div>

      {loading ? <div className="py-20 text-center text-sm text-gray-500">Loading…</div> : shownSections.map(section => {
        const machines = active.filter(section.match)
        const booked = machines.reduce((s, m) => s + hoursOf(m.id), 0)
        const total = machines.length * CAPACITY_HOURS
        return (
          <section key={section.key} className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#E4E6EE]">
              <div>
                <h2 className="text-lg font-semibold text-[#1A1D2E]">{section.name}</h2>
                <p className="text-xs text-gray-500">{section.flow}</p>
              </div>
              <p className="text-xs text-gray-600">Open <span className="font-mono font-semibold">{Math.max(0, total - booked).toFixed(1)} h</span> of {total} h</p>
            </div>
            {machines.length === 0 ? <p className="px-5 py-8 text-sm text-gray-500">No machines in this section yet.</p> : (
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {machines.map(m => {
                  const st = STATE[stateOf(m.status)]
                  const h = hoursOf(m.id)
                  const pct = Math.min(100, Math.round(h / CAPACITY_HOURS * 100))
                  const jobs = woByMachine[m.id] || []
                  const barColor = pct >= 90 ? '#E5541B' : pct >= 70 ? '#E0A21B' : '#1E9E6A'
                  return (
                    <button key={m.id} onClick={() => setSelected(m)} aria-label={`Open operator panel for ${m.machine_code}`}
                      className={`text-left rounded-xl border ${st.border} ${st.bg} p-3 flex flex-col gap-2 hover:shadow-md transition-shadow`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-bold text-[#1A1D2E] truncate">{m.machine_code}</span>
                        <span className={`flex items-center gap-1 text-[11px] font-semibold ${st.text}`}><span className={`w-2 h-2 rounded-full ${st.dot}`} />{st.label}</span>
                      </div>
                      <div className="flex items-center justify-center py-1 relative">
                        <div className={st.glow}><MachineIcon kind={kindOf(m)} pct={pct} color={barColor} size={64} /></div>
                        {jobs.length > 0 && <span className="absolute -top-1 right-2 min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#13201A] text-white text-[11px] font-bold flex items-center justify-center font-mono">{jobs.length}</span>}
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-gray-600"><span>{pct}% booked</span><span className="font-mono">{Math.max(0, CAPACITY_HOURS - h).toFixed(1)} h open</span></div>
                        <div className="h-2 rounded-full bg-[#E6ECE7] overflow-hidden mt-1"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} /></div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      {/* Operator panel */}
      {selected && (() => {
        const m = rows.find(r => r.id === selected.id) || selected
        const st = STATE[stateOf(m.status)]
        const jobs = woByMachine[m.id] || []
        const h = hoursOf(m.id)
        return (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setSelected(null)}>
            <aside role="dialog" aria-label="Operator panel" onClick={e => e.stopPropagation()}
              className="w-full max-w-md h-full overflow-y-auto bg-white p-6 flex flex-col gap-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Operator panel · {m.equipment_group || 'Machine'}</p>
                  <h2 className="text-2xl font-bold text-[#1A1D2E] font-mono">{m.machine_code}</h2>
                  <p className="text-sm text-gray-500">{m.equipment_type || m.name}</p>
                </div>
                <button onClick={() => setSelected(null)} aria-label="Close" className="w-10 h-10 rounded-lg border border-[#E4E6EE] text-xl">×</button>
              </div>

              <div className={`rounded-2xl border ${st.border} ${st.bg} p-4 flex items-center gap-4`}>
                <div className={st.glow}><MachineIcon kind={kindOf(m)} pct={Math.min(100, Math.round(h / CAPACITY_HOURS * 100))} color={st.color} size={72} /></div>
                <div>
                  <p className={`text-sm font-bold ${st.text} flex items-center gap-2`}><span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />{st.label}</p>
                  <p className="text-xs text-gray-600 mt-1">{h.toFixed(1)} h booked of {CAPACITY_HOURS} h today</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setStatus(m, 'Running')} disabled={m.status === 'Running'} className="min-h-[56px] rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40">Start</button>
                <button onClick={() => setStatus(m, 'Paused')} disabled={m.status !== 'Running'} className="min-h-[56px] rounded-xl bg-amber-500 text-[#13201A] font-bold disabled:opacity-40">Pause</button>
                <button onClick={() => setStatus(m, 'Idle')} disabled={stateOf(m.status) === 'Off'} className="min-h-[56px] rounded-xl bg-red-600 text-white font-bold disabled:opacity-40">Stop</button>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#1A1D2E] mb-2">Work orders on this machine ({jobs.length})</h3>
                {jobs.length === 0 ? <p className="text-sm text-gray-500">None assigned.</p> : (
                  <ul className="flex flex-col gap-2">
                    {jobs.map(w => (
                      <li key={w.wo_number} className="rounded-lg border border-[#E4E6EE] p-3 text-sm">
                        <div className="flex justify-between gap-2"><span className="font-semibold">WO-{w.wo_number}{w.customer ? ` · ${w.customer}` : ''}</span><span className="text-xs text-gray-500">{w.status}</span></div>
                        <div className="text-xs text-gray-600 mt-1">{w.item_part_number || '—'} · {w.qty_produced ?? 0} of {w.qty_required ?? 0} · {Number(w.scheduled_hours || 0).toFixed(1)} h</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button onClick={() => { setSelected(null); openEdit(m) }} className="mt-auto text-sm font-semibold border border-[#E4E6EE] rounded-lg py-2.5 text-gray-600 hover:text-gray-900">Edit machine details</button>
            </aside>
          </div>
        )
      })()}

      {/* Add / edit machine */}
      <div className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close} />
      <div onClick={e => e.stopPropagation()} className={`fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] md:w-full md:max-w-[560px] max-h-[90vh] bg-white rounded-2xl border border-[#E4E6EE] flex flex-col shadow-2xl overflow-hidden transition-all duration-200 ease-out ${open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0"><h2 className="text-[#1A1D2E] font-semibold">{editing ? 'Edit Machine' : 'Add Machine'}</h2><div className="flex items-center gap-2">{editing && <ShareLink id={editing.id} />}<button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]">×</button></div></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">Machine Name <span className="text-red-400">*</span></label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inp} /></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Machine Code <span className="text-red-400">*</span></label><input value={form.machine_code} onChange={e => setForm(p => ({ ...p, machine_code: e.target.value }))} className={inp} /></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp + ' cursor-pointer'}>{['Running', 'Paused', 'Idle', 'Maintenance', 'Down'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-400 mb-1.5">Department</label><input value={form.equipment_group} onChange={e => setForm(p => ({ ...p, equipment_group: e.target.value }))} placeholder="e.g. MOLDING" className={inp} /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Equipment Type</label><input value={form.equipment_type} onChange={e => setForm(p => ({ ...p, equipment_type: e.target.value }))} placeholder="e.g. Injection Molding" className={inp} /></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Location</label><input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className={inp} /></div>
          <div className="bg-[#F5F6FA] rounded-xl border border-[#E4E6EE] p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Equipment Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-400 mb-1.5">Make</label><input value={form.make} onChange={e => setForm(p => ({ ...p, make: e.target.value }))} placeholder="e.g. Hwamda" className={inp} /></div>
              <div><label className="block text-xs text-gray-400 mb-1.5">Model</label><input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} placeholder="e.g. HMD270M8-SPV" className={inp} /></div>
            </div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Serial Number</label><input value={form.serial_number} onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))} className={inp + ' font-mono'} /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Description</label><input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. 180 TN Molding Machine" className={inp} /></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Notes</label><textarea rows={3} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp + ' resize-none'} /></div>
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err && <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{err}</p>}
          <div className="flex gap-3">
            {editing && <button onClick={handleDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-300 bg-red-50 text-red-600">Delete</button>}
            {editing && <button onClick={toggleArchive} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500">{editing.is_active ? 'Archive' : 'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
