'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Right-panel tab that drives the official approval proof sheet from ERP records.
import { useEffect, useState } from 'react'
import { CUSTOMER_COLS, PRODUCT_COLS, PRINT_METHODS, DEFAULT_TERMS, type ProofInfo } from '@/lib/packaging/proofTemplate'

interface Props {
  sb: any
  info: ProofInfo
  onChange: (patch: Partial<ProofInfo>) => void
  onPickCustomer: (row: any | null) => void
  onPickProduct: (row: any | null) => void
  onRefresh: () => void
  onDownload: () => void
  busy?: boolean
}

function useSearch(sb: any, table: 'customers' | 'products', q: string) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => {
    const s = q.trim()
    if (s.length < 2) { setRows([]); return }
    const t = setTimeout(async () => {
      const like = `%${s.replace(/[%,()]/g, ' ')}%`
      const query = table === 'customers'
        ? sb.from('customers').select(CUSTOMER_COLS).or(`company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like}`).not('is_merged', 'is', true).order('company_name').limit(15)
        : sb.from('products').select(PRODUCT_COLS).or(`sku.ilike.${like},product_name.ilike.${like},customer_part_number.ilike.${like}`).order('sku').limit(15)
      const { data } = await query
      setRows(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [sb, table, q])
  return rows
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block"><span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</span><div className="mt-0.5">{children}</div></label>
)
const inputCls = 'w-full border border-gray-300 rounded px-2 py-1.5 text-xs outline-none focus:border-[#3B6FE0]'

export default function ProofPanel({ sb, info, onChange, onPickCustomer, onPickProduct, onRefresh, onDownload, busy }: Props) {
  const [cq, setCq] = useState(''), [pq, setPq] = useState('')
  const [cOpen, setCOpen] = useState(false), [pOpen, setPOpen] = useState(false)
  const cRows = useSearch(sb, 'customers', cq)
  const pRows = useSearch(sb, 'products', pq)
  const c = info.customer, p = info.product
  const isLead = !!c?.status && /lead|prospect/i.test(c.status)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-800">Approval proof sheet</p>
          <p className="text-[11px] text-gray-500">Auto-filled from the ERP. Shown around the artboard.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={info.enabled !== false} onChange={e => onChange({ enabled: e.target.checked })} /> Show
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-gray-50 rounded px-2 py-1.5"><span className="text-gray-500">Proof #</span><p className="font-semibold">{info.proofNo || '—'}</p></div>
        <div className="bg-gray-50 rounded px-2 py-1.5"><span className="text-gray-500">Version</span><p className="font-semibold">V{info.version || 1}</p></div>
      </div>

      {/* customer / lead */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Customer / Lead</p>
        {c?.name ? (
          <div className="border border-gray-200 rounded p-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold truncate">{c.name}</span>
              {c.status && <span className={`text-[10px] px-1.5 rounded ${isLead ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{c.status}</span>}
              <button onClick={() => onPickCustomer(null)} className="ml-auto text-gray-400 hover:text-red-500" title="Remove"><i className="ti ti-x" /></button>
            </div>
            <p className="text-gray-500 truncate">{[c.contact, c.email, c.phone].filter(Boolean).join(' · ') || 'No contact on file'}</p>
          </div>
        ) : <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">No customer or lead linked yet.</p>}
        <div className="relative">
          <input value={cq} onChange={e => { setCq(e.target.value); setCOpen(true) }} onFocus={() => setCOpen(true)} onBlur={() => setTimeout(() => setCOpen(false), 150)}
            placeholder="Search customers & leads…" className={inputCls} />
          {cOpen && cRows.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-64 overflow-y-auto">
              {cRows.map(r => (
                <button key={r.id} onMouseDown={() => { onPickCustomer(r); setCq(''); setCOpen(false) }} className="w-full text-left px-2 py-1.5 hover:bg-blue-50 text-xs">
                  <span className="font-medium">{r.company_name}</span>
                  <span className="ml-1 text-[10px] text-gray-500">{r.customer_status || ''}{r.city ? ` · ${r.city}${r.state ? ', ' + r.state : ''}` : ''}</span>
                  {r.contact_name && <span className="block text-[10px] text-gray-400">{r.contact_name}{r.email ? ` · ${r.email}` : ''}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* product / sku */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Product / SKU</p>
        {p?.sku ? (
          <div className="border border-gray-200 rounded p-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold font-mono">{p.sku}</span>
              {!p.id && <span className="text-[10px] px-1.5 rounded bg-gray-100 text-gray-600">not in products</span>}
              <button onClick={() => onPickProduct(null)} className="ml-auto text-gray-400 hover:text-red-500" title="Remove"><i className="ti ti-x" /></button>
            </div>
            <p className="text-gray-600 truncate">{p.name || '—'}</p>
            <p className="text-gray-400 truncate">{[p.size, p.pack, p.upc && `UPC ${p.upc}`].filter(Boolean).join(' · ')}</p>
          </div>
        ) : <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">No SKU linked yet.</p>}
        <div className="relative">
          <input value={pq} onChange={e => { setPq(e.target.value); setPOpen(true) }} onFocus={() => setPOpen(true)} onBlur={() => setTimeout(() => setPOpen(false), 150)}
            placeholder="Search SKU or product name…" className={inputCls} />
          {pOpen && pRows.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-64 overflow-y-auto">
              {pRows.map(r => (
                <button key={r.id} onMouseDown={() => { onPickProduct(r); setPq(''); setPOpen(false) }} className="w-full text-left px-2 py-1.5 hover:bg-blue-50 text-xs">
                  <span className="font-mono font-medium">{r.sku}</span>
                  <span className="block text-[10px] text-gray-500 truncate">{r.product_name}{r.product_size ? ` · ${r.product_size}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* print specs */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Print specifications</p>
        <Field label="Print method">
          <select value={info.printMethod || ''} onChange={e => onChange({ printMethod: e.target.value })} className={inputCls}>
            <option value="">—</option>
            {PRINT_METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Substrate / material"><input value={info.substrate || ''} onChange={e => onChange({ substrate: e.target.value })} placeholder="e.g. 18pt SBS, PLA-lined paper" className={inputCls} /></Field>
        <Field label="Finish / coating"><input value={info.finish || ''} onChange={e => onChange({ finish: e.target.value })} placeholder="e.g. Aqueous gloss, matte varnish" className={inputCls} /></Field>
        <Field label="Artist"><input value={info.artist || ''} onChange={e => onChange({ artist: e.target.value })} className={inputCls} /></Field>
        <Field label="Job notes"><textarea value={info.notes || ''} onChange={e => onChange({ notes: e.target.value })} rows={2} className={inputCls} /></Field>
        <Field label="Terms & conditions">
          <textarea value={info.terms ?? DEFAULT_TERMS} onChange={e => onChange({ terms: e.target.value })} rows={5} className={inputCls + ' text-[11px]'} />
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Inks detected in artwork</p>
        {(info.inks || []).length ? (info.inks || []).map(i => (
          <div key={i.name} className="flex items-center gap-2 text-xs"><span className="w-3.5 h-3.5 rounded-sm border border-gray-300" style={{ background: i.hex }} />{i.name}{i.spot && <span className="text-[10px] text-gray-400">spot</span>}</div>
        )) : <p className="text-[11px] text-gray-400">None yet — import or draw artwork.</p>}
        <p className="text-[10px] text-gray-400">Name a spot colour in the Fill picker (e.g. PANTONE 16-6444 TCX) and it appears here automatically.</p>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onRefresh} className="flex-1 text-xs border border-gray-300 rounded py-2 hover:bg-gray-50"><i className="ti ti-refresh" /> Refresh from ERP</button>
        <button onClick={onDownload} disabled={busy} className="flex-1 text-xs bg-[#3B6FE0] text-white rounded py-2 hover:bg-[#2f5bc0] disabled:opacity-50"><i className="ti ti-file-type-pdf" /> {busy ? 'Building…' : 'Proof PDF'}</button>
      </div>
    </div>
  )
}
