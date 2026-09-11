'use client'
import ShareLink from '@/components/ShareLink'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

/**
 * Production Rates — how fast each machine runs, in the units that department actually uses.
 *
 * Three tiers, most specific wins:
 *   machine + product  →  machine  →  equipment type
 * so a shared mould can beat the machine's own figure and a new press still inherits
 * something sensible on day one.
 *
 * Nothing here is automatic. Observed runs are shown beside the standard and a person
 * decides whether to promote — a schedule that rewrote its own numbers is one nobody
 * trusts twice.
 */

const RATE_UOMS = ['Seconds', 'Meters/Minute', 'Bags/Minute', 'Pcs/Minute', 'Packs/Minute'] as const
const OUTPUT_UOMS = ['pcs', 'bags', 'meters', 'packs'] as const
type RateUom = (typeof RATE_UOMS)[number]

interface Machine { id: string; name: string; equipment_type: string | null; equipment_group: string | null }
interface Product { id: string; sku: string; product_name: string | null }
interface Rate {
  id: string
  machine_id: string | null
  equipment_type: string | null
  product_id: string | null
  rate_value: number
  rate_uom: RateUom
  cavities: number
  output_per_hour: number
  output_uom: string
  setup_minutes: number
  efficiency_pct: number
  source: 'estimated' | 'measured'
  notes: string | null
  confirmed_by: string | null
}
interface Learned {
  product_id: string; machine_id: string; operation: string
  samples: number; median_pieces_per_hour: number
  min_pieces_per_hour: number; max_pieces_per_hour: number
  hours_observed: number; last_seen: string; confidence: string
}
interface Gap { area: string; item: string; item_id: string; missing: string; fix: string; priority: number }

const empty = {
  machine_id: '', product_id: '', rate_value: '20', rate_uom: 'Seconds' as RateUom,
  cavities: '1', output_uom: 'pcs', setup_minutes: '0', efficiency_pct: '85', notes: '',
}
type Form = typeof empty

/** Mirrors the generated column in the database so the drawer can preview before saving. */
function perHour(value: number, uom: string, cavities: number) {
  if (!value || value <= 0) return 0
  return uom === 'Seconds' ? (3600 / value) * cavities : value * 60 * cavities
}
const n = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d })

