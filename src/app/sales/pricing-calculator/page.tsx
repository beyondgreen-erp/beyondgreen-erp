'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
// Pricing Calculator: replaces the May 2019 pricing workbook. Pick a product, set the per-piece
// Distribution and Wholesale prices, and see every pack size at both prices with the 40% sales
// commission on profit, MAP / MSRP, and the private label volume tiers. Costs come from the ERP.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { usePermissions } from '@/lib/permissions'
import {
  costPerPiece, piecesPerStockUnit, stockToPiece, pieceToStock, packRow, privateLabelTiers,
  mapPerPiece, defaultPackSizes, priceLogLine, type PackRow,
} from '@/lib/pricingCalc'

const BOARD = '/sales/pricing-calculator'
const ACCENT = '#1F9A3A'
const FINISHED = ['finished goods', 'finished products', 'bags', 'wraps', 'molded fiber']

interface Product {
  id: string; sku: string; product_name: string | null; category: string | null; product_size: string | null
  unit_of_measure: string | null; unit_cost: number | null; case_cost: number | null
  pieces_per_pack: number | null; packs_per_case: number | null; cases_per_pallet: number | null; case_qty: number | null
  distribution_price: number | null; wholesale_price: number | null; map_price: number | null; msrp: number | null; unit_price: number | null
}
const COLS = 'id, sku, product_name, category, product_size, unit_of_measure, unit_cost, case_cost, pieces_per_pack, packs_per_case, cases_per_pallet, case_qty, distribution_price, wholesale_price, map_price, msrp, unit_price'

const isFinished = (p: Product) => FINISHED.includes((p.category || '').trim().toLowerCase())
const n = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }
const has = (s: string) => s.trim() !== '' && Number.isFinite(parseFloat(s))
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
const str = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '' : String(r6(v))
function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-'
  const a = Math.abs(v)
  const s = a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: a < 1 ? 5 : 2 })
  return (v < 0 ? '-$' : '$') + s
}
const pct = (v: number | null) => v == null ? '-' : (v * 100).toFixed(1) + '%'
const neg = (v: number) => v < -1e-12 ? 'text-red-600 font-semibold' : ''

const inp = 'w-full h-10 bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const card = 'bg-white rounded-2xl shadow-sm border border-[#ECEEF3]'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  )
}

