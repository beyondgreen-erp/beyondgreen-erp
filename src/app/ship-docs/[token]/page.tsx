'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'
import { buildBOL, buildPackingList } from '@/lib/shipping/bol'

export default function ShipDocsPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token as string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [docs, setDocs] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/ship-docs/${token}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Not found'); setLoading(false); return }
      setOrderNumber(json.orderNumber || '')
      setDocs(json.docs)
    } catch {
      setError('Could not load documents.')
    }
    setLoading(false)
  }, [token])

  useEffect(() => { if (token) load() }, [token, load])

  function openPackingSlip() {
    if (!docs?.packing) return
    const p = docs.packing
    try { buildPackingList(p.meta, p.cases, p.totals, null).save(`packing-list-${orderNumber || 'order'}.pdf`) } catch { /* */ }
  }
  function openBol() {
    if (!docs?.bol) return
    try { buildBOL(docs.bol.data, docs.bol.lines, null).save(`bol-${orderNumber || 'order'}.pdf`) } catch { /* */ }
  }

  const btn: CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#171b2e', border: '1px solid #2b3150', borderRadius: 14, padding: '18px 18px',
    color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 12,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1220', color: '#fff', fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif', padding: '22px 16px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#3B6FE0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>bG</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>beyondGREEN · Shipping Documents</div>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#9aa4bf' }}>Loading documents…</div>}

        {!loading && error && (
          <div style={{ background: '#2a1620', border: '1px solid #6b2537', borderRadius: 14, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{error}</div>
            <div style={{ color: '#9aa4bf', fontSize: 13 }}>This code may be out of date, or the documents haven’t been generated yet.</div>
          </div>
        )}

        {!loading && !error && docs && (
          <>
            <div style={{ background: '#171b2e', border: '1px solid #262b45', borderRadius: 16, padding: '16px 18px' }}>
              <div style={{ fontSize: 12, color: '#9aa4bf', textTransform: 'uppercase', letterSpacing: '.6px' }}>Order</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{orderNumber}</div>
              {docs.customer && <div style={{ fontSize: 13, color: '#c7cee0', marginTop: 2 }}>{docs.customer}</div>}
            </div>

            <button onClick={openPackingSlip} style={btn}>
              <span>📋 Packing Slip</span>
              <span style={{ color: '#5fe0a8', fontSize: 13 }}>Download →</span>
            </button>

            {docs.bol ? (
              <button onClick={openBol} style={btn}>
                <span>📄 Bill of Lading</span>
                <span style={{ color: '#5fe0a8', fontSize: 13 }}>Download →</span>
              </button>
            ) : (
              <div style={{ ...btn, cursor: 'default', color: '#7f8aa6' }}>
                <span>📄 Bill of Lading</span>
                <span style={{ fontSize: 13 }}>Not finalized</span>
              </div>
            )}

            <div style={{ textAlign: 'center', color: '#5b647f', fontSize: 11, marginTop: 16 }}>
              Shipping documents for this load. No account required.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
