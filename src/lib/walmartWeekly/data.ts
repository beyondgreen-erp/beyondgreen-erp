/* eslint-disable @typescript-eslint/no-explicit-any */
// Pulls everything the weekly report needs out of Supabase and merges the ERP Walmart
// board (live status, loads, pickup dates, SRP by SKU) with wm_po_history (MABDs, comments
// and the POs from before the board existed).
import { SupabaseClient } from '@supabase/supabase-js'
import { BySku, PoRow, SKUS, Settings, Sku, zeroBySku } from './types'
import { fiscalWeek } from './weeks'

export const DEFAULT_SETTINGS: Settings = {
  usw: { '22GVS24': 17.15, '22GVS48': 10.3, '22GVF24': 17.12, '22GVA24': 7.46, '22GVA48': 7.26, '22GVF48': 10.71, '22GVK48': 4.81 },
  stores: { base: 221, comp48: 702, comp24: 1500 },
  storeGroup: { '22GVS24': 'comp24', '22GVS48': 'comp48', '22GVF24': 'comp24', '22GVA24': 'base', '22GVA48': 'base', '22GVF48': 'comp48', '22GVK48': 'base' },
  resetDate: '2027-06-19',
  recipients: { to: ['Cora Cochran <cora@ivcsr.com>', 'Manish Prajapati <manish@beyondgreenbiotech.com>'], cc: ['Veejay Patell <veejay.patell@byndgrn.com>', 'Shea Finn <shea@beyondgreenbiotech.com>', 'Link Robinson <link@ivcsr.com>'] },
  certifications: [
    { name: 'USDA BioPreferred', status: 'registration complete, awaiting the final certification confirmation' },
    { name: 'Made in California', status: 'certification received' },
    { name: 'CMA', status: 'cutlery submitted, in process' },
    { name: 'BPI Home and TÜV AUSTRIA', status: 'in process, following the TÜV Rheinland home composting approval' },
  ],
  srpOnOrder: { '22GVS24': 25176, '22GVS48': 28028, '22GVF24': 28535, '22GVA24': 38285, '22GVA48': 29548, '22GVF48': 35746, '22GVK48': 0 },
  srpPoNote: 'PO 203110',
  unitPkgOnOrder: zeroBySku(),
  unitPkgNote: '',
  palletSrp: { '22GVS24': 312, '22GVS48': 120, '22GVF24': 260, '22GVA24': 234, '22GVA48': 165, '22GVF48': 120, '22GVK48': 260 },
  greeting: 'Hi Cora,',
  programName: 'Great Value compostable cutlery program',
}

export async function loadSettings(sb: SupabaseClient): Promise<Settings> {
  const { data } = await sb.from('wm_weekly_settings').select('data').eq('id', 1).maybeSingle()
  const d = (data?.data || {}) as Partial<Settings>
  return {
    ...DEFAULT_SETTINGS, ...d,
    usw: { ...DEFAULT_SETTINGS.usw, ...(d.usw || {}) },
    stores: { ...DEFAULT_SETTINGS.stores, ...(d.stores || {}) },
    storeGroup: { ...DEFAULT_SETTINGS.storeGroup, ...(d.storeGroup || {}) },
    recipients: { ...DEFAULT_SETTINGS.recipients, ...(d.recipients || {}) },
    srpOnOrder: { ...zeroBySku(), ...(d.srpOnOrder || DEFAULT_SETTINGS.srpOnOrder) },
    unitPkgOnOrder: { ...zeroBySku(), ...(d.unitPkgOnOrder || {}) },
    palletSrp: { ...DEFAULT_SETTINGS.palletSrp, ...(d.palletSrp || {}) },
    certifications: d.certifications || DEFAULT_SETTINGS.certifications,
  }
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const isSku = (s: any): s is Sku => (SKUS as readonly string[]).includes(String(s))

// All Walmart POs ordered on/after `fromDate`, merged from the board and the history table.
export async function loadPos(sb: SupabaseClient, fromDate: string, reportDate: string): Promise<PoRow[]> {
  const [{ data: orders }, { data: hist }] = await Promise.all([
    sb.from('walmart_board_orders').select('id, po_number, status, group_name, order_date, ship_due_date, bol_date, load_number, pallets, plan_pallets, units, srp, archived, special_instructions').gte('order_date', fromDate).not('po_number', 'is', null),
    sb.from('wm_po_history').select('*').gte('order_date', fromDate),
  ])
  const orderIds = (orders || []).map((o: any) => o.id)
  const lines: any[] = []
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await sb.from('walmart_board_lines').select('order_id, part_number, qty').in('order_id', orderIds.slice(i, i + 200))
    lines.push(...(data || []))
  }
  const linesByOrder = new Map<string, any[]>()
  for (const l of lines) { if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []); linesByOrder.get(l.order_id)!.push(l) }
  const histBy = new Map<string, any>()
  for (const h of hist || []) histBy.set(String(h.po_number).trim(), h)

  const out = new Map<string, PoRow>()
  for (const o of orders || []) {
    if (o.archived) continue
    const isCancelled = /cancel/i.test(o.group_name || '') || /cancel/i.test(o.status || '')
    if (isCancelled && !histBy.has(String(o.po_number).trim())) continue
    const po = String(o.po_number).trim()
    const srp = zeroBySku()
    for (const l of linesByOrder.get(o.id) || []) if (isSku(l.part_number)) srp[l.part_number as Sku] += num(l.qty)
    const h = histBy.get(po)
    if (Object.values(srp).every(v => v === 0) && h?.srp) for (const k of SKUS) srp[k] = num(h.srp[k])
    const shipped = /shipped/i.test(o.status || '') || /shipped/i.test(o.group_name || '')
    const shipDate = (shipped && o.bol_date) ? o.bol_date : (h?.ship_date && h.ship_date <= reportDate ? h.ship_date : null)
    const loadRaw = (o.load_number || h?.load_number || '') as string
    const rerouting = /cancel/i.test(loadRaw)
    const load = rerouting ? loadRaw.replace(/\s*cancell?ed.*$/i, '').trim() : (/pending|not assigned|^$/i.test(loadRaw) ? null : loadRaw.trim())
    const units = Object.values(srp).reduce((a, b) => a + b, 0) * 6
    const wk = fiscalWeek(o.order_date)
    out.set(po, {
      po, orderDate: o.order_date, wkOrdered: wk.abs, fy: wk.fy,
      shipDate: shipped ? (o.bol_date || shipDate) : null, shipped: !!(shipped || (shipDate && shipDate <= reportDate)),
      pickupDate: rerouting ? null : (o.ship_due_date || null), mabd: h?.mabd || null, load,
      comment: [rerouting ? 'Load cancelled, pending rerouting' : null, h?.comment || null].filter(Boolean).join('; ') || null,
      status: rerouting ? 'Rerouting' : (o.status || null), pallets: o.pallets ? num(o.pallets) : (o.plan_pallets ?? null),
      srp, units, unitsShipped: (shipped || (shipDate && shipDate <= reportDate)) ? units : 0, source: h ? 'both' : 'board',
    })
  }
  for (const h of hist || []) {
    const po = String(h.po_number).trim()
    if (out.has(po)) continue
    const srp = zeroBySku(); for (const k of SKUS) srp[k] = num(h.srp?.[k])
    const units = Object.values(srp).reduce((a, b) => a + b, 0) * 6
    const shipped = !!(h.ship_date && h.ship_date <= reportDate)
    const wk = fiscalWeek(h.order_date)
    out.set(po, { po, orderDate: h.order_date, wkOrdered: wk.abs, fy: wk.fy, shipDate: shipped ? h.ship_date : null, shipped, pickupDate: !shipped ? h.ship_date : null, mabd: h.mabd || null, load: h.load_number && !/not assigned/i.test(h.load_number) ? h.load_number : null, comment: h.comment || null, status: shipped ? 'Shipped' : (h.ship_date ? 'Scheduled' : 'Not scheduled'), pallets: null, srp, units, unitsShipped: shipped ? units : 0, source: 'history' })
  }
  return Array.from(out.values()).sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.po.localeCompare(b.po))
}

