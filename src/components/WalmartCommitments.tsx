'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Walmart stock vs. pending POs — display only. Nothing here blocks shipping.
 *   Total stock  = logged-not-released + On hand (released + building) + Built
 *   Committed    = cases on every open Walmart PO (not Shipped / Cancelled)
 *   Uncommitted  = Total − Committed   (negative = short → needs production)
 * When a PO ships it drops out of Committed and its cases drop out of Built, so both update on their own.
 * Data: inventory_commitments() + walmart_open_po_fulfillment().
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

const NAMES: Record<string, string> = {
  '22GVA24': 'Assorted 24', '22GVA48': 'Assorted 48', '22GVF24': 'Fork 24', '22GVF48': 'Fork 48',
  '22GVK48': 'Knife 48', '22GVS24': 'Spoon 24', '22GVS48': 'Spoon 48',
}
const nm = (s: string) => NAMES[s] || s
const n0 = (v: any) => Number(v || 0)
const f = (v: any) => n0(v).toLocaleString()
const day = (d?: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
const STATUS: Record<string, { bg: string; fg: string }> = {
  Built: { bg: '#DCFCE7', fg: '#15803D' }, Building: { bg: '#DBEAFE', fg: '#1D4ED8' }, Released: { bg: '#E0E7FF', fg: '#4338CA' },
  'Covered by free stock': { bg: '#FEF9C3', fg: '#A16207' }, Short: { bg: '#FEE2E2', fg: '#B91C1C' },
}

export interface CommitRow { sku: string; total_stock: number; committed: number; uncommitted: number; open_orders: number; free_stock: number | null; on_hand: number | null; built: number | null; covered: number | null; short: number; source: string }

export async function loadCommitments(sb: any): Promise<Record<string, CommitRow>> {
  const { data } = await sb.rpc('inventory_commitments')
  const out: Record<string, CommitRow> = {}
  for (const r of (data as any[]) || []) out[String(r.sku).toUpperCase()] = r
  return out
}

export default function WalmartCommitments({ sb, sku: startSku = '', asModal = false, onClose }: { sb: any; sku?: string; asModal?: boolean; onClose?: () => void }) {
  const [sum, setSum] = useState<CommitRow[]>([])
  const [pos, setPos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sku, setSku] = useState(startSku)
  const [onlyShort, setOnlyShort] = useState(false)
  const [showPos, setShowPos] = useState(asModal)

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([sb.rpc('inventory_commitments'), sb.rpc('walmart_open_po_fulfillment')])
    setSum(((c.data as any[]) || []).filter(r => r.source === 'walmart_board').sort((a, b) => a.sku.localeCompare(b.sku)))
    setPos((p.data as any[]) || [])
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = sb.channel('wm-commit-' + Math.random().toString(36).slice(2))
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 700) }
    for (const tb of ['walmart_board_orders', 'walmart_board_lines', 'walmart_releases', 'walmart_production_entries']) ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump)
    ch.subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load])

  const tot = useMemo(() => sum.reduce((a, r) => ({ stock: a.stock + n0(r.total_stock), com: a.com + n0(r.committed), short: a.short + n0(r.short) }), { stock: 0, com: 0, short: 0 }), [sum])
  const rows = useMemo(() => pos
    .filter(r => !sku || r.sku === sku)
    .filter(r => !onlyShort || n0(r.short) > 0)
    .sort((a, b) => String(a.ship_due_date || '9999').localeCompare(String(b.ship_due_date || '9999')) || String(a.po_number).localeCompare(String(b.po_number)) || a.sku.localeCompare(b.sku)),
  [pos, sku, onlyShort])

  function csv() {
    const head = ['PO', 'Status on board', 'Ship due', 'Load', 'SKU', 'Item', 'Ordered', 'Released', 'Building', 'Built', 'From free stock', 'Short', 'Fulfillment']
    const body = rows.map(r => [r.po_number, r.group_name, r.ship_due_date || '', r.load_number || '', r.sku, nm(r.sku), r.ordered, r.released, r.building, r.built, r.from_free_stock, r.short, r.status])
    const sumHead = ['SKU', 'Item', 'Total stock', 'Committed to open POs', 'Uncommitted (− = short)', 'Open POs']
    const sumBody = sum.map(r => [r.sku, nm(r.sku), r.total_stock, r.committed, r.uncommitted, r.open_orders])
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const txt = [sumHead, ...sumBody, [], head, ...body].map(r => r.map(esc).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' }))
    a.download = `walmart-commitments-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  const body = (
    <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[#F0F2F6] flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <p className="font-bold text-[#1A1D2E] text-sm">Walmart stock vs. pending POs</p>
          <p className="text-[11px] text-gray-500">For planning only — this never blocks shipping. Updates by itself when POs move, release, build or ship.</p>
        </div>
        <button onClick={csv} className="h-8 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>Export CSV</button>
        {asModal && onClose && <button onClick={onClose} className="text-gray-400 text-2xl leading-none px-2" aria-label="Close">&times;</button>}
      </div>

      <div className="grid grid-cols-3 gap-2 px-4 pt-3">
        <Kpi label="Total stock" v={tot.stock} sub="free + on hand + built" />
        <Kpi label="Committed to open POs" v={tot.com} sub={`${new Set(pos.map(p => p.order_id)).size} open POs`} />
        <Kpi label={tot.stock - tot.com < 0 ? 'Short — still to make' : 'Uncommitted'} v={tot.stock - tot.com} red={tot.stock - tot.com < 0} />
      </div>

      <div className="overflow-x-auto px-4 py-3">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-right">
            <th className="text-left py-1.5">Item</th><th className="py-1.5" title="Logged by production but not released to a PO yet">Free</th><th className="py-1.5" title="Released + being built">On hand</th><th className="py-1.5">Built</th>
            <th className="py-1.5">Total</th><th className="py-1.5">Committed</th><th className="py-1.5">Uncommitted / Short</th><th className="py-1.5">Open POs</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="py-4 text-center text-gray-400">Loading…</td></tr>}
            {sum.map(r => {
              const u = n0(r.uncommitted); const sel = sku === r.sku
              return (
                <tr key={r.sku} onClick={() => { setSku(sel ? '' : r.sku); setShowPos(true) }} className={`border-t border-[#F0F2F6] text-right cursor-pointer ${sel ? 'bg-[#F2F6FF]' : 'hover:bg-[#FAFBFD]'}`}>
                  <td className="text-left py-2"><b className="text-[#1A1D2E]">{nm(r.sku)}</b> <span className="font-mono text-[10px] text-gray-400">{r.sku}</span></td>
                  <td>{f(r.free_stock)}</td>
                  <td>{f(r.on_hand)}</td>
                  <td>{f(r.built)}</td>
                  <td className="font-semibold">{f(r.total_stock)}</td>
                  <td>{f(r.committed)}</td>
                  <td className={`font-bold ${u < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{u < 0 ? `Short ${f(-u)}` : f(u)}</td>
                  <td>{f(r.open_orders)}</td>
                </tr>)
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[#F0F2F6]">
        <button onClick={() => setShowPos(s => !s)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm" data-ro-ok>
          <span className="font-semibold text-[#1A1D2E]">Pending POs — fulfillment status{sku ? ` · ${nm(sku)}` : ''}</span>
          <span className="text-xs text-gray-400">{showPos ? 'Hide' : 'Show'}</span>
        </button>
        {showPos && <div className="px-4 pb-4">
          <div className="flex flex-wrap items-center gap-3 mb-2 text-xs">
            <select value={sku} onChange={e => setSku(e.target.value)} className="h-8 border border-[#E4E6EE] rounded-lg px-2" data-ro-ok>
              <option value="">All items</option>{Object.keys(NAMES).map(k => <option key={k} value={k}>{nm(k)}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-gray-600"><input type="checkbox" checked={onlyShort} onChange={e => setOnlyShort(e.target.checked)} data-ro-ok /> Only short</label>
            <span className="text-gray-400">Earliest ship date gets free stock first.</span>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-[13px] min-w-[760px]">
              <thead className="sticky top-0 bg-white"><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-right">
                <th className="text-left py-1.5">PO</th><th className="text-left">Board</th><th className="text-left">Ship due</th><th className="text-left">Item</th>
                <th>Ordered</th><th>Released</th><th>Building</th><th>Built</th><th>Short</th><th className="text-left pl-3">Status</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && !loading && <tr><td colSpan={10} className="py-4 text-center text-gray-400">No pending POs{onlyShort ? ' that are short' : ''}.</td></tr>}
                {rows.map(r => { const st = STATUS[r.status] || STATUS.Short
                  return (
                    <tr key={r.order_id + r.sku} className="border-t border-[#F0F2F6] text-right">
                      <td className="text-left py-1.5 font-mono text-[12px]">{r.po_number || r.order_name}</td>
                      <td className="text-left text-gray-500 text-[12px]">{r.group_name}</td>
                      <td className="text-left text-gray-500 text-[12px]">{day(r.ship_due_date)}{r.load_number ? <span className="text-gray-400"> · L{r.load_number}</span> : null}</td>
                      <td className="text-left">{nm(r.sku)}</td>
                      <td className="font-semibold">{f(r.ordered)}</td>
                      <td className="text-gray-500">{n0(r.released) ? f(r.released) : '—'}</td>
                      <td className="text-gray-500">{n0(r.building) ? f(r.building) : '—'}</td>
                      <td className="text-gray-500">{n0(r.built) ? f(r.built) : '—'}</td>
                      <td className={n0(r.short) ? 'font-bold text-red-600' : 'text-gray-300'}>{n0(r.short) ? f(r.short) : '—'}</td>
                      <td className="text-left pl-3"><span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: st.bg, color: st.fg }}>{r.status}{n0(r.from_free_stock) && r.status === 'Short' ? ` (${f(r.from_free_stock)} from stock)` : ''}</span></td>
                    </tr>)
                })}
              </tbody>
            </table>
          </div>
        </div>}
      </div>
    </div>
  )

  if (!asModal) return body
  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-5xl" onClick={e => e.stopPropagation()}>{body}</div>
    </div>, document.body)
}

function Kpi({ label, v, sub, red }: { label: string; v: number; sub?: string; red?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${red ? 'bg-red-50 border-red-200' : 'bg-[#FAFBFD] border-[#ECEEF3]'}`}>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-xl font-extrabold leading-tight ${red ? 'text-red-600' : 'text-[#1A1D2E]'}`}>{red ? f(-v) : f(v)}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  )
}
