'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'

// Public, no-login routing page behind the pallet-label QR. Shows ONLY where the load
// ships from and where it's going — read live from the order. No ERP, no account, no other data.
export default function ShipDocsPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token as string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/ship-docs/${token}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Not found'); setLoading(false); return }
      setData(json)
    } catch {
      setError('Could not load this shipment.')
    }
    setLoading(false)
  }, [token])

  useEffect(() => { if (token) load() }, [token, load])

  const card: CSSProperties = { background: '#171b2e', border: '1px solid #262b45', borderRadius: 16, padding: '18px 20px', marginTop: 12 }
  const eyebrow: CSSProperties = { fontSize: 12, color: '#9aa4bf', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1220', color: '#fff', fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif', padding: '22px 16px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#2E8B57', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>bG</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>beyondGREEN · Shipment</div>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9aa4bf' }}>Loading…</div>}

        {!loading && error && (
          <div style={{ background: '#2a1620', border: '1px solid #6b2537', borderRadius: 14, padding: 20, textAlign: 'center', marginTop: 12 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>&#9888;&#65039;</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{error}</div>
            <div style={{ color: '#9aa4bf', fontSize: 13 }}>This code may be out of date or not yet issued.</div>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {(data.orderNumber || data.poNumber) && (
              <div style={{ ...card, background: 'transparent', border: 'none', padding: '4px 2px', marginTop: 10 }}>
                {data.orderNumber && <div style={{ fontSize: 17, fontWeight: 700 }}>{data.orderNumber}</div>}
                {data.poNumber && <div style={{ fontSize: 13, color: '#9aa4bf', marginTop: 2 }}>PO #{data.poNumber}</div>}
              </div>
            )}

            <div style={card}>
              <div style={eyebrow}><span>&#128666;</span> Ship from</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{data.shipFrom?.name}</div>
              <div style={{ fontSize: 14, color: '#c7cee0', marginTop: 3, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{data.shipFrom?.address}</div>
            </div>

            <div style={{ textAlign: 'center', color: '#5b647f', fontSize: 22, margin: '2px 0 -6px' }}>&#8595;</div>

            <div style={{ ...card, borderColor: '#2E8B57' }}>
              <div style={eyebrow}><span>&#127919;</span> Ship to</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{data.shipTo?.name}</div>
              <div style={{ fontSize: 14, color: '#c7cee0', marginTop: 3, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{data.shipTo?.address || '—'}</div>
            </div>

            <div style={{ textAlign: 'center', color: '#5b647f', fontSize: 11, marginTop: 18 }}>
              Routing for this load only. No account required.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
