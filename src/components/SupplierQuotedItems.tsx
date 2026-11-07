'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import {
  DEFAULT_LANDED_SETTINGS, LandedSettings, landedCost, mergeSettings, tierPrice, type LandedResult,
} from '@/lib/supplierLanded'

// Supplier Quoted Items: every supplier price received (ERP RFQ responses and emailed quotes),
// grouped by product type, with an estimated landed cost to Santa Ana and suggested sell tiers.

export interface SupplierQuotedItem {
  id: string
  product_type: string
  item_name: string
  size: string | null
  spec: string | null
  supplier_name: string
  contact_name: string | null
  country: string | null
  unit_price: number | null
  currency: string
  uom: string | null
  case_price: number | null
  pcs_per_case: number | null
  incoterm: string | null
  port: string | null
  qty_basis: number | null
  moq: string | null
  plate_charge: string | null
  lead_time: string | null
  validity: string | null
  payment_terms: string | null
  certifications: string | null
  quote_ref: string | null
  quote_date: string | null
  rfq_number: string | null
  source: string | null
  notes: string | null
  status: string
  unit_weight_g: number | null
  units_per_container: number | null
  duty_pct_override: number | null
}

const FIELDS: { key: keyof SupplierQuotedItem; label: string; type?: 'number' | 'date' | 'textarea'; required?: boolean }[] = [
  { key: 'product_type', label: 'Product type', required: true },
  { key: 'item_name', label: 'Item', required: true },
  { key: 'size', label: 'Size' },
  { key: 'spec', label: 'Spec / material' },
  { key: 'supplier_name', label: 'Supplier', required: true },
  { key: 'contact_name', label: 'Contact' },
  { key: 'country', label: 'Country of origin' },
  { key: 'unit_price', label: 'Price per unit (USD)', type: 'number' },
  { key: 'uom', label: 'Unit (bag, pc, roll...)' },
  { key: 'case_price', label: 'Price per case', type: 'number' },
  { key: 'pcs_per_case', label: 'Pcs per case', type: 'number' },
  { key: 'incoterm', label: 'Shipping terms (FOB, DDP, EXW...)' },
  { key: 'port', label: 'Port / delivery point' },
  { key: 'qty_basis', label: 'Qty quoted at', type: 'number' },
  { key: 'moq', label: 'MOQ' },
  { key: 'plate_charge', label: 'Plate / tooling charge' },
  { key: 'lead_time', label: 'Lead time' },
  { key: 'validity', label: 'Validity' },
  { key: 'payment_terms', label: 'Payment terms' },
  { key: 'certifications', label: 'Certifications' },
  { key: 'quote_ref', label: 'Supplier quote #' },
  { key: 'quote_date', label: 'Quote date', type: 'date' },
  { key: 'rfq_number', label: 'Our RFQ #' },
  { key: 'source', label: 'Where it came from' },
  { key: 'status', label: 'Status (Active / Expired / Selected)' },
  { key: 'unit_weight_g', label: 'Unit weight (g), for freight', type: 'number' },
  { key: 'units_per_container', label: 'Units per 40HQ (overrides weight)', type: 'number' },
  { key: 'duty_pct_override', label: 'Duty % override', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
]

const TERM_COLORS: Record<string, string> = { DDP: '#059669', FOB: '#3B6FE0', EXW: '#D97706', CIF: '#7C3AED' }
export const money = (n: number | null | undefined, d = 4) => (n == null || !Number.isFinite(n) ? '' : '$' + Number(n).toFixed(d))
const sizeKey = (s: string | null) => {
  const m = (s || '').match(/[\d.]+/)
  return m ? parseFloat(m[0]) : 9999
}

/** Loads quoted items plus the landed / tier assumptions. Shared by the tab and the quote picker. */
export function useSupplierQuotedItems() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [items, setItems] = useState<SupplierQuotedItem[]>([])
  const [settings, setSettings] = useState<LandedSettings>(DEFAULT_LANDED_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    const [it, st] = await Promise.all([
      supabase.from('supplier_quoted_items').select('*').order('product_type').order('item_name'),
      supabase.from('supplier_landed_settings').select('data').eq('id', 'default').maybeSingle(),
    ])
    if (it.error) setError(it.error.message)
    else { setItems((it.data || []) as SupplierQuotedItem[]); setError(null) }
    setSettings(mergeSettings(st.data?.data))
    setLoading(false)
  }, [supabase])
  useEffect(() => { load() }, [load])
  return { supabase, items, settings, setSettings, loading, error, setError, load }
}

