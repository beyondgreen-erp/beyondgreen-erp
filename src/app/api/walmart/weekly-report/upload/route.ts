/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { requireUser, isResp } from '../_auth'
import { ITEM_SKU, SKUS, Sku } from '@/lib/walmartWeekly/types'
import { fiscalWeek, orderDateForAbs } from '@/lib/walmartWeekly/weeks'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isSku = (s: any): s is Sku => (SKUS as readonly string[]).includes(String(s))
const num = (v: any) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : 0 }
const toIso = (v: any): string | null => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null }
  const s = String(v || '').trim(); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/+(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

// kind=forecast: Walmart "Sales and Order Forecast" workbook (Order Forecast sheet)
// kind=plan: comp-store supply plan CSV (ORDER_WK, WM_YEAR, Order_Qty) applied to the chosen SKUs
// kind=history: WM Ordered vs Ship workbook (all monthly tabs) -> wm_po_history upsert
export async function POST(req: NextRequest) {
  const a = await requireUser(); if (isResp(a)) return a
  const sb = a.admin
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const kind = String(form.get('kind') || '')
    if (!file) return NextResponse.json({ error: 'No file received.' }, { status: 400 })
    const buf = Buffer.from(await file.arrayBuffer())

    if (kind === 'forecast') {
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
      const sheet = wb.Sheets['Order Forecast'] || wb.Sheets[wb.SheetNames.find(n => /order/i.test(n)) || wb.SheetNames[0]]
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null })
      const agg = new Map<string, number>()
      let runDate: string | null = null
      for (const r of rows) {
        const item = num(r.prime_item_number ?? r['Prime Item Number'])
        const sku = ITEM_SKU[item]; const d = toIso(r.order_place_dt ?? r['Order Place Date'])
        if (!sku || !d) continue
        const k = `${d}|${sku}`; agg.set(k, (agg.get(k) || 0) + num(r.order_each_quantity ?? r['Order Each Quantity']))
      }
      if (!agg.size) return NextResponse.json({ error: 'No forecast rows found. Expected the "Order Forecast" sheet with prime_item_number, order_place_dt and order_each_quantity.' }, { status: 400 })
      const meta = wb.Sheets['metadata'] ? XLSX.utils.sheet_to_json<any>(wb.Sheets['metadata'], { header: 1 }) : []
      for (const row of meta) for (const cell of row as any[]) { const d = toIso(cell); if (d && !runDate && /\d{1,2}\/\d{1,2}\/\d{4}/.test(String(cell))) runDate = d }
      const { data: prev } = await sb.from('wm_forecast_batches').select('plan, manual').order('uploaded_at', { ascending: false }).limit(1)
      const { data: batch, error } = await sb.from('wm_forecast_batches').insert({ name: file.name.replace(/\.[^.]+$/, ''), forecast_run_date: runDate, uploaded_by: a.email, plan: prev?.[0]?.plan || {}, manual: prev?.[0]?.manual || {} }).select('id').single()
      if (error) throw new Error(error.message)
      const ins = Array.from(agg.entries()).map(([k, qty]) => { const [order_date, sku] = k.split('|'); return { batch_id: batch.id, order_date, sku, qty } })
      for (let i = 0; i < ins.length; i += 500) { const { error: e2 } = await sb.from('wm_forecast_rows').insert(ins.slice(i, i + 500)); if (e2) throw new Error(e2.message) }
      const dates = ins.map(x => x.order_date).sort()
      return NextResponse.json({ ok: true, rows: ins.length, first: dates[0], last: dates[dates.length - 1], runDate, carriedPlan: !!prev?.[0]?.plan && Object.keys(prev[0].plan).length > 0 })
    }

    if (kind === 'plan') {
      const skus = String(form.get('skus') || '').split(',').map(s => s.trim()).filter(isSku)
      if (!skus.length) return NextResponse.json({ error: 'Pick at least one item for the plan.' }, { status: 400 })
      const text = buf.toString('utf8')
      const wb = XLSX.read(text, { type: 'string' })
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
      const plan: Record<string, number> = {}
      for (const r of rows) {
        const wk = num(r.ORDER_WK ?? r.order_wk ?? r.Week); const yr = num(r.WM_YEAR ?? r.wm_year ?? r.Year); const q = num(r.Order_Qty ?? r.order_qty ?? r.Units ?? r.Qty)
        if (!wk || !q) continue
        const fy = yr < 100 ? 2000 + yr : yr           // WM_YEAR 26 = calendar 2026 weeks, 27 = 2027
        const abs = fy <= 2026 ? wk : wk + 52 * (fy - 2026)
        plan[String(abs)] = q
      }
      if (!Object.keys(plan).length) return NextResponse.json({ error: 'No plan rows found. Expected ORDER_WK, WM_YEAR and Order_Qty columns.' }, { status: 400 })
      const { data: b } = await sb.from('wm_forecast_batches').select('id, plan, manual').order('uploaded_at', { ascending: false }).limit(1)
      if (!b?.[0]) return NextResponse.json({ error: 'Upload the Walmart order forecast first, then the plan.' }, { status: 400 })
      const planAll = { ...(b[0].plan || {}) }
      for (const s of skus) planAll[s] = plan
      let manual = { ...(b[0].manual || {}) }
      const manualQty = num(form.get('manualQty')); const manualDate = String(form.get('manualDate') || '')
      if (manualQty && /^\d{4}-\d{2}-\d{2}$/.test(manualDate)) { manual[manualDate] = { ...(manual[manualDate] || {}) }; for (const s of skus) manual[manualDate][s] = manualQty }
      if (String(form.get('clearManual')) === 'true') manual = {}
      const { error } = await sb.from('wm_forecast_batches').update({ plan: planAll, manual }).eq('id', b[0].id)
      if (error) throw new Error(error.message)
      const firstAbs = Math.min(...Object.keys(plan).map(Number))
      return NextResponse.json({ ok: true, skus, weeks: Object.keys(plan).length, total: Object.values(plan).reduce((x, y) => x + y, 0), firstOrder: orderDateForAbs(firstAbs), manual })
    }

    if (kind === 'history') {
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
      const col: Record<Sku, number> = { '22GVS24': 9, '22GVS48': 12, '22GVF24': 15, '22GVA24': 18, '22GVA48': 21, '22GVF48': 24, '22GVK48': 27 }
      const out = new Map<string, any>()
      const today = new Date().toISOString().slice(0, 10)
      for (const name of wb.SheetNames) {
        if (!/\d{4}/.test(name) && !/pivot/i.test(name)) continue
        if (/pivot/i.test(name)) continue
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
        const hdr = (rows[0] || []).map((x: any) => String(x || '').trim().toLowerCase())
        if (!hdr.includes('po#') && !hdr.includes('po #')) continue
        for (const r of rows.slice(1)) {
          const po = String(r[1] || '').trim(); const od = toIso(r[5])
          if (!po || !od || !/^\d{6,}$/.test(po)) continue
          const srp: Record<string, number> = {}
          for (const k of SKUS) { const v = num(r[col[k]]); if (v) srp[k] = v }
          const units = Object.values(srp).reduce((x, y) => x + y, 0) * 6
          const sd = toIso(r[2]); const shipped = !!(sd && sd <= today)
          out.set(po, { po_number: po, order_date: od, wm_wk_ordered: fiscalWeek(od).abs, ship_date: sd, wm_wk_shipped: shipped ? fiscalWeek(sd!).abs : null, mabd: toIso(r[6]), load_number: r[8] != null ? String(r[8]).trim() : null, comment: r[7] != null ? String(r[7]).trim() : null, srp, units_ordered: units, units_shipped: shipped ? units : 0, source: file.name, updated_at: new Date().toISOString() })
        }
      }
      const list = Array.from(out.values())
      if (!list.length) return NextResponse.json({ error: 'No PO rows found. Expected the WM Ordered vs Ship report with monthly tabs.' }, { status: 400 })
      for (let i = 0; i < list.length; i += 300) { const { error } = await sb.from('wm_po_history').upsert(list.slice(i, i + 300), { onConflict: 'po_number' }); if (error) throw new Error(error.message) }
      const dates = list.map(x => x.order_date).sort()
      return NextResponse.json({ ok: true, pos: list.length, first: dates[0], last: dates[dates.length - 1] })
    }
    return NextResponse.json({ error: 'Unknown upload kind.' }, { status: 400 })
  } catch (e) {
    console.error('[walmart weekly] upload', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
