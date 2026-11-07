'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Supplier Quoted Items: every supplier price received (ERP RFQ responses and emailed quotes),
// grouped by product type so the team can compare price, terms and MOQ side by side.

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
  { key: 'notes', label: 'Notes', type: 'textarea' },
]

const TERM_COLORS: Record<string, string> = { DDP: '#059669', FOB: '#3B6FE0', EXW: '#D97706', CIF: '#7C3AED' }
const money = (n: number | null, d = 4) => (n == null ? '' : '$' + Number(n).toFixed(d))
const sizeKey = (s: string | null) => {
  const m = (s || '').match(/[\d.]+/)
  return m ? parseFloat(m[0]) : 9999
}

export default function SupplierQuotedItems() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [items, setItems] = useState<SupplierQuotedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [termFilter, setTermFilter] = useState('All')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Partial<SupplierQuotedItem> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('supplier_quoted_items').select('*').order('product_type').order('item_name')
    if (error) setError(error.message)
    else { setItems((data || []) as SupplierQuotedItem[]); setError(null) }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i =>
      (termFilter === 'All' || (i.incoterm || '').toUpperCase() === termFilter) &&
      (!q || [i.product_type, i.item_name, i.size, i.supplier_name, i.contact_name, i.country, i.rfq_number, i.quote_ref]
        .some(v => (v || '').toLowerCase().includes(q))))
  }, [items, search, termFilter])

  // product type -> item -> quotes (cheapest first)
  const groups = useMemo(() => {
    const byType = new Map<string, Map<string, SupplierQuotedItem[]>>()
    for (const i of filtered) {
      if (!byType.has(i.product_type)) byType.set(i.product_type, new Map())
      const byItem = byType.get(i.product_type)!
      const key = i.size || i.item_name
      if (!byItem.has(key)) byItem.set(key, [])
      byItem.get(key)!.push(i)
    }
    return [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, m]) => ({
      type,
      count: [...m.values()].reduce((s, a) => s + a.length, 0),
      suppliers: new Set([...m.values()].flat().map(x => x.supplier_name)).size,
      items: [...m.entries()]
        .sort(([a], [b]) => sizeKey(a) - sizeKey(b) || a.localeCompare(b))
        .map(([key, quotes]) => ({ key, quotes: [...quotes].sort((x, y) => (x.unit_price ?? 1e9) - (y.unit_price ?? 1e9)) })),
    }))
  }, [filtered])

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
        <button onClick={() => setEditing({ currency: 'USD', status: 'Active' })}
          className="flex items-center gap-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm w-fit">
          + Add Quoted Item
        </button>
      </div>
      <p className="text-xs text-gray-500">Prices are per unit in USD. DDP is delivered to Santa Ana; FOB and EXW exclude freight, duty and customs, so compare DDP to DDP. The lowest price for each item is highlighted.</p>

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
                <table className="w-full text-sm min-w-[1250px]">
                  <thead className="[&_th]:bg-[#FBFCFE]">
                    <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                      {['Item / size', 'Supplier', 'Price / unit', 'Case price', 'Terms', 'MOQ', 'Qty quoted', 'Spec', 'Lead time', 'Validity', 'Payment', 'Plate', 'Quote ref', 'Notes'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(it => it.quotes.map((q, idx) => {
                      const lowest = idx === 0 && q.unit_price != null && it.quotes.length > 1
                      const term = (q.incoterm || '').toUpperCase()
                      return (
                        <tr key={q.id} onClick={() => setEditing(q)}
                          className={`border-b border-[#F2F3F7] hover:bg-[#F7F5FF] cursor-pointer align-top ${idx === 0 ? 'border-t-2 border-t-[#E4E6EE]' : ''}`}>
                          <td className="px-3 py-2 font-semibold text-[#1A1D2E] whitespace-nowrap">{idx === 0 ? (q.size || q.item_name) : ''}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-[#1A1D2E]">{q.supplier_name}</div>
                            <div className="text-[11px] text-gray-500">{[q.contact_name, q.country].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`font-bold ${lowest ? 'text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded' : 'text-[#1A1D2E]'}`}>{money(q.unit_price)}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-600">{q.case_price != null ? `${money(q.case_price, 2)}${q.pcs_per_case ? ` / ${q.pcs_per_case}` : ''}` : ''}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {term && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: (TERM_COLORS[term] || '#6B7280') + '1F', color: TERM_COLORS[term] || '#6B7280' }}>{term}</span>}
                            <div className="text-[11px] text-gray-500 mt-0.5">{q.port}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{q.moq}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">{q.qty_basis ? Number(q.qty_basis).toLocaleString() : ''}</td>
                          <td className="px-3 py-2 text-gray-700">{q.spec}{q.certifications ? <div className="text-[11px] text-gray-500">{q.certifications}</div> : null}</td>
                          <td className="px-3 py-2 text-gray-700">{q.lead_time}</td>
                          <td className="px-3 py-2 text-gray-700">{q.validity}{q.status && q.status !== 'Active' ? <div className="text-[11px] font-semibold text-amber-600">{q.status}</div> : null}</td>
                          <td className="px-3 py-2 text-gray-700">{q.payment_terms}</td>
                          <td className="px-3 py-2 text-gray-700">{q.plate_charge}</td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {q.quote_ref}{q.quote_date ? <div className="text-[11px] text-gray-500">{q.quote_date}</div> : null}
                            {q.rfq_number ? <div className="text-[11px] text-gray-500">{q.rfq_number}</div> : null}
                          </td>
                          <td className="px-3 py-2 text-[12px] text-gray-600 min-w-[220px]">{q.notes}{q.source ? <div className="text-[11px] text-gray-400 mt-0.5">Source: {q.source}</div> : null}</td>
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
    </div>
  )
}
