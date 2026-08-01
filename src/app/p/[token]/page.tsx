'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'

const fmtN = (n: any) => Number(n || 0).toLocaleString()

export default function PalletScanPage({ params }: { params: { token: string } }) {
  const token = params.token
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sku, setSku] = useState('')
  const [qty, setQty] = useState('')
  const [by, setBy] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/wp/${token}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Not found'); setData(null) }
      else setData(j)
    } catch { setErr('Network error') }
    setLoading(false)
  }, [token])
  useEffect(() => { load() }, [load])

  async function post(payload: any) {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/wp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, by }) })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Failed'); }
      else setData(j)
    } catch { setErr('Network error') }
    setBusy(false)
  }

  async function addItem() {
    if (!sku.trim() || !Number(qty)) { setErr('Pick a SKU and enter a quantity.'); return }
    await post({ action: 'add_item', sku: sku.trim(), qty: Number(qty) })
    setSku(''); setQty('')
  }

  const wrap: React.CSSProperties = { fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', background: '#0f1420', minHeight: '100vh', color: '#fff', padding: '18px 14px' }
  const card: React.CSSProperties = { background: '#fff', color: '#111', borderRadius: 16, padding: 18, maxWidth: 480, margin: '0 auto' }

  if (loading) return <div style={wrap}><div style={card}>Loading…</div></div>
  if (!data) return <div style={wrap}><div style={card}><h2 style={{ margin: 0 }}>Pallet not found</h2><p style={{ color: '#666' }}>{err || 'This QR code is not valid.'}</p></div></div>

  const { pallet, order, items, skus } = data
  const done = pallet.status === 'complete'
  const total = (items as any[]).reduce((a, it) => a + Number(it.qty || 0), 0)

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 480, margin: '0 auto 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, opacity: 0.7, letterSpacing: 0.5 }}>beyondGREEN · Pallet Build</div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>Pallet #{pallet.pallet_number} of {pallet.total_pallets}</div>
        <div style={{ fontSize: 14, opacity: 0.85, marginTop: 2 }}>{order?.name || '—'}</div>
        {order?.po_number && <div style={{ fontSize: 13, opacity: 0.7 }}>PO {order.po_number}{order?.load_number ? ` · Load ${order.load_number}` : ''}</div>}
      </div>

      <div style={card}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h2 style={{ margin: '6px 0' }}>Pallet complete</h2>
            <p style={{ color: '#666', margin: 0, fontSize: 14 }}>Logged {(items as any[]).length} SKU(s), {fmtN(total)} SRPs total. Inventory has been updated.</p>
          </div>
        ) : (
          <>
            <label style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666' }}>Your name (optional)</label>
            <input value={by} onChange={e => setBy(e.target.value)} placeholder="e.g. Maria"
              style={{ width: '100%', padding: '10px 12px', fontSize: 16, border: '1px solid #ddd', borderRadius: 10, margin: '4px 0 14px', boxSizing: 'border-box' }} />

            <label style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666' }}>SKU on this pallet</label>
            <input list="pallet-skus" value={sku} onChange={e => setSku(e.target.value)} placeholder="Scan or pick SKU"
              style={{ width: '100%', padding: '10px 12px', fontSize: 16, border: '1px solid #ddd', borderRadius: 10, margin: '4px 0 10px', boxSizing: 'border-box' }} />
            <datalist id="pallet-skus">{(skus as string[]).map(s => <option key={s} value={s} />)}</datalist>

            <label style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666' }}>Quantity (SRPs)</label>
            <input type="number" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} placeholder="0"
              style={{ width: '100%', padding: '10px 12px', fontSize: 16, border: '1px solid #ddd', borderRadius: 10, margin: '4px 0 12px', boxSizing: 'border-box' }} />

            <button onClick={addItem} disabled={busy}
              style={{ width: '100%', padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: '#0086C0', border: 'none', borderRadius: 12, opacity: busy ? 0.6 : 1 }}>
              ＋ Add to pallet
            </button>
          </>
        )}

        {err && <p style={{ color: '#c0392b', fontSize: 13, marginTop: 10 }}>{err}</p>}

        {(items as any[]).length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', marginBottom: 6 }}>On this pallet</div>
            {(items as any[]).map((it) => (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #eee' }}>
                <div><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0F7A4E' }}>{it.sku}</span> <span style={{ color: '#555' }}>× {fmtN(it.qty)} SRPs</span></div>
                {!done && <button onClick={() => post({ action: 'remove_item', itemId: it.id })} disabled={busy} style={{ background: 'none', border: 'none', color: '#c0392b', fontSize: 20, lineHeight: 1 }}>×</button>}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '2px solid #111', marginTop: 4, fontWeight: 800 }}>
              <span>Total</span><span>{fmtN(total)} SRPs</span>
            </div>
          </div>
        )}

        {!done && (items as any[]).length > 0 && (
          <button onClick={() => { if (confirm(`Complete Pallet #${pallet.pallet_number}? This logs the contents and deducts inventory.`)) post({ action: 'complete' }) }} disabled={busy}
            style={{ width: '100%', padding: '14px', fontSize: 16, fontWeight: 800, color: '#fff', background: '#00A84F', border: 'none', borderRadius: 12, marginTop: 16, opacity: busy ? 0.6 : 1 }}>
            ✓ Complete Pallet #{pallet.pallet_number}
          </button>
        )}
      </div>
    </div>
  )
}
