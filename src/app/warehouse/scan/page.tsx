'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Row { key: string; sku: string; name: string; qty: number; onHand: number | null; movements: string[] }

export default function ScanStationPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState('')
  const [lot, setLot] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [manual, setManual] = useState('')
  const [unknown, setUnknown] = useState<string | null>(null)
  const [results, setResults] = useState<any[]>([])
  const [q, setQ] = useState('')
  const busyRef = useRef(false)
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 })
  const scannerRef = useRef<any>(null)

  useEffect(() => { sb.auth.getUser().then(({ data }) => { if (data.user?.email) setEmail(data.user.email) }) }, [sb])

  const total = rows.reduce((a, r) => a + r.qty, 0)

  function beep(ok = true) {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      const ac = new AC(); const o = ac.createOscillator(); const g = ac.createGain()
      o.connect(g); g.connect(ac.destination); o.frequency.value = ok ? 880 : 240
      g.gain.value = 0.06; o.start(); setTimeout(() => { o.stop(); ac.close() }, ok ? 90 : 200)
    } catch { /* no audio */ }
  }
  function flash(kind: 'ok' | 'err' | 'info', text: string) { setToast({ kind, text }); setTimeout(() => setToast(t => (t && t.text === text ? null : t)), 2200) }

  const recordSuccess = useCallback((d: any) => {
    beep(true)
    setRows(prev => {
      const i = prev.findIndex(r => r.key === d.sku)
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], qty: c[i].qty + 1, onHand: d.on_hand ?? c[i].onHand, movements: [...c[i].movements, d.movement_id] }; const [row] = c.splice(i, 1); return [row, ...c] }
      return [{ key: d.sku, sku: d.sku, name: d.product_name || d.sku, qty: 1, onHand: d.on_hand ?? null, movements: [d.movement_id] }, ...prev]
    })
    flash('ok', `✓ ${d.product_name || d.sku} +1`)
  }, [])

  const handleCode = useCallback(async (raw: string) => {
    const code = (raw || '').trim()
    if (!code || busyRef.current) return
    const now = Date.now()
    if (lastRef.current.code === code && now - lastRef.current.t < 1200) return // camera dup cooldown
    lastRef.current = { code, t: now }
    busyRef.current = true
    try {
      const { data, error } = await sb.rpc('receive_scan', { p_code: code, p_qty: 1, p_lot: lot || null, p_user: email || null })
      if (error) { beep(false); flash('err', 'Scan failed: ' + error.message); return }
      if ((data as any)?.ok) recordSuccess(data)
      else if ((data as any)?.unknown) { beep(false); setUnknown(code); setQ(''); setResults([]); flash('info', 'New barcode — link it to a product') }
      else { beep(false); flash('err', 'Could not record scan') }
    } finally { busyRef.current = false }
  }, [sb, lot, email, recordSuccess])

  // Camera scanner (html5-qrcode loaded from CDN — works on iOS Safari)
  async function startCamera() {
    try {
      if (!(window as any).Html5Qrcode) {
        await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => res(); s.onerror = () => rej(new Error('load')); document.head.appendChild(s) })
      }
      const H = (window as any).Html5Qrcode
      const inst = new H('scan-reader')
      scannerRef.current = inst
      await inst.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 170 } },
        (txt: string) => handleCode(txt), () => {})
      setCamOn(true)
    } catch { flash('err', 'Camera unavailable — use a scanner or type the code') }
  }
  async function stopCamera() { try { await scannerRef.current?.stop(); await scannerRef.current?.clear() } catch { /* */ } scannerRef.current = null; setCamOn(false) }
  useEffect(() => () => { try { scannerRef.current?.stop() } catch { /* */ } }, [])

  async function searchProducts(text: string) {
    setQ(text)
    if (text.trim().length < 2) { setResults([]); return }
    const { data } = await sb.from('products').select('id, sku, product_name').or(`sku.ilike.%${text}%,product_name.ilike.%${text}%`).eq('is_active', true).limit(8)
    setResults((data as any[]) || [])
  }
  async function linkTo(p: any) {
    if (!unknown) return
    const { data, error } = await sb.rpc('link_barcode_and_receive', { p_code: unknown, p_product_id: p.id, p_qty: 1, p_lot: lot || null, p_user: email || null })
    if (error) { flash('err', 'Link failed: ' + error.message); return }
    if ((data as any)?.ok) { recordSuccess(data); flash('ok', `Linked & counted: ${p.product_name || p.sku}`) }
    setUnknown(null); setResults([]); setQ('')
  }
  async function undoRow(r: Row) {
    const mid = r.movements[r.movements.length - 1]; if (!mid) return
    const { error } = await sb.rpc('undo_movement', { p_movement_id: mid })
    if (error) { flash('err', 'Undo failed'); return }
    setRows(prev => prev.flatMap(x => {
      if (x.key !== r.key) return [x]
      const movements = x.movements.slice(0, -1); const qty = x.qty - 1
      return qty > 0 ? [{ ...x, qty, movements }] : []
    }))
    flash('info', `Undid 1 × ${r.name}`)
  }

  return (
    <div className="min-h-screen" style={{ background: '#0F1424' }}>
      <div className="max-w-md mx-auto px-4 py-5 text-white">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-extrabold">Scan Station</h1>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: '#0e7a4620', color: '#34d399', border: '1px solid #0e7a46' }}>RECEIVING</span>
        </div>
        <p className="text-xs mb-4" style={{ color: '#8A9FC0' }}>Scan a barcode to add 1 to inventory. Scan the next, and the next — it counts as you go.</p>

        <div className="mb-3">
          <label className="text-[11px] uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Lot # (optional — applies to scans below)</label>
          <input value={lot} onChange={e => setLot(e.target.value)} placeholder="e.g. LOT-2026-07" className="w-full mt-1 rounded-lg px-3 py-2 text-sm outline-none" style={{ background: '#1A2035', color: '#fff', border: '1px solid #2A3350' }} />
        </div>

        {/* Camera */}
        <div className="rounded-xl overflow-hidden mb-3" style={{ background: '#000', border: '1px solid #2A3350' }}>
          <div id="scan-reader" style={{ width: '100%', minHeight: camOn ? 240 : 0 }} />
          {!camOn && (
            <button onClick={startCamera} className="w-full py-3 text-sm font-bold" style={{ background: '#3B6FE0', color: '#fff' }}>📷 Start camera scanning</button>
          )}
          {camOn && (
            <button onClick={stopCamera} className="w-full py-2 text-xs font-semibold" style={{ background: '#1A2035', color: '#8A9FC0' }}>Stop camera</button>
          )}
        </div>

        {/* Hardware scanner / manual */}
        <form onSubmit={e => { e.preventDefault(); const v = manual; setManual(''); handleCode(v) }} className="mb-4">
          <input value={manual} onChange={e => setManual(e.target.value)} placeholder="…or scan with a Bluetooth scanner / type a code + Enter"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: '#1A2035', color: '#fff', border: '1px solid #2A3350' }} autoComplete="off" />
        </form>

        {/* Unknown-code linker */}
        {unknown && (
          <div className="rounded-xl p-3 mb-4" style={{ background: '#1A2035', border: '1px solid #D97706' }}>
            <p className="text-sm font-bold mb-1" style={{ color: '#FDBA74' }}>New barcode: <span className="font-mono">{unknown}</span></p>
            <p className="text-[11px] mb-2" style={{ color: '#8A9FC0' }}>Link it to a product once — future scans match automatically.</p>
            <input autoFocus value={q} onChange={e => searchProducts(e.target.value)} placeholder="Search product by name or SKU…" className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-2" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350' }} />
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {results.map(p => (
                <button key={p.id} onClick={() => linkTo(p)} className="w-full text-left px-3 py-2 rounded-lg text-sm" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350' }}>
                  <span className="font-semibold">{p.product_name || p.sku}</span> <span className="font-mono text-xs" style={{ color: '#8A9FC0' }}>{p.sku}</span>
                </button>
              ))}
            </div>
            <button onClick={() => { setUnknown(null); setResults([]); setQ('') }} className="mt-2 text-xs" style={{ color: '#8A9FC0' }}>Skip this scan</button>
          </div>
        )}

        {/* Session tally */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5A6E8A' }}>This session</p>
          <p className="text-sm font-extrabold" style={{ color: '#34d399' }}>{total} scanned</p>
        </div>
        <div className="space-y-1.5 pb-8">
          {rows.length === 0 && <p className="text-xs italic" style={{ color: '#5A6E8A' }}>No scans yet.</p>}
          {rows.map(r => (
            <div key={r.key} className="flex items-center gap-3 rounded-lg px-3 py-2.5" style={{ background: '#1A2035', border: '1px solid #2A3350' }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{r.name}</p>
                <p className="text-[11px] font-mono" style={{ color: '#8A9FC0' }}>{r.sku}{r.onHand != null ? ` · on hand ${r.onHand}` : ''}</p>
              </div>
              <span className="text-lg font-extrabold" style={{ color: '#34d399' }}>×{r.qty}</span>
              <button onClick={() => undoRow(r)} title="Undo one" className="text-xs px-2 py-1 rounded-md" style={{ background: '#0F1424', color: '#F87171', border: '1px solid #3a2530' }}>↩</button>
            </div>
          ))}
        </div>
      </div>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 px-4 py-2.5 rounded-xl text-sm font-bold shadow-xl"
          style={{ background: toast.kind === 'ok' ? '#059669' : toast.kind === 'err' ? '#DC2626' : '#D97706', color: '#fff' }}>{toast.text}</div>
      )}
    </div>
  )
}