export default function ProductionRatesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [tab, setTab] = useState<'rates' | 'learning' | 'gaps'>('rates')
  const [machines, setMachines] = useState<Machine[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [learned, setLearned] = useState<Learned[]>([])
  const [gaps, setGaps] = useState<Gap[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [email, setEmail] = useState('')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Rate | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: m }, { data: p }, { data: r }, { data: l }, { data: g }] = await Promise.all([
      sb.from('machines').select('id,name,equipment_type,equipment_group').eq('is_active', true).order('name'),
      sb.from('products').select('id,sku,product_name').eq('is_active', true).order('sku').limit(2000),
      sb.from('machine_rates').select('*').eq('is_active', true),
      sb.from('learned_rates').select('*'),
      sb.from('production_data_gaps').select('*').order('priority').limit(500),
    ])
    setMachines((m as Machine[]) || [])
    setProducts((p as Product[]) || [])
    setRates((r as Rate[]) || [])
    setLearned((l as Learned[]) || [])
    setGaps((g as Gap[]) || [])
    setLoading(false)
  }
  useEffect(() => {
    load() // eslint-disable-line
    sb.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))
  }, []) // eslint-disable-line

  const mById = useMemo(() => Object.fromEntries(machines.map(m => [m.id, m])), [machines])
  const pById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])
  const learnedFor = (machineId: string | null, productId: string | null) =>
    learned.find(l => l.machine_id === machineId && l.product_id === productId)

  const visible = rates
    .filter(r => {
      if (!search) return true
      const q = search.toLowerCase()
      const mn = r.machine_id ? mById[r.machine_id]?.name ?? '' : r.equipment_type ?? ''
      const sku = r.product_id ? pById[r.product_id]?.sku ?? '' : ''
      return mn.toLowerCase().includes(q) || sku.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const an = a.machine_id ? mById[a.machine_id]?.name ?? 'zz' : `_${a.equipment_type}`
      const bn = b.machine_id ? mById[b.machine_id]?.name ?? 'zz' : `_${b.equipment_type}`
      return an.localeCompare(bn) || (a.product_id ? 1 : 0) - (b.product_id ? 1 : 0)
    })

  function openAdd() { setEditing(null); setForm(empty); setErr(''); setOpen(true) }
  function openEdit(r: Rate) {
    setEditing(r)
    setForm({
      machine_id: r.machine_id ?? '', product_id: r.product_id ?? '',
      rate_value: String(r.rate_value), rate_uom: r.rate_uom, cavities: String(r.cavities),
      output_uom: r.output_uom, setup_minutes: String(r.setup_minutes),
      efficiency_pct: String(r.efficiency_pct), notes: r.notes ?? '',
    })
    setErr(''); setOpen(true)
  }
  function close() { setOpen(false); setTimeout(() => { setEditing(null); setForm(empty) }, 250) }

  async function save() {
    setErr(''); setSaving(true)
    const payload = {
      machine_id: form.machine_id || null,
      product_id: form.product_id || null,
      rate_value: parseFloat(form.rate_value) || 0,
      rate_uom: form.rate_uom,
      cavities: parseInt(form.cavities) || 1,
      output_uom: form.output_uom,
      setup_minutes: parseFloat(form.setup_minutes) || 0,
      efficiency_pct: parseFloat(form.efficiency_pct) || 85,
      notes: form.notes.trim() || null,
      entered_by: email || null,
      updated_at: new Date().toISOString(),
    }
    if (!payload.machine_id) { setErr('Pick a machine.'); setSaving(false); return }
    if (payload.rate_value <= 0) { setErr('Enter a rate greater than zero.'); setSaving(false); return }
    const { error } = editing
      ? await sb.from('machine_rates').update(payload).eq('id', editing.id)
      : await sb.from('machine_rates').insert({ ...payload, source: 'estimated' })
    setSaving(false)
    if (error) { setErr(error.message); return }
    close(); load()
  }

  async function confirmRate(r: Rate) {
    setBusy(r.id)
    await sb.from('machine_rates')
      .update({ source: 'measured', confirmed_by: email, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', r.id)
    setBusy(''); load()
  }

  async function promote(machineId: string, productId: string) {
    setBusy(machineId + productId)
    const { data, error } = await sb.rpc('promote_learned_rate', {
      p_product_id: productId, p_machine_id: machineId, p_approved_by: email || 'unknown',
    })
    setBusy('')
    alert(error ? 'Could not promote: ' + error.message : String(data))
    load()
  }

  async function archive() {
    if (!editing) return
    if (!confirm('Remove this rate? Anything using it falls back to the machine or class rate.')) return
    setBusy('archive')
    await sb.from('machine_rates').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', editing.id)
    setBusy(''); close(); load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'
  const preview = perHour(parseFloat(form.rate_value) || 0, form.rate_uom, parseInt(form.cavities) || 1)
  const estimated = rates.filter(r => r.source === 'estimated').length
  const promotable = learned.filter(l => l.samples >= 3).length

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-700 border-emerald-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Production Rates</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${rates.length} rates · ${estimated} still estimates · ${promotable} ready to promote · ${gaps.length} data gaps`}
          </p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">+ Add Rate</button>
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-[#E4E6EE]">
        {([['rates', 'Rates'], ['learning', `Learning (${learned.length})`], ['gaps', `Data Gaps (${gaps.length})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === k ? 'border-emerald-600 text-[#1A1D2E]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
        {tab === 'rates' && (
          <input placeholder="Search machine or SKU…" value={search} onChange={e => setSearch(e.target.value)}
            className="ml-auto mb-1.5 bg-white border border-[#E4E6EE] rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        )}
      </div>

      {tab === 'rates' && (
        <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="border-b border-[#E4E6EE]">
              {['Applies to', 'Entered as', 'Output / hour', 'Setup', 'Eff.', 'Source', 'Observed', ''].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {visible.map(r => {
                const lr = learnedFor(r.machine_id, r.product_id)
                const mn = r.machine_id ? mById[r.machine_id]?.name : null
                const sku = r.product_id ? pById[r.product_id]?.sku : null
                return (
                  <tr key={r.id} className="border-b border-[#E4E6EE]/60 last:border-0 hover:bg-[#F9FAFB]">
                    <td className="px-4 py-3 cursor-pointer" onClick={() => openEdit(r)}>
                      <span className="font-medium text-[#1A1D2E]">{mn ?? `All ${r.equipment_type}`}</span>
                      {sku && <span className="block text-[11px] font-mono text-emerald-700">{sku}</span>}
                      {!r.machine_id && <span className="block text-[10px] text-gray-400">class default</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.rate_value} {r.rate_uom === 'Seconds' ? 'sec' : r.rate_uom.replace('/Minute', '/min')}
                      {r.cavities > 1 && <span className="text-gray-400"> × {r.cavities} cav</span>}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#1A1D2E]">{n(r.output_per_hour)} <span className="text-gray-400 font-normal">{r.output_uom}/hr</span></td>
                    <td className="px-4 py-3 text-gray-500">{r.setup_minutes ? `${r.setup_minutes} min` : '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.efficiency_pct}%</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${r.source === 'measured' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.source}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {lr ? (
                        <div className="leading-tight">
                          <span className="text-[#1A1D2E]">{n(lr.median_pieces_per_hour)}/hr</span>
                          <span className="block text-[10px] text-gray-400">{lr.samples} run{lr.samples === 1 ? '' : 's'} · {lr.confidence}</span>
                        </div>
                      ) : <span className="text-gray-300">no runs yet</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {lr && lr.samples >= 3 && r.product_id && r.machine_id && (
                        <button disabled={busy === r.machine_id + r.product_id}
                          onClick={() => promote(r.machine_id!, r.product_id!)}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                          Promote
                        </button>
                      )}
                      {r.source === 'estimated' && (
                        <button disabled={busy === r.id} onClick={() => confirmRate(r)}
                          className="ml-2 text-[11px] text-gray-500 hover:text-gray-800 hover:underline disabled:opacity-50">
                          Confirm
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={8} className="text-center py-16 text-gray-500 text-sm">No rates match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'learning' && (
        <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-[#E4E6EE]">
              {['SKU', 'Machine', 'Operation', 'Runs', 'Median /hr', 'Spread', 'Hours seen', 'Confidence', 'Last run'].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {learned.map((l, i) => (
                <tr key={i} className="border-b border-[#E4E6EE]/60 last:border-0 hover:bg-[#F9FAFB]">
                  <td className="px-4 py-3 font-mono text-xs text-emerald-700">{pById[l.product_id]?.sku ?? '—'}</td>
                  <td className="px-4 py-3 font-medium text-[#1A1D2E]">{mById[l.machine_id]?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{l.operation}</td>
                  <td className="px-4 py-3 text-gray-600">{l.samples}</td>
                  <td className="px-4 py-3 font-medium text-[#1A1D2E]">{n(l.median_pieces_per_hour)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{n(l.min_pieces_per_hour)} – {n(l.max_pieces_per_hour)}</td>
                  <td className="px-4 py-3 text-gray-500">{n(l.hours_observed, 1)} h</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${l.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : l.confidence === 'medium' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{l.confidence}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{l.last_seen ? new Date(l.last_seen).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!loading && learned.length === 0 && (
                <tr><td colSpan={9} className="text-center py-16 text-gray-500 text-sm">
                  Nothing observed yet. Rates are learned from finished work orders — close one with a produced quantity and it appears here.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'gaps' && (
        <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-x-auto">
          <p className="text-xs text-gray-500 px-4 pt-4">What the system cannot work out on its own. Each of these is a field someone needs to fill in.</p>
          <table className="w-full min-w-[760px] text-sm mt-2">
            <thead><tr className="border-b border-[#E4E6EE]">
              {['', 'Area', 'Item', 'Missing', 'What to do'].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {gaps.map((g, i) => (
                <tr key={i} className="border-b border-[#E4E6EE]/60 last:border-0 hover:bg-[#F9FAFB]">
                  <td className="px-4 py-3">
                    <span className={`inline-block w-2 h-2 rounded-full ${g.priority === 1 ? 'bg-red-500' : g.priority === 2 ? 'bg-amber-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{g.area}</td>
                  <td className="px-4 py-3 font-medium text-[#1A1D2E]">{g.item}</td>
                  <td className="px-4 py-3 text-gray-600">{g.missing}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{g.fix}</td>
                </tr>
              ))}
              {!loading && gaps.length === 0 && (
                <tr><td colSpan={5} className="text-center py-16 text-gray-500 text-sm">Nothing missing.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* editor */}
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close} />
      <div className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-white border-l border-[#E4E6EE] z-50 flex flex-col shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0">
          <h2 className="text-[#1A1D2E] font-semibold">{editing ? 'Edit Rate' : 'Add Rate'}</h2>
          <div className="flex items-center gap-2">
            {editing && <ShareLink id={editing.id} />}
            <button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Machine</label>
            <select value={form.machine_id} onChange={e => setForm(p => ({ ...p, machine_id: e.target.value }))} className={inp + ' cursor-pointer'}>
              <option value="">— Pick a machine —</option>
              {Array.from(new Set(machines.map(m => m.equipment_group ?? 'Other'))).map(g => (
                <optgroup key={g} label={g}>
                  {machines.filter(m => (m.equipment_group ?? 'Other') === g).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Product</label>
            <select value={form.product_id} onChange={e => setForm(p => ({ ...p, product_id: e.target.value }))} className={inp + ' cursor-pointer'}>
              <option value="">— Any product (the machine's own rate) —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.product_name ?? ''}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1.5">Set a product only when it runs differently — a mould with a different cavity count, for instance.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Entered as</label>
              <select value={form.rate_uom} onChange={e => setForm(p => ({ ...p, rate_uom: e.target.value as RateUom }))} className={inp + ' cursor-pointer'}>
                {RATE_UOMS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">{form.rate_uom === 'Seconds' ? 'Cycle time (sec)' : 'Rate per minute'}</label>
              <input type="number" step="0.01" value={form.rate_value} onChange={e => setForm(p => ({ ...p, rate_value: e.target.value }))} className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Cavities</label>
              <input type="number" value={form.cavities} onChange={e => setForm(p => ({ ...p, cavities: e.target.value }))} className={inp} />
              <p className="text-[11px] text-gray-400 mt-1.5">Moulding only. Cavitation belongs to the tool, so set it per product when a machine runs more than one mould.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Output counted in</label>
              <select value={form.output_uom} onChange={e => setForm(p => ({ ...p, output_uom: e.target.value }))} className={inp + ' cursor-pointer'}>
                {OUTPUT_UOMS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="rounded-lg px-3 py-2.5 bg-[#F5F6FA] flex items-center justify-between">
            <span className="text-xs text-gray-500">Output per hour</span>
            <span className="text-sm font-medium text-[#1A1D2E]">{n(preview)} {form.output_uom}/hr</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Changeover (min)</label>
              <input type="number" value={form.setup_minutes} onChange={e => setForm(p => ({ ...p, setup_minutes: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Efficiency %</label>
              <input type="number" value={form.efficiency_pct} onChange={e => setForm(p => ({ ...p, efficiency_pct: e.target.value }))} className={inp} />
              <p className="text-[11px] text-gray-400 mt-1.5">Planned, not theoretical. 85% is the usual starting point.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp + ' resize-none'} />
          </div>
          {editing && (
            <p className="text-[11px] text-gray-400">
              Currently <strong>{editing.source}</strong>{editing.confirmed_by ? `, confirmed by ${editing.confirmed_by}` : ''}. Saving an edit keeps it as it is; use Confirm on the list to mark a figure as measured.
            </p>
          )}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-3">
            {editing && <button onClick={archive} disabled={busy === 'archive'} className="text-sm px-3 py-2.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">Remove</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white text-sm font-medium px-4 py-2.5 rounded-lg">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