function PackTable({ title, sub, rows, commPct }: { title: string; sub: string; rows: PackRow[]; commPct: number }) {
  const lines: [string, (r: PackRow) => string, (r: PackRow) => string][] = [
    ['Price', r => money(r.price), () => ''],
    ['Cost', r => money(r.cost), () => ''],
    ['Profit', r => money(r.profit), r => neg(r.profit)],
    [`Commission (${commPct}%)`, r => money(r.commission), () => ''],
    ['beyondGREEN Profit', r => money(r.bgProfit), r => neg(r.bgProfit) || 'font-semibold text-[#037f4c]'],
    ['Margin', r => pct(r.marginPct), r => neg(r.profit)],
    ['bG Margin', r => pct(r.bgMarginPct), r => neg(r.bgProfit)],
  ]
  return (
    <div className={card + ' overflow-hidden'}>
      <div className="px-4 py-3" style={{ borderLeft: '5px solid ' + ACCENT }}>
        <p className="font-bold text-[#1A1D2E]">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
      <div className="overflow-x-auto border-t border-[#F0F2F6]">
        <table className="w-full text-sm">
          <thead><tr className="text-[10px] uppercase text-gray-400 bg-[#FAFBFD]">
            <th className="text-left px-4 py-2">Per</th>
            {rows.map((r, i) => <th key={i} className="text-right px-3 py-2 whitespace-nowrap">{i === 0 ? '1 piece' : `${r.pieces.toLocaleString('en-US')} pack`}</th>)}
          </tr></thead>
          <tbody>
            {lines.map(([label, val, cls]) => (
              <tr key={label} className="border-t border-[#F0F2F6]">
                <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{label}</td>
                {rows.map((r, i) => <td key={i} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${cls(r)}`}>{val(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function PricingCalculatorPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const perms = usePermissions()
  const canEdit = (perms.canEdit(BOARD) || perms.canEdit('/sales/inventory')) && perms.access?.can_write !== false
  const [me, setMe] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [q, setQ] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedId, setPickedId] = useState<string | null>(null)

  const [costOverride, setCostOverride] = useState('')
  const [dist, setDist] = useState('')
  const [whole, setWhole] = useState('')
  const [mapMult, setMapMult] = useState('2')
  const [commPct, setCommPct] = useState('40')
  const [msrp, setMsrp] = useState('')
  const [packs, setPacks] = useState<number[]>([])
  const [newPack, setNewPack] = useState('')
  const [plBase, setPlBase] = useState('')
  const [m1, setM1] = useState('15')
  const [m2, setM2] = useState('35')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('')
    const all: Product[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('products').select(COLS).eq('is_active', true).order('sku').range(from, from + 999)
      if (error) { setLoadErr(error.message); break }
      const batch = (data as any as Product[]) || []
      all.push(...batch)
      if (batch.length < 1000) break
    }
    all.sort((a, b) => (isFinished(a) ? 0 : 1) - (isFinished(b) ? 0 : 1) || a.sku.localeCompare(b.sku))
    setProducts(all)
    setLoading(false)
    return all
  }, [sb])

  const P = useMemo(() => products.find(p => p.id === pickedId) || null, [products, pickedId])

  const pick = useCallback((p: Product) => {
    setPickedId(p.id); setQ(''); setPickerOpen(false); setMsg(null); setCostOverride('')
    const ppp = Number(p.pieces_per_pack) > 0 ? Number(p.pieces_per_pack) : 1
    const d = stockToPiece(p.distribution_price, p)
    const w = stockToPiece(p.wholesale_price, p)
    setDist(str(d)); setWhole(str(w))
    setMapMult(p.map_price != null && Number(p.wholesale_price) > 0 ? str(Number(p.map_price) / Number(p.wholesale_price)) : '2')
    const ms = stockToPiece(p.msrp, p)
    setMsrp(ms != null ? str(ms * ppp) : '')
    setPlBase(str(d ?? w))
    setPacks(defaultPackSizes(p))
    try { const u = new URL(window.location.href); u.searchParams.set('sku', p.sku); window.history.replaceState(null, '', u.toString()) } catch { /* */ }
  }, [])

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setMe(data.user?.email || ''))
    load().then(all => {
      let sku = ''
      try { sku = new URLSearchParams(window.location.search).get('sku') || '' } catch { /* */ }
      if (!sku) return
      const hit = all.find(p => p.sku.toLowerCase() === sku.toLowerCase())
      if (hit) pick(hit)
      else setMsg({ ok: false, text: `No active product with SKU "${sku}".` })
    })
  }, [sb, load, pick])

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = t ? products.filter(p => p.sku.toLowerCase().includes(t) || (p.product_name || '').toLowerCase().includes(t)) : products
    return list.slice(0, 40)
  }, [products, q])

  const siblings = useMemo(() => {
    if (!P) return []
    const size = (P.product_size || '').trim().toLowerCase()
    if (!size) return []
    return products.filter(p => p.id !== P.id && (p.product_size || '').trim().toLowerCase() === size
      && Number(p.pieces_per_pack) > 0 && (P.category || '') === (p.category || ''))
  }, [P, products])

  // ── derived numbers ──
  const ladder = P ? piecesPerStockUnit(P) : null
  const baseCost = P ? costPerPiece(P) : null
  const cost = has(costOverride) ? n(costOverride) : (baseCost?.value ?? 0)
  const comm = n(commPct)
  const distPc = n(dist), wholePc = n(whole)
  const mapPc = mapPerPiece(wholePc, has(mapMult) ? n(mapMult) : 2)
  const ownPack = P && Number(P.pieces_per_pack) > 0 ? Number(P.pieces_per_pack) : 1
  const msrpPc = has(msrp) ? n(msrp) / ownPack : null
  const sizes = [1, ...packs]
  const distRows = sizes.map(s => packRow(s, distPc, cost, comm))
  const wholeRows = sizes.map(s => packRow(s, wholePc, cost, comm))
  const tiers = privateLabelTiers(n(plBase), cost, comm, [n(m1) / 100, n(m2) / 100])
  const uom = (P?.unit_of_measure || 'EA').toUpperCase()

  // Prefilled prices that sit far from cost are probably stored in a different unit.
  const suspect = P && baseCost && baseCost.value > 0 && [stockToPiece(P.distribution_price, P), stockToPiece(P.wholesale_price, P)]
    .some(v => v != null && v > 0 && (v / baseCost.value > 15 || v / baseCost.value < 0.4))

  function addPack(v: number) {
    if (!(v > 0)) return
    setPacks(ps => ps.includes(v) ? ps : [...ps, v].sort((a, b) => a - b))
  }

  async function save() {
    if (!P || !ladder) return
    if (!ladder.known) { setMsg({ ok: false, text: `Cannot convert to ${uom}: ${ladder.note} Fix the pack/case counts on the product first.` }); return }
    setSaving(true); setMsg(null)
    const payload: Record<string, any> = {
      distribution_price: has(dist) ? r6(pieceToStock(distPc, P)) : null,
      wholesale_price: has(whole) ? r6(pieceToStock(wholePc, P)) : null,
      map_price: has(whole) ? r6(pieceToStock(mapPc, P)) : null,
      msrp: msrpPc != null ? r6(pieceToStock(msrpPc, P)) : null,
    }
    const { data: cur } = await sb.from('products').select('modification_log').eq('id', P.id).maybeSingle()
    const today = new Date().toLocaleDateString('en-CA')
    const prev = String((cur as any)?.modification_log || '').trim()
    payload.modification_log = (prev ? prev + '\n' : '') + priceLogLine(today, me)
    const { data, error } = await sb.from('products').update(payload).eq('id', P.id).select('id')
    setSaving(false)
    if (error) { setMsg({ ok: false, text: 'Could not save: ' + error.message }); return }
    if (!data || !data.length) { setMsg({ ok: false, text: 'Not saved: you do not have write access right now.' }); return }
    setProducts(ps => ps.map(p => p.id === P.id ? { ...p, ...payload } : p))
    setMsg({ ok: true, text: `Saved to ${P.sku} (per ${uom}).` })
  }

  return (
    <div className="min-h-screen mon-page py-4 sm:py-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
        <div>
          <span className="mon-tag" style={{ background: ACCENT + '1f', color: ACCENT }}>Sales · Pricing</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Pricing Calculator</h1>
          <p className="text-gray-500 text-sm mt-0.5">Pick a product, set per-piece prices, and see every pack size at Distribution and Wholesale with sales commission on profit.</p>
        </div>
        {P && <a href={`/sales/inventory?item=${P.id}`} className="text-xs font-semibold rounded-lg px-3 py-2 border border-[#E4E6EE] text-gray-600 bg-white self-start sm:self-auto">Open product ↗</a>}
      </div>

      {loadErr && <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">Could not load products: {loadErr}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-4 items-start">
        {/* ── inputs ── */}
        <div className="space-y-4">
          <div className={card + ' p-4'}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Product</p>
            <div className="relative">
              <input value={q} onChange={e => { setQ(e.target.value); setPickerOpen(true) }} onFocus={() => setPickerOpen(true)}
                onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                placeholder={loading ? 'Loading products…' : 'Search by SKU or name…'} className={inp} />
              {pickerOpen && !loading && (
                <div className="absolute z-30 left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-white border border-[#E4E6EE] rounded-xl shadow-lg">
                  {matches.length === 0 ? <p className="text-sm text-gray-400 px-3 py-3">No active products match.</p> : matches.map(p => (
                    <button key={p.id} data-ro-ok onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}
                      className="w-full text-left px-3 py-2 hover:bg-[#F5F6FA] border-b border-[#F0F2F6] last:border-0">
                      <span className="font-mono text-xs font-semibold text-[#1A1D2E]">{p.sku}</span>
                      {isFinished(p) && <span className="ml-1.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-700">Finished</span>}
                      <span className="block text-xs text-gray-500 truncate">{p.product_name || ''}</span>
                    </button>))}
                </div>
              )}
            </div>
            {P ? (
              <div className="mt-3 text-sm">
                <p className="font-semibold text-[#1A1D2E]">{P.sku}</p>
                <p className="text-xs text-gray-500">{P.product_name}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                  <span>Stock unit</span><span className="text-right font-semibold">{uom}</span>
                  <span>Unit cost</span><span className="text-right font-semibold">{money(P.unit_cost)} / {uom}</span>
                  {P.case_cost != null && <><span>Case cost</span><span className="text-right">{money(P.case_cost)}</span></>}
                  <span>Pieces per pack</span><span className="text-right">{P.pieces_per_pack ?? '-'}</span>
                  <span>Packs per case</span><span className="text-right">{P.packs_per_case ?? '-'}</span>
                </div>
                {ladder && !ladder.known && <p className="mt-2 text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1.5">{ladder.note} Cost per piece falls back to the unit cost. Override it below.</p>}
              </div>
            ) : <p className="text-xs text-gray-400 mt-2">Finished goods are listed first.</p>}
          </div>

          {P && (
            <div className={card + ' p-4 space-y-3'}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Inputs (per piece)</p>
              <Field label="Cost per piece" hint={has(costOverride) ? `Override. ERP cost is ${money(baseCost?.value)} per piece.` : `From unit cost${ladder?.known && ladder.pieces !== 1 ? ` ÷ ${ladder.pieces.toLocaleString('en-US')} pieces per ${uom}` : ''}. Type to override.`}>
                <div className="flex gap-2">
                  <input type="number" step="0.00001" min="0" value={has(costOverride) ? costOverride : str(baseCost?.value)} onChange={e => setCostOverride(e.target.value)} className={inp} />
                  {has(costOverride) && <button data-ro-ok onClick={() => setCostOverride('')} className="h-10 px-3 rounded-lg border border-[#E4E6EE] text-xs text-gray-600 shrink-0">Reset</button>}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Distribution price"><input type="number" step="0.00001" min="0" value={dist} onChange={e => setDist(e.target.value)} placeholder="0.00" className={inp} /></Field>
                <Field label="Wholesale price"><input type="number" step="0.00001" min="0" value={whole} onChange={e => setWhole(e.target.value)} placeholder="0.00" className={inp} /></Field>
                <Field label="MAP multiplier" hint="MAP = Wholesale x this"><input type="number" step="0.1" min="0" value={mapMult} onChange={e => setMapMult(e.target.value)} className={inp} /></Field>
                <Field label="Commission %" hint="Paid on profit"><input type="number" step="1" min="0" max="100" value={commPct} onChange={e => setCommPct(e.target.value)} className={inp} /></Field>
              </div>
              <Field label={`MSRP per pack (${ownPack.toLocaleString('en-US')} pc)`}><input type="number" step="0.01" min="0" value={msrp} onChange={e => setMsrp(e.target.value)} placeholder="0.00" className={inp} /></Field>
              {suspect && <p className="text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1.5">The prices stored on this product are far from its cost once converted to per piece. They may have been entered in a different unit than {uom}. Check them before saving.</p>}

              <div className="border-t border-[#F0F2F6] pt-3">
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Pack sizes (pieces)</p>
                <div className="flex flex-wrap gap-1.5">
                  {packs.map(s => (
                    <span key={s} className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 bg-[#EEF2FB] text-[#3A4A6B]">
                      {s.toLocaleString('en-US')}
                      <button data-ro-ok onClick={() => setPacks(ps => ps.filter(x => x !== s))} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${s}`}>×</button>
                    </span>))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input type="number" min="1" step="1" value={newPack} onChange={e => setNewPack(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { addPack(Math.round(n(newPack))); setNewPack('') } }} placeholder="e.g. 90" className={inp} />
                  <button data-ro-ok onClick={() => { addPack(Math.round(n(newPack))); setNewPack('') }} className="h-10 px-4 rounded-lg border text-xs font-semibold shrink-0" style={{ borderColor: ACCENT, color: ACCENT }}>+ Add</button>
                </div>
                {siblings.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[11px] text-gray-400 mb-1">Sibling packs (same size):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {siblings.map(s => { const pc = Number(s.pieces_per_pack); const on = packs.includes(pc)
                        return <button key={s.id} data-ro-ok disabled={on} onClick={() => addPack(pc)} title={s.product_name || ''}
                          className={`text-[11px] rounded-full px-2 py-0.5 border ${on ? 'border-[#E4E6EE] text-gray-300' : 'border-[#D0D3E0] text-gray-600 hover:border-[#1F9A3A]'}`}>+ {pc.toLocaleString('en-US')} ({s.sku})</button> })}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-[#F0F2F6] pt-3">
                {canEdit ? (
                  <button onClick={save} disabled={saving} className="w-full h-11 rounded-xl text-white text-sm font-bold shadow-sm disabled:opacity-50" style={{ background: ACCENT }}>{saving ? 'Saving…' : 'Save prices to product'}</button>
                ) : <p className="text-xs text-gray-400">You have view-only access, so prices cannot be saved from here.</p>}
                <p className="text-[11px] text-gray-400 mt-1.5">Saves Distribution, Wholesale, MAP and MSRP on {P.sku} per {uom} (the stock unit, same as unit cost){ladder?.known && ladder.pieces !== 1 ? `: per-piece x ${ladder.pieces.toLocaleString('en-US')}` : ''}. Cost and on-hand are never changed.</p>
                {msg && <p className={`mt-2 text-sm rounded-lg px-3 py-2 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.text}</p>}
              </div>
            </div>
          )}
          {!P && msg && <p className="text-sm rounded-lg px-3 py-2 border bg-red-50 border-red-200 text-red-700">{msg.text}</p>}
        </div>

        {/* ── outputs ── */}
        {P ? (
          <div className="space-y-4 min-w-0">
            <PackTable title="Item at Distribution Price" sub={`${money(distPc)} per piece · cost ${money(cost)} per piece`} rows={distRows} commPct={comm} />
            <PackTable title="Item at Wholesale Price" sub={`${money(wholePc)} per piece · cost ${money(cost)} per piece`} rows={wholeRows} commPct={comm} />

            <div className={card + ' overflow-hidden'}>
              <div className="px-4 py-3" style={{ borderLeft: '5px solid ' + ACCENT }}>
                <p className="font-bold text-[#1A1D2E]">MAP and MSRP</p>
                <p className="text-xs text-gray-500 mt-0.5">MAP = Wholesale x {has(mapMult) ? n(mapMult) : 2}. MSRP is typed per {ownPack.toLocaleString('en-US')} pc pack; other packs are scaled per piece.</p>
              </div>
              <div className="overflow-x-auto border-t border-[#F0F2F6]">
                <table className="w-full text-sm">
                  <thead><tr className="text-[10px] uppercase text-gray-400 bg-[#FAFBFD]">
                    <th className="text-left px-4 py-2">Per</th>
                    {sizes.map((s, i) => <th key={i} className="text-right px-3 py-2 whitespace-nowrap">{i === 0 ? '1 piece' : `${s.toLocaleString('en-US')} pack`}</th>)}
                  </tr></thead>
                  <tbody>
                    <tr className="border-t border-[#F0F2F6]"><td className="px-4 py-2 text-gray-600">MAP</td>{sizes.map((s, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{money(mapPc * s)}</td>)}</tr>
                    <tr className="border-t border-[#F0F2F6]"><td className="px-4 py-2 text-gray-600">MSRP</td>{sizes.map((s, i) => <td key={i} className={`px-3 py-2 text-right tabular-nums ${s === ownPack ? 'font-semibold' : ''}`}>{msrpPc != null ? money(msrpPc * s) : '-'}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className={card + ' overflow-hidden'}>
              <div className="px-4 py-3 flex flex-wrap items-end justify-between gap-3" style={{ borderLeft: '5px solid ' + ACCENT }}>
                <div>
                  <p className="font-bold text-[#1A1D2E]">Private Label Pricing</p>
                  <p className="text-xs text-gray-500 mt-0.5">Base price per piece applies at 1M+ pieces. Smaller runs are marked up from the base.</p>
                </div>
                <div className="flex gap-2">
                  <label className="text-[11px] text-gray-500">Base / piece<input type="number" step="0.00001" min="0" value={plBase} onChange={e => setPlBase(e.target.value)} className={inp + ' w-28 h-9'} /></label>
                  <label className="text-[11px] text-gray-500">500K markup %<input type="number" step="1" value={m1} onChange={e => setM1(e.target.value)} className={inp + ' w-24 h-9'} /></label>
                  <label className="text-[11px] text-gray-500">50K markup %<input type="number" step="1" value={m2} onChange={e => setM2(e.target.value)} className={inp + ' w-24 h-9'} /></label>
                </div>
              </div>
              <div className="overflow-x-auto border-t border-[#F0F2F6]">
                <table className="w-full text-sm">
                  <thead><tr className="text-[10px] uppercase text-gray-400 bg-[#FAFBFD]">
                    <th className="text-left px-4 py-2">Volume</th><th className="text-right px-3 py-2">Price / piece</th><th className="text-right px-3 py-2">Profit / piece</th>
                    <th className="text-right px-3 py-2">Commission ({comm}%)</th><th className="text-right px-3 py-2">bG Profit / piece</th>
                  </tr></thead>
                  <tbody>
                    {tiers.map(t => (
                      <tr key={t.label} className="border-t border-[#F0F2F6]">
                        <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{t.label}{t.markup ? <span className="text-[11px] text-gray-400"> · +{(t.markup * 100).toFixed(0)}%</span> : null}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(t.pricePerPiece)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${neg(t.profitPerPiece)}`}>{money(t.profitPerPiece)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(t.commission)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${neg(t.bgProfit) || 'font-semibold text-[#037f4c]'}`}>{money(t.bgProfit)}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[11px] text-gray-400">Commission is {comm}% of profit and is not paid when profit is zero or negative. Negative profit is shown in red.</p>
          </div>
        ) : (
          <div className={card + ' p-10 text-center text-sm text-gray-400'}>{loading ? 'Loading…' : 'Pick a product to start.'}</div>
        )}
      </div>
    </div>
  )
}
