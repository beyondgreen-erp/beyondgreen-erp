'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// "Add to quote / estimate" from the Pricing Calculator. Writes one quotation line (and a new
// quote when asked). Never touches product prices.
import { useEffect, useMemo, useState } from 'react'
import { EDITABLE_QUOTE_STATUSES, insertQuotationWithNumber, newQuoteDefaults, recomputeQuoteTotals } from '@/lib/quoteCreate'
import { piecesPerStockUnit } from '@/lib/pricingCalc'

const ACCENT = '#1F9A3A'
const inp = 'w-full h-10 bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const r2 = (v: number) => Math.round(v * 100) / 100
const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 ? 5 : 2 })

export interface PriceOption { key: string; label: string; perPiece: number }
interface QuoteRow { id: string; quote_number: string; status: string; customer_id: string | null; doc_style: string | null }
interface PackOption { key: string; label: string; uom: string; pieces: number; isCase: boolean; desc: string | null }

export default function AddToQuote({ sb, product, prices, packs, onClose }: {
  sb: any
  product: any
  prices: PriceOption[]
  packs: number[]
  onClose: () => void
}) {
  const stockUom = (product.unit_of_measure || 'EA').toUpperCase()
  const perStock = piecesPerStockUnit(product)
  const ppp = Number(product.pieces_per_pack) > 0 ? Number(product.pieces_per_pack) : 0
  const ppc = Number(product.packs_per_case) > 0 ? Number(product.packs_per_case) : 0
  const caseKnown = ppp > 0 && ppc > 0
  const pcsPerCase = caseKnown ? ppp * ppc : 0

  const packOptions = useMemo<PackOption[]>(() => {
    const out: PackOption[] = []
    const stockIsCase = stockUom === 'CASE'
    out.push({
      key: 'stock', uom: stockIsCase ? 'CASE' : stockUom, pieces: perStock.pieces, isCase: stockIsCase,
      label: `Stock unit: 1 ${stockUom}${perStock.pieces !== 1 ? ` (${perStock.pieces.toLocaleString('en-US')} pc)` : ''}`, desc: null,
    })
    if (caseKnown && !stockIsCase) out.push({ key: 'case', uom: 'CASE', pieces: pcsPerCase, isCase: true, label: `Case (${pcsPerCase.toLocaleString('en-US')} pc)`, desc: null })
    for (const s of packs) {
      if (s === perStock.pieces || (caseKnown && s === pcsPerCase)) continue
      out.push({ key: 'p' + s, uom: 'PKS', pieces: s, isCase: false, label: `Pack of ${s.toLocaleString('en-US')} pc`, desc: `Pack of ${s.toLocaleString('en-US')} pieces` })
    }
    return out
  }, [stockUom, perStock.pieces, caseKnown, pcsPerCase, packs])

  const [priceKey, setPriceKey] = useState(prices.find(p => p.perPiece > 0)?.key || prices[0]?.key || '')
  const [packKey, setPackKey] = useState('stock')
  const [qty, setQty] = useState('1')
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [qSearch, setQSearch] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<{ id: string; company_name: string }[]>([])
  const [cust, setCust] = useState<{ id: string; company_name: string } | null>(null)
  const [docStyle, setDocStyle] = useState<'estimate' | 'official'>('estimate')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ id: string; num: string } | null>(null)

  useEffect(() => {
    (async () => {
      const { data } = await sb.from('quotations').select('id, quote_number, status, customer_id, doc_style, type')
        .in('status', EDITABLE_QUOTE_STATUSES).order('created_at', { ascending: false }).limit(500)
      const rows = ((data as any[]) || []).filter(q => (q.type || 'quote') === 'quote') as QuoteRow[]
      setQuotes(rows)
      const ids = [...new Set(rows.map(r => r.customer_id).filter(Boolean) as string[])]
      const nm: Record<string, string> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const { data: cs } = await sb.from('customers').select('id, company_name').in('id', ids.slice(i, i + 200))
        for (const c of (cs as any[]) || []) nm[c.id] = c.company_name || ''
      }
      setNames(nm)
    })()
  }, [sb])

  useEffect(() => {
    const t = custSearch.trim()
    if (t.length < 2 || (cust && cust.company_name === t)) { setCustResults([]); return }
    const h = setTimeout(async () => {
      const { data } = await sb.from('customers').select('id, company_name').ilike('company_name', `%${t}%`).order('company_name').limit(10)
      setCustResults((data as any[]) || [])
    }, 200)
    return () => clearTimeout(h)
  }, [custSearch, cust, sb])

  const quoteMatches = useMemo(() => {
    const t = qSearch.trim().toLowerCase()
    return quotes.filter(q => !t || (q.quote_number || '').toLowerCase().includes(t) || (names[q.customer_id || ''] || '').toLowerCase().includes(t)).slice(0, 50)
  }, [quotes, names, qSearch])

  const price = prices.find(p => p.key === priceKey)
  const pack = packOptions.find(p => p.key === packKey) || packOptions[0]
  const q = parseFloat(qty) || 0
  const unitAmount = price ? price.perPiece * pack.pieces : 0          // price for one of the chosen unit
  const lineTotal = r2(unitAmount * q)

  async function add() {
    setErr('')
    if (!price || !(price.perPiece > 0)) { setErr('Pick a price that is set above zero.'); return }
    if (!(q > 0)) { setErr('Enter a quantity.'); return }
    if (pack.key === 'stock' && !perStock.known) { setErr(`Cannot size the stock unit: ${perStock.note}`); return }
    setBusy(true)
    let id = quoteId, num = quotes.find(x => x.id === quoteId)?.quote_number || ''
    if (mode === 'existing' && !id) { setErr('Pick a quote.'); setBusy(false); return }
    if (mode === 'new') {
      if (!cust) { setErr('Pick the customer.'); setBusy(false); return }
      const created = await insertQuotationWithNumber(sb, { ...newQuoteDefaults(), customer_id: cust.id, doc_style: docStyle })
      if ('error' in created) { setErr('Could not create the quote: ' + created.error); setBusy(false); return }
      id = created.id; num = created.quote_number
    }
    // Next line number on this quote.
    const { data: existing } = await sb.from('quotation_lines').select('line_number').or(`quotation_id.eq.${id},quote_id.eq.${id}`)
    const lineNo = (((existing as any[]) || []).reduce((m, l) => Math.max(m, Number(l.line_number) || 0), 0)) + 1
    // Case lines carry the case price with unit_price per piece, as the Quotations page does
    // (its line total is case_price x quantity). Other lines are priced per unit of quantity.
    const caseLine = pack.isCase && pack.pieces > 0
    const row: Record<string, any> = {
      quotation_id: id,
      quote_id: id,
      line_number: lineNo,
      product_id: product.id,
      sku: product.sku,
      product_name: product.product_name || product.sku,
      description: [pack.desc, `${price.label} price`].filter(Boolean).join(' · '),
      quantity: q,
      qty: q,
      unit_of_measure: pack.uom,
      unit_price: caseLine ? r4(unitAmount / pack.pieces) : r4(unitAmount),
      case_price: caseLine ? r4(unitAmount) : null,
      pcs_per_case: caseLine ? pack.pieces : null,
      line_total: r2(r4(unitAmount) * q),
    }
    const { error } = await sb.from('quotation_lines').insert(row)
    if (error) { setErr('Could not add the line: ' + error.message); setBusy(false); return }
    const tot = await recomputeQuoteTotals(sb, id)
    setBusy(false)
    if ('error' in tot) { setErr('Line added, but totals did not update: ' + tot.error) }
    setDone({ id, num })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div><h2 className="text-lg font-bold text-gray-900">Add to quote / estimate</h2><p className="text-xs text-gray-500 mt-0.5">{product.sku} · {product.product_name}</p></div>
          <button data-ro-ok onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {done ? (
          <div className="p-6 space-y-4">
            <p className="text-sm rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">Added to {done.num}. Product prices were not changed.</p>
            {err && <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">{err}</p>}
            <div className="flex justify-end gap-2">
              <button data-ro-ok onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 text-sm text-gray-600">Close</button>
              <a href={`/sales/quotations?item=${done.id}`} className="h-10 px-5 rounded-lg text-white text-sm font-bold inline-flex items-center" style={{ background: ACCENT }}>Open {done.num} ↗</a>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="block text-xs font-semibold text-gray-500 mb-1">Price</span>
                  <select value={priceKey} onChange={e => setPriceKey(e.target.value)} className={inp}>
                    {prices.map(p => <option key={p.key} value={p.key}>{p.label} ({money(p.perPiece)}/pc)</option>)}
                  </select></label>
                <label className="block"><span className="block text-xs font-semibold text-gray-500 mb-1">Sold by</span>
                  <select value={packKey} onChange={e => setPackKey(e.target.value)} className={inp}>
                    {packOptions.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select></label>
                <label className="block"><span className="block text-xs font-semibold text-gray-500 mb-1">Quantity ({pack.uom})</span>
                  <input type="number" min="0" step="1" value={qty} onChange={e => setQty(e.target.value)} className={inp} /></label>
                <div className="text-sm pt-5">
                  <p className="text-gray-500 text-xs">{money(unitAmount)} per {pack.uom}</p>
                  <p className="font-bold text-[#1A1D2E]">Line total {money(lineTotal)}</p>
                </div>
              </div>

              <div className="border-t border-[#F0F2F6] pt-3">
                <div className="flex gap-1.5 mb-3">
                  {(['existing', 'new'] as const).map(m => (
                    <button key={m} data-ro-ok onClick={() => setMode(m)} className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${mode === m ? 'text-white' : 'border-[#E4E6EE] text-gray-600'}`} style={mode === m ? { background: ACCENT, borderColor: ACCENT } : undefined}>
                      {m === 'existing' ? 'Existing quote' : 'New quote'}
                    </button>))}
                </div>
                {mode === 'existing' ? (
                  <>
                    <input value={qSearch} onChange={e => setQSearch(e.target.value)} placeholder="Search quote # or customer…" className={inp} />
                    <div className="mt-2 max-h-52 overflow-y-auto border border-[#E4E6EE] rounded-lg">
                      {quoteMatches.length === 0 ? <p className="text-xs text-gray-400 px-3 py-3">No open quotes match (Draft, Sent or Accepted).</p> : quoteMatches.map(x => (
                        <button key={x.id} data-ro-ok onClick={() => setQuoteId(x.id)} className={`w-full text-left px-3 py-2 border-b border-[#F0F2F6] last:border-0 text-sm ${quoteId === x.id ? 'bg-emerald-50' : 'hover:bg-[#F5F6FA]'}`}>
                          <span className="font-semibold text-[#3B6FE0]">{x.quote_number}</span>
                          <span className="text-gray-500"> · {names[x.customer_id || ''] || 'No customer'}</span>
                          <span className="ml-1.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-[#EEF2FB] text-[#3A4A6B]">{x.status}{x.doc_style === 'estimate' ? ' · Estimate' : ''}</span>
                        </button>))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="relative">
                      <span className="block text-xs font-semibold text-gray-500 mb-1">Customer</span>
                      <input value={custSearch} onChange={e => { setCustSearch(e.target.value); setCust(null) }} placeholder="Start typing a customer…" className={inp} />
                      {custResults.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-[#E4E6EE] rounded-lg shadow-lg">
                          {custResults.map(c => <button key={c.id} data-ro-ok onClick={() => { setCust(c); setCustSearch(c.company_name); setCustResults([]) }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F5F6FA]">{c.company_name}</button>)}
                        </div>)}
                      {cust && <span className="block text-[11px] text-emerald-700 mt-1">Customer selected.</span>}
                    </div>
                    <label className="block"><span className="block text-xs font-semibold text-gray-500 mb-1">Document</span>
                      <select value={docStyle} onChange={e => setDocStyle(e.target.value as any)} className={inp}>
                        <option value="estimate">Estimate</option><option value="official">Official Quote</option>
                      </select></label>
                    <p className="text-[11px] text-gray-400">Created as a Draft with the next quote number, Net 30, valid 30 days.</p>
                  </div>
                )}
              </div>
              {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button data-ro-ok onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 text-sm text-gray-600">Cancel</button>
              <button onClick={add} disabled={busy} className="h-10 px-5 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: ACCENT }}>{busy ? 'Adding…' : 'Add line'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
