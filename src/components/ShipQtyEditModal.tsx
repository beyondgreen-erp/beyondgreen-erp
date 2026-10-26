'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Edit the ship quantity of an order line — allowed even after the order shipped.
 * A reason is required; the change is written to the order's History (activity_log) by
 * so_line_set_ship_qty, which also keeps the Walmart board line in step and, for a shipped
 * order, can correct inventory by the difference.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props { sb: any; line: any; shipmentId?: string | null; shipped: boolean; orderLabel?: string; onClose: () => void; onSaved: (msg: string) => void }

export default function ShipQtyEditModal({ sb, line, shipmentId, shipped, orderLabel, onClose, onSaved }: Props) {
  const cur = Number(line.quantity ?? line.qty ?? 0) || 0
  const [qty, setQty] = useState(String(cur))
  const [reason, setReason] = useState('')
  const [fixInv, setFixInv] = useState(true)
  const [taken, setTaken] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!shipped || !shipmentId || !line.sku) return
    sb.from('inventory_movements').select('qty').eq('ref_table', 'shipments').eq('ref_id', shipmentId).eq('movement_type', 'ship').ilike('sku', line.sku)
      .then(({ data }: any) => setTaken(-((data as any[]) || []).reduce((s, m) => s + Number(m.qty || 0), 0)))
  }, [sb, shipped, shipmentId, line.sku])

  const n = Number(qty)
  const valid = qty.trim() !== '' && Number.isFinite(n) && n >= 0
  const invDelta = taken == null || !valid ? null : taken - n
  async function save() {
    setErr('')
    if (!valid) { setErr('Enter a ship quantity of 0 or more.'); return }
    if (reason.trim().length < 3) { setErr('Please give a reason for the change.'); return }
    if (n === cur && !(shipped && fixInv && invDelta)) { setErr('The quantity is unchanged.'); return }
    setBusy(true)
    const { data, error } = await sb.rpc('so_line_set_ship_qty', { p_line: line.id, p_qty: n, p_reason: reason.trim(), p_fix_inventory: shipped ? fixInv : false })
    setBusy(false)
    if (error) { setErr(error.message); return }
    const d = Number((data as any)?.inventory_delta || 0)
    onSaved(`✓ ${line.sku || 'Line'} ship qty ${cur} → ${n}${d ? ` · inventory ${d > 0 ? '+' : ''}${d}` : ''}. Logged in History.`)
  }

  const inp = 'w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#ECEEF3]">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Edit ship quantity{orderLabel ? ` · ${orderLabel}` : ''}</p>
          <h3 className="font-bold text-[#1A1D2E]"><span className="font-mono">{line.sku || '—'}</span> <span className="text-sm font-normal text-gray-500">{line.description || ''}</span></h3>
          {shipped && <p className="mt-1 text-[11px] font-semibold text-amber-700">This order already shipped — the change is allowed and recorded in History.</p>}
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Current ship qty</label><p className="h-10 flex items-center font-semibold">{cur}</p></div>
            <div><label className="block text-xs text-gray-500 mb-1">New ship qty</label><input autoFocus type="number" min={0} value={qty} onChange={e => setQty(e.target.value)} className={inp} /></div>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Reason <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="e.g. Load shipped 60 short — Walmart received 3" className={inp + ' resize-none'} /></div>
          {shipped && shipmentId && <label className="flex items-start gap-2 text-[13px] rounded-lg bg-[#F5F8FF] border border-[#DCE6FA] px-3 py-2">
            <input type="checkbox" checked={fixInv} onChange={e => setFixInv(e.target.checked)} className="mt-0.5" />
            <span>Correct inventory for the difference{taken != null && <span className="block text-[12px] text-gray-500">
              The shipment took {taken} out of on-hand. {invDelta == null ? '' : invDelta === 0 ? 'No inventory change needed.' : invDelta > 0 ? `${invDelta} will go back on hand.` : `${-invDelta} more will come off on-hand.`}</span>}</span>
          </label>}
          <p className="text-[11px] text-gray-400">Billing is not changed automatically — if an invoice already went out, update it to match.</p>
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-[#ECEEF3] flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="text-sm font-semibold rounded-lg px-3 py-2 border border-[#E4E6EE] text-gray-600">Cancel</button>
          <button onClick={save} disabled={busy} className="text-sm font-semibold rounded-lg px-4 py-2 text-white bg-blue-600 disabled:opacity-50">{busy ? 'Saving…' : 'Save change'}</button>
        </div>
      </div>
    </div>, document.body)
}