export async function loadProduction(sb: SupabaseClient, from: string, to: string): Promise<{ date: string; sku: Sku; srp: number }[]> {
  const { data } = await sb.from('walmart_production_entries').select('production_date, sku, qty, voided_at').gte('production_date', from).lte('production_date', to).is('voided_at', null)
  const agg = new Map<string, number>()
  for (const r of data || []) { if (!isSku(r.sku)) continue; const k = r.production_date + '|' + r.sku; agg.set(k, (agg.get(k) || 0) + num(r.qty)) }
  return Array.from(agg.entries()).map(([k, srp]) => { const [date, sku] = k.split('|'); return { date, sku: sku as Sku, srp } }).sort((a, b) => a.date.localeCompare(b.date))
}

// Latest inventory snapshot on or before the date: Unit Packaging (-P), SRPs (-SI), finished goods.
export async function loadInventory(sb: SupabaseClient, asOf: string): Promise<{ asOf: string; unit: BySku; srp: BySku; fg: BySku }> {
  const { data: last } = await sb.from('inventory_snapshots').select('snapshot_date').eq('scope', 'product').lte('snapshot_date', asOf).order('snapshot_date', { ascending: false }).limit(1)
  const d = last?.[0]?.snapshot_date || asOf
  const { data } = await sb.from('inventory_snapshots').select('sku, on_hand_qty').eq('scope', 'product').eq('snapshot_date', d).like('sku', '22GV%')
  const unit = zeroBySku(), srp = zeroBySku(), fg = zeroBySku()
  for (const r of data || []) {
    const s = String(r.sku)
    if (s.endsWith('-P') && isSku(s.slice(0, -2))) unit[s.slice(0, -2) as Sku] = num(r.on_hand_qty)
    else if (s.endsWith('-SI') && isSku(s.slice(0, -3))) srp[s.slice(0, -3) as Sku] = num(r.on_hand_qty)
    else if (isSku(s)) fg[s as Sku] = num(r.on_hand_qty)
  }
  return { asOf: d, unit, srp, fg }
}

export interface ForecastBatch { id: string; name: string | null; forecast_run_date: string | null; plan: Record<string, Record<string, number>>; manual: Record<string, Partial<BySku>>; rows: { order_date: string; sku: Sku; qty: number }[] }
export async function loadForecast(sb: SupabaseClient): Promise<ForecastBatch | null> {
  const { data: b } = await sb.from('wm_forecast_batches').select('*').order('uploaded_at', { ascending: false }).limit(1)
  const batch = b?.[0]; if (!batch) return null
  const { data: rows } = await sb.from('wm_forecast_rows').select('order_date, sku, qty').eq('batch_id', batch.id)
  return { id: batch.id, name: batch.name, forecast_run_date: batch.forecast_run_date, plan: batch.plan || {}, manual: batch.manual || {}, rows: (rows || []).filter((r: any) => isSku(r.sku)).map((r: any) => ({ order_date: r.order_date, sku: r.sku as Sku, qty: num(r.qty) })) }
}

export async function loadPriorReport(sb: SupabaseClient, before: string): Promise<{ report_date: string; results: any } | null> {
  const { data } = await sb.from('wm_weekly_reports').select('report_date, results').lt('report_date', before).order('report_date', { ascending: false }).limit(1)
  return data?.[0] || null
}