function LandedCell({ r }: { r: LandedResult }) {
  if (!r.ok) return <span className="text-[11px] text-amber-600">{r.reason}</span>
  const tip = r.basis === 'DDP quote'
    ? 'Supplier DDP price, delivered to Santa Ana'
    : `Price + duty ${money(r.duty)} (${r.dutyPct}%) + CBP fees ${money(r.fees)} + freight, drayage, broker ${money(r.freight)} at ${r.unitsPerContainer?.toLocaleString()} units per 40HQ`
  return (
    <span title={tip} className="cursor-help">
      <span className="font-bold text-[#1A1D2E]">{money(r.landed)}</span>
      <div className="text-[10px] text-gray-500">{r.basis === 'DDP quote' ? 'DDP as quoted' : `est. +${money(r.freight)} frt, +${r.dutyPct}% duty`}</div>
    </span>
  )
}

export default function SupplierQuotedItems() {
  const { supabase, items, settings, setSettings, loading, error, setError, load } = useSupplierQuotedItems()
  const [search, setSearch] = useState('')
  const [termFilter, setTermFilter] = useState('All')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Partial<SupplierQuotedItem> | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i =>
      (termFilter === 'All' || (i.incoterm || '').toUpperCase() === termFilter) &&
      (!q || [i.product_type, i.item_name, i.size, i.supplier_name, i.contact_name, i.country, i.rfq_number, i.quote_ref]
        .some(v => (v || '').toLowerCase().includes(q))))
  }, [items, search, termFilter])

  // product type -> item -> quotes (lowest landed first)
  const groups = useMemo(() => {
    const byType = new Map<string, Map<string, { q: SupplierQuotedItem; r: LandedResult }[]>>()
    for (const q of filtered) {
      const r = landedCost(q, settings)
      if (!byType.has(q.product_type)) byType.set(q.product_type, new Map())
      const byItem = byType.get(q.product_type)!
      const key = q.size || q.item_name
      if (!byItem.has(key)) byItem.set(key, [])
      byItem.get(key)!.push({ q, r })
    }
    return [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, m]) => ({
      type,
      count: [...m.values()].reduce((s, a) => s + a.length, 0),
      suppliers: new Set([...m.values()].flat().map(x => x.q.supplier_name)).size,
      items: [...m.entries()]
        .sort(([a], [b]) => sizeKey(a) - sizeKey(b) || a.localeCompare(b))
        .map(([key, quotes]) => ({ key, quotes: [...quotes].sort((x, y) => (x.r.landed ?? 1e9) - (y.r.landed ?? 1e9)) })),
    }))
  }, [filtered, settings])

  const terms = useMemo(() => ['All', ...Array.from(new Set(items.map(i => (i.incoterm || '').toUpperCase()).filter(Boolean))).sort()], [items])
  const productTypes = useMemo(() => Array.from(new Set(items.map(i => i.product_type))).sort(), [items])

  async function save() {
    if (!editing) return
    if (!editing.product_type || !editing.item_name || !editing.supplier_name) { setError('Product type, item and supplier are required.'); return }
    setSaving(true)
    const payload: any = { ...editing, updated_at: new Date().toISOString() }
    delete payload.id
    for (const f of FIELDS) if (payload[f.key] === '') payload[f.key] = null
    if (!payload.status) payload.status = 'Active'
    const res = editing.id
      ? await supabase.from('supplier_quoted_items').update(payload).eq('id', editing.id)
      : await supabase.from('supplier_quoted_items').insert(payload)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setEditing(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this quoted item?')) return
    const { error } = await supabase.from('supplier_quoted_items').delete().eq('id', id)
    if (error) setError(error.message)
    else { setEditing(null); load() }
  }

  async function saveSettings(next: LandedSettings) {
    const { error } = await supabase.from('supplier_landed_settings').upsert({ id: 'default', data: next, updated_at: new Date().toISOString() })
    if (error) { setError(error.message); return }
    setSettings(next)
    setShowSettings(false)
  }

  const tiers = settings.tiers

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item, size, supplier or RFQ #…"
            className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/40" />
          <div className="flex items-center gap-1 bg-white border border-[#E4E6EE] rounded-lg p-1">
            {terms.map(t => (
              <button key={t} onClick={() => setTermFilter(t)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-md ${termFilter === t ? 'bg-[#7C3AED] text-white' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings(true)} className="text-sm font-medium px-3 py-2 rounded-lg border border-[#E4E6EE] bg-white text-gray-600 hover:bg-gray-50">
            Landed &amp; Pricing Assumptions
          </button>
          <button onClick={() => setEditing({ currency: 'USD', status: 'Active' })}
            className="flex items-center gap-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm w-fit">
            + Add Quoted Item
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Landed = estimated cost delivered to {settings.destination}. DDP quotes are taken as landed; FOB and EXW add duty, CBP fees, ocean freight,
        drayage and broker fees for a full 40HQ (hover a landed price for the breakdown). The lowest landed cost per item is highlighted.
        Sell tiers = landed / (1 - margin): {tiers.map(t => `${t.name} ${t.gpm_pct}% (${t.qty_note})`).join(', ')}.
      </p>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="rounded-xl border border-[#E4E6EE] bg-white flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#7C3AED]/30 border-t-[#7C3AED] rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-[#E4E6EE] bg-white text-center text-sm text-gray-500 py-16">No supplier quoted items yet.</div>
      ) : groups.map(g => {
        const isCol = collapsed[g.type]
        return (
          <div key={g.type} className="bg-white rounded-xl shadow-sm border border-[#ECEEF3]">
            <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none rounded-t-xl" style={{ borderLeft: '5px solid #7C3AED' }}
              onClick={() => setCollapsed(c => ({ ...c, [g.type]: !c[g.type] }))}>
              <span className="text-[10px] text-[#7C3AED]" style={{ display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
              <span className="font-bold text-sm text-[#7C3AED]">{g.type}</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#7C3AED]/15 text-[#7C3AED]">{g.count} quotes</span>
              <span className="text-[11px] text-gray-500">{g.items.length} items · {g.suppliers} suppliers</span>
            </div>
            {!isCol && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1300px]">
                  <thead className="[&_th]:bg-[#FBFCFE]">
                    <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                      <th className="text-left px-3 py-2 font-semibold">Item / size</th>
                      <th className="text-left px-3 py-2 font-semibold">Supplier</th>
                      <th className="text-left px-3 py-2 font-semibold">Quoted price</th>
                      <th className="text-left px-3 py-2 font-semibold">Landed Santa Ana</th>
                      {tiers.map(t => <th key={t.name} className="text-right px-3 py-2 font-semibold whitespace-nowrap" title={t.qty_note}>{t.name} ({t.gpm_pct}%)</th>)}
                      <th className="text-left px-3 py-2 font-semibold">MOQ</th>
                      <th className="text-left px-3 py-2 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(it => it.quotes.map(({ q, r }, idx) => {
                      const lowest = idx === 0 && r.landed != null && it.quotes.length > 1
                      const term = (q.incoterm || '').toUpperCase()
                      return (
                        <tr key={q.id} onClick={() => setEditing(q)}
                          className={`border-b border-[#F2F3F7] hover:bg-[#F7F5FF] cursor-pointer align-top ${idx === 0 ? 'border-t-2 border-t-[#E4E6EE]' : ''}`}>
                          <td className="px-3 py-2 font-semibold text-[#1A1D2E] whitespace-nowrap">{idx === 0 ? (q.size || q.item_name) : ''}</td>
                          <td className="px-3 py-2 min-w-[170px]">
                            <div className="font-medium text-[#1A1D2E]">{q.supplier_name}</div>
                            <div className="text-[11px] text-gray-500">{[q.contact_name, q.country].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="font-semibold text-[#1A1D2E]">{money(q.unit_price)}<span className="text-[11px] font-normal text-gray-400"> / {q.uom || 'pc'}</span></div>
                            {q.case_price != null && <div className="text-[11px] text-gray-500">{money(q.case_price, 2)}{q.pcs_per_case ? ` / ${q.pcs_per_case}` : ''}</div>}
                            {term && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: (TERM_COLORS[term] || '#6B7280') + '1F', color: TERM_COLORS[term] || '#6B7280' }}>{term}</span>}
                            <span className="text-[10px] text-gray-500 ml-1">{q.port}</span>
                          </td>
                          <td className={`px-3 py-2 whitespace-nowrap ${lowest ? 'bg-emerald-50' : ''}`}><LandedCell r={r} /></td>
                          {tiers.map(t => (
                            <td key={t.name} className="px-3 py-2 text-right whitespace-nowrap text-[#1A1D2E]">{r.landed != null ? money(tierPrice(r.landed, t)) : ''}</td>
                          ))}
                          <td className="px-3 py-2 text-gray-700 min-w-[120px]">{q.moq}{q.qty_basis ? <div className="text-[11px] text-gray-500">Quoted at {Number(q.qty_basis).toLocaleString()}</div> : null}</td>
                          <td className="px-3 py-2 text-[11px] text-gray-600 min-w-[320px] leading-relaxed">
                            {[q.spec, q.certifications].filter(Boolean).join(' · ')}
                            {[q.lead_time && `Lead ${q.lead_time}`, q.validity && `Valid ${q.validity}`, q.payment_terms, q.plate_charge && `Plate ${q.plate_charge}`].filter(Boolean).length > 0 &&
                              <div>{[q.lead_time && `Lead ${q.lead_time}`, q.validity && `Valid ${q.validity}`, q.payment_terms, q.plate_charge && `Plate ${q.plate_charge}`].filter(Boolean).join(' · ')}</div>}
                            {(q.quote_ref || q.rfq_number || q.quote_date) && <div className="text-gray-400">{[q.quote_ref, q.quote_date, q.rfq_number, q.source].filter(Boolean).join(' · ')}</div>}
                            {q.notes && <div className="text-gray-500 italic">{q.notes}</div>}
                          </td>
                        </tr>
                      )
                    }))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#1A1D2E] mb-4">{editing.id ? 'Edit quoted item' : 'Add quoted item'}</h2>
            <datalist id="sqi-types">{productTypes.map(t => <option key={t} value={t} />)}</datalist>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FIELDS.map(f => (
                <label key={f.key} className={`text-xs font-semibold text-gray-500 ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
                  {f.label}{f.required ? ' *' : ''}
                  {f.type === 'textarea' ? (
                    <textarea rows={3} value={(editing as any)[f.key] ?? ''} onChange={e => setEditing({ ...editing, [f.key]: e.target.value })}
                      className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm font-normal text-[#1A1D2E]" />
                  ) : (
                    <input type={f.type || 'text'} step={f.type === 'number' ? 'any' : undefined} list={f.key === 'product_type' ? 'sqi-types' : undefined}
                      value={(editing as any)[f.key] ?? ''}
                      onChange={e => setEditing({ ...editing, [f.key]: f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })}
                      className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm font-normal text-[#1A1D2E]" />
                  )}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between mt-5">
              {editing.id ? <button onClick={() => remove(editing.id!)} className="text-sm text-red-600 hover:underline">Delete</button> : <span />}
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE]">Cancel</button>
                <button onClick={save} disabled={saving} className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsModal initial={settings} onClose={() => setShowSettings(false)} onSave={saveSettings} />}
    </div>
  )
}

function NumIn({ value, onChange, w = 'w-24' }: { value: number; onChange: (n: number) => void; w?: string }) {
  return <input type="number" step="any" value={value} onChange={e => onChange(Number(e.target.value))}
    className={`${w} border border-[#E4E6EE] rounded-md px-2 py-1 text-sm text-right`} />
}

function SettingsModal({ initial, onClose, onSave }: { initial: LandedSettings; onClose: () => void; onSave: (s: LandedSettings) => void }) {
  const [s, setS] = useState<LandedSettings>(JSON.parse(JSON.stringify(initial)))
  const setOrigin = (i: number, k: string, v: any) => setS(p => ({ ...p, origins: p.origins.map((o, j) => j === i ? { ...o, [k]: v } : o) }))
  const setTier = (i: number, k: string, v: any) => setS(p => ({ ...p, tiers: p.tiers.map((t, j) => j === i ? { ...t, [k]: v } : t) }))
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-5 text-sm" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-bold text-[#1A1D2E]">Landed &amp; pricing assumptions</h2>
          <p className="text-xs text-gray-500">Estimates for a full 40HQ delivered to {s.destination}. Confirm duty with the customs broker; update freight when you get a forwarder quote.</p>
        </div>
        <section>
          <h3 className="font-semibold text-[#1A1D2E] mb-2">By origin</h3>
          <table className="w-full"><thead><tr className="text-[11px] uppercase text-gray-400"><th className="text-left">Country</th><th className="text-right">Added US duty %</th><th className="text-right">Ocean per 40HQ ($)</th><th /></tr></thead>
            <tbody>
              {s.origins.map((o, i) => (
                <tr key={i}>
                  <td className="py-1"><input value={o.country} onChange={e => setOrigin(i, 'country', e.target.value)} className="border border-[#E4E6EE] rounded-md px-2 py-1 w-40" /></td>
                  <td className="text-right"><NumIn value={o.duty_pct} onChange={n => setOrigin(i, 'duty_pct', n)} /></td>
                  <td className="text-right"><NumIn value={o.ocean_40hq} onChange={n => setOrigin(i, 'ocean_40hq', n)} /></td>
                  <td className="text-right"><button onClick={() => setS(p => ({ ...p, origins: p.origins.filter((_, j) => j !== i) }))} className="text-red-500 text-xs">Remove</button></td>
                </tr>
              ))}
              <tr><td className="py-1 text-gray-500">Any other country</td>
                <td className="text-right"><NumIn value={s.default_origin.duty_pct} onChange={n => setS(p => ({ ...p, default_origin: { ...p.default_origin, duty_pct: n } }))} /></td>
                <td className="text-right"><NumIn value={s.default_origin.ocean_40hq} onChange={n => setS(p => ({ ...p, default_origin: { ...p.default_origin, ocean_40hq: n } }))} /></td><td /></tr>
            </tbody></table>
          <button onClick={() => setS(p => ({ ...p, origins: [...p.origins, { country: '', duty_pct: 10, ocean_40hq: 5000 }] }))} className="text-xs text-[#7C3AED] mt-1">+ Add country</button>
        </section>
        <section className="grid grid-cols-2 gap-3">
          {([['drayage_40hq', 'Drayage port to Santa Ana ($/40HQ)'], ['broker_isf_bond', 'Broker, ISF, bond ($/entry)'], ['exw_to_fob_40hq', 'EXW to FOB adder ($/40HQ)'],
            ['mpf_pct', 'MPF %'], ['mpf_min', 'MPF min ($)'], ['mpf_max', 'MPF max ($)'], ['hmf_pct', 'HMF %']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-xs font-semibold text-gray-500">{label}
              <NumIn value={(s as any)[k]} onChange={n => setS(p => ({ ...p, [k]: n }))} /></label>
          ))}
        </section>
        <section>
          <h3 className="font-semibold text-[#1A1D2E] mb-2">Practical load per 40HQ (kg), by product family</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(s.family_kg_per_40hq).map(([f, kg]) => (
              <label key={f} className="flex items-center justify-between text-xs font-semibold text-gray-500">{f}
                <NumIn value={kg} onChange={n => setS(p => ({ ...p, family_kg_per_40hq: { ...p.family_kg_per_40hq, [f]: n } }))} /></label>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">A product type uses the family whose name it contains. Units per 40HQ = load / unit weight, unless the item has its own units per 40HQ.</p>
        </section>
        <section>
          <h3 className="font-semibold text-[#1A1D2E] mb-2">Suggested selling price tiers (margin on landed cost)</h3>
          {s.tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <input value={t.name} onChange={e => setTier(i, 'name', e.target.value)} className="border border-[#E4E6EE] rounded-md px-2 py-1 w-24" />
              <input value={t.qty_note} onChange={e => setTier(i, 'qty_note', e.target.value)} className="border border-[#E4E6EE] rounded-md px-2 py-1 flex-1" />
              <NumIn value={t.gpm_pct} onChange={n => setTier(i, 'gpm_pct', n)} w="w-20" /><span className="text-xs text-gray-500">% GPM</span>
              <button onClick={() => setS(p => ({ ...p, tiers: p.tiers.filter((_, j) => j !== i) }))} className="text-red-500 text-xs">Remove</button>
            </div>
          ))}
          <button onClick={() => setS(p => ({ ...p, tiers: [...p.tiers, { name: `Tier ${p.tiers.length + 1}`, qty_note: '', gpm_pct: 20 }] }))} className="text-xs text-[#7C3AED] mt-1">+ Add tier</button>
        </section>
        <div className="flex justify-between">
          <button onClick={() => setS(JSON.parse(JSON.stringify(DEFAULT_LANDED_SETTINGS)))} className="text-xs text-gray-500 hover:underline">Reset to defaults</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#E4E6EE]">Cancel</button>
            <button onClick={() => onSave(s)} className="px-4 py-2 rounded-lg bg-[#7C3AED] text-white font-semibold">Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Picker used inside the quote / estimate editor to pull a supplier item in as a line. */
export function SupplierItemPicker({ onClose, onPick }: {
  onClose: () => void
  onPick: (line: { product_name: string; description: string; quantity: number; unit_price: number; unit_of_measure: string | null }) => void
}) {
  const { items, settings, loading, error } = useSupplierQuotedItems()
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<SupplierQuotedItem | null>(null)
  const [tierIdx, setTierIdx] = useState(0)
  const [custom, setCustom] = useState<string>('')
  const [qty, setQty] = useState<number>(1000)
  const [desc, setDesc] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter(i => !q || [i.product_type, i.item_name, i.size, i.supplier_name, i.spec].some(v => (v || '').toLowerCase().includes(q)))
      .map(i => ({ i, r: landedCost(i, settings) }))
      .sort((a, b) => a.i.product_type.localeCompare(b.i.product_type) || sizeKey(a.i.size) - sizeKey(b.i.size) || (a.r.landed ?? 1e9) - (b.r.landed ?? 1e9))
  }, [items, settings, search])

  const selLanded = sel ? landedCost(sel, settings).landed : null
  const price = custom !== '' ? Number(custom) : (selLanded != null && settings.tiers[tierIdx] ? tierPrice(selLanded, settings.tiers[tierIdx]) : 0)

  function choose(i: SupplierQuotedItem) {
    setSel(i); setCustom('')
    setDesc([i.item_name, i.spec].filter(Boolean).join(', '))
    if (i.qty_basis) setQty(Number(i.qty_basis))
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#EEF0F4]">
          <h2 className="text-lg font-bold text-[#1A1D2E]">Add from Supplier Quoted Items</h2>
          <p className="text-xs text-gray-500">Pick an item, choose a price tier (or type your own price), set the quantity. Supplier names stay internal and are not added to the line.</p>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item, size, supplier…"
            className="mt-2 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-8 text-center text-sm text-gray-500">Loading…</div> : error ? <div className="p-4 text-sm text-red-600">{error}</div> : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#FBFCFE]"><tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                <th className="text-left px-3 py-2">Product type</th><th className="text-left px-3 py-2">Size</th><th className="text-left px-3 py-2">Supplier</th>
                <th className="text-left px-3 py-2">Terms</th><th className="text-right px-3 py-2">Landed</th>
                {settings.tiers.map(t => <th key={t.name} className="text-right px-3 py-2">{t.name}</th>)}
              </tr></thead>
              <tbody>
                {rows.map(({ i, r }) => (
                  <tr key={i.id} onClick={() => choose(i)} className={`border-b border-[#F2F3F7] cursor-pointer ${sel?.id === i.id ? 'bg-[#EDE9FE]' : 'hover:bg-[#F7F5FF]'}`}>
                    <td className="px-3 py-1.5 text-[12px] text-gray-600">{i.product_type}</td>
                    <td className="px-3 py-1.5 font-medium">{i.size || i.item_name}</td>
                    <td className="px-3 py-1.5 text-[12px]">{i.supplier_name}<span className="text-gray-400"> · {i.country}</span></td>
                    <td className="px-3 py-1.5 text-[12px]">{(i.incoterm || '').toUpperCase()}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{r.landed != null ? money(r.landed) : <span className="text-[11px] text-amber-600">n/a</span>}</td>
                    {settings.tiers.map(t => <td key={t.name} className="px-3 py-1.5 text-right">{r.landed != null ? money(tierPrice(r.landed, t)) : ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-[#EEF0F4] space-y-3">
          {sel ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs font-semibold text-gray-500">
                <label className="sm:col-span-2">Line description
                  <input value={desc} onChange={e => setDesc(e.target.value)} className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm font-normal text-[#1A1D2E]" /></label>
                <label>Price tier
                  <select value={tierIdx} onChange={e => { setTierIdx(Number(e.target.value)); setCustom('') }} className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm font-normal text-[#1A1D2E]">
                    {settings.tiers.map((t, i) => <option key={i} value={i}>{t.name} ({t.gpm_pct}%): {selLanded != null ? money(tierPrice(selLanded, t)) : 'n/a'}</option>)}
                  </select></label>
                <label>Unit price (override)
                  <input type="number" step="any" value={custom} placeholder={price ? price.toFixed(4) : ''} onChange={e => setCustom(e.target.value)}
                    className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm font-normal text-[#1A1D2E]" /></label>
                <label>Quantity
                  <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm font-normal text-[#1A1D2E]" /></label>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Landed {money(selLanded)} · selling {money(price)} / {sel.uom || 'pc'} · line {money(price * qty, 2)}</span>
                <div className="flex gap-2">
                  <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE]">Cancel</button>
                  <button disabled={!price || !qty}
                    onClick={() => onPick({ product_name: sel.item_name, description: desc, quantity: qty, unit_price: Math.round(price * 10000) / 10000, unit_of_measure: sel.uom || null })}
                    className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white disabled:opacity-50">Add to quote</button>
                </div>
              </div>
            </>
          ) : <div className="flex justify-end"><button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE]">Close</button></div>}
        </div>
      </div>
    </div>
  )
}
