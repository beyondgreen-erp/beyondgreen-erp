'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface CaseRow { sku: string; description: string | null; total_cases: number; units_in_case: number }
interface Pallet { pallet_number: number; total_pallets: number; sscc: string | null; case_count: number | null; built_at: string | null; built_by: string | null }
interface OrderInfo { order_number: string | null; notes: string | null }

function customerFromOrder(o: OrderInfo | null): string {
  if (!o) return ''
  const s = o.notes ?? o.order_number ?? ''
  return s.split('|')[0].trim()
}

export default function PickTicketPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token as string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pallet, setPallet] = useState<Pallet | null>(null)
  const [cases, setCases] = useState<CaseRow[]>([])
  const [order, setOrder] = useState<OrderInfo | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/pick/${token}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Not found'); setLoading(false); return }
      setPallet(json.pallet); setCases(json.cases || []); setOrder(json.order)
      if (json.pallet?.built_at) setDone(true)
    } catch {
      setError('Could not load this pick ticket.')
    }
    setLoading(false)
  }, [token])

  useEffect(() => { if (token) load() }, [token, load])

  async function confirm() {
    setConfirming(true)
    try {
      const res = await fetch(`/api/pick/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Confirm failed'); setConfirming(false); return }
      setDone(true)
      await load()
    } catch {
      setError('Confirm failed. Check your connection and try again.')
    }
    setConfirming(false)
  }

  const totalUnits = cases.reduce((s, c) => s + (Number(c.total_cases) || 0) * (Number(c.units_in_case) || 0), 0)

  return (
    <div style={{ minHeight: '100vh', background: '#0f1220', color: '#fff', fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif', padding: '20px 16px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#3B6FE0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>bG</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>beyondGREEN · Pallet Build</div>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9aa4bf' }}>Loading pick ticket…</div>}

        {!loading && error && (
          <div style={{ background: '#2a1620', border: '1px solid #6b2537', borderRadius: 14, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{error}</div>
            <div style={{ color: '#9aa4bf', fontSize: 13 }}>This QR code may be out of date or the pallet was removed.</div>
          </div>
        )}

        {!loading && !error && pallet && (
          <>
            <div style={{ background: '#171b2e', border: '1px solid #262b45', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ background: done ? '#0f2e1e' : '#111', padding: '16px 18px', borderBottom: '1px solid #262b45' }}>
                <div style={{ fontSize: 12, color: '#9aa4bf', textTransform: 'uppercase', letterSpacing: '.6px' }}>Pallet</div>
                <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{pallet.pallet_number} <span style={{ color: '#9aa4bf', fontWeight: 600, fontSize: 18 }}>of {pallet.total_pallets}</span></div>
                <div style={{ fontSize: 12, color: '#9aa4bf', marginTop: 4, fontFamily: 'ui-monospace,monospace' }}>{pallet.sscc}</div>
              </div>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #262b45' }}>
                <div style={{ fontSize: 13, color: '#c7cee0' }}>{customerFromOrder(order)}</div>
                <div style={{ fontSize: 12, color: '#7f8aa6', fontFamily: 'ui-monospace,monospace', marginTop: 2 }}>{order?.order_number}</div>
              </div>
              <div style={{ padding: '8px 8px 4px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 60px', gap: 6, padding: '6px 10px', fontSize: 10, color: '#7f8aa6', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  <span>SKU</span><span style={{ textAlign: 'right' }}>Cases</span><span style={{ textAlign: 'right' }}>Units</span>
                </div>
                {cases.map((c, i) => {
                  const u = (Number(c.total_cases) || 0) * (Number(c.units_in_case) || 0)
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 52px 60px', gap: 6, padding: '9px 10px', fontSize: 13, borderTop: '1px solid #20263f', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, color: '#5fe0a8' }}>{c.sku}</span>
                      <span style={{ textAlign: 'right', color: '#c7cee0' }}>{c.total_cases}</span>
                      <span style={{ textAlign: 'right', fontWeight: 700 }}>{u}</span>
                    </div>
                  )
                })}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 60px', gap: 6, padding: '10px', fontSize: 13, borderTop: '2px solid #333b5c', fontWeight: 800 }}>
                  <span>TOTAL</span><span style={{ textAlign: 'right' }}>{pallet.case_count ?? cases.reduce((s, c) => s + (Number(c.total_cases) || 0), 0)}</span><span style={{ textAlign: 'right' }}>{totalUnits}</span>
                </div>
              </div>
            </div>

            {done ? (
              <div style={{ marginTop: 16, background: '#0f2e1e', border: '1px solid #1f6b45', borderRadius: 14, padding: 18, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 6 }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Pallet marked complete</div>
                <div style={{ color: '#9aa4bf', fontSize: 13, marginTop: 4 }}>
                  {pallet.built_at ? `Confirmed ${new Date(pallet.built_at).toLocaleString()}` : 'These quantities have been added to the order’s completed count.'}
                </div>
              </div>
            ) : (
              <button
                onClick={confirm}
                disabled={confirming}
                style={{ marginTop: 16, width: '100%', background: confirming ? '#26407a' : '#2f7d4f', color: '#fff', border: 'none', borderRadius: 14, padding: '18px', fontSize: 17, fontWeight: 800, cursor: 'pointer' }}
              >
                {confirming ? 'Confirming…' : 'Confirm Pallet Completed'}
              </button>
            )}
            <div style={{ textAlign: 'center', color: '#5b647f', fontSize: 11, marginTop: 14 }}>
              Scanning updates the completed quantity on this order in the ERP.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
