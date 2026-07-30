'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ZonePicker from '@/components/ZonePicker'

interface Row { key: string; productId: string; sku: string; name: string; qty: number; onHand: number | null; movements: string[] }
interface PO { id: string; name: string; po_number: string | null; supplier: string | null; qty_ordered: string | null; qty_received: string | null; balance: string | null; status: string | null }

const CLOSED = new Set(['Received', 'PO Canceled'])
const num = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n }
const FINANCE = 'finance@beyondgreenbiotech.com'

export default function ScanStationPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState('')

  // session
  const [mode, setMode] = useState<'setup' | 'scan'>('setup')
  const [po, setPo] = useState<PO | null>(null)
  const [adminMode, setAdminMode] = useState(false)
  const [lot, setLot] = useState('')

  // PO dropdown
  const [openPOs, setOpenPOs] = useState<PO[]>([])
  const [poLoading, setPoLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newPo, setNewPo] = useState({ name: '', po_number: '', supplier: '', qty_ordered: '', part_number: '' })

  // scanning
  const [rows, setRows] = useState<Row[]>([])
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [manual, setManual] = useState('')
  const [unknown, setUnknown] = useState<string | null>(null)
  const [results, setResults] = useState<any[]>([])
  const [q, setQ] = useState('')
  const busyRef = useRef(false)
  const pausedRef = useRef(false)
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 })
  const scannerRef = useRef<any>(null)

  // end-of-session zone assignment
  const [zoneQueue, setZoneQueue] = useState<Row[]>([])
  const [zoneTotal, setZoneTotal] = useState(0)
  const [finishing, setFinishing] = useState(false)

  // app-like: lock zoom + full-height while on this screen
  useEffect(() => {
    const head = document.head
    let m = head.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
    const prev = m?.getAttribute('content') || null
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; head.appendChild(m) }
    m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    const prevBg = document.body.style.background; document.body.style.background = '#0F1424'
    return () => { if (m && prev) m.setAttribute('content', prev); document.body.style.background = prevBg }
  }, [])

  useEffect(() => { sb.auth.getUser().then(({ data }) => { if (data.user?.email) setEmail(data.user.email) }) }, [sb])

  // load open PO entries for the dropdown
  useEffect(() => { (async () => {
    setPoLoading(true)
    const { data } = await sb.from('purchasing_requests')
      .select('id,name,po_number,supplier,qty_ordered,qty_received,balance,status')
      .order('po_date', { ascending: false }).limit(500)
    setOpenPOs(((data as any[]) || []).filter(r => !CLOSED.has(String(r.status || ''))) as PO[])
    setPoLoading(false)
  })() }, [sb])

  const total = rows.reduce((a, r) => a + r.qty, 0)

  function beep(ok = true) {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      const ac = new AC(); const o = ac.createOscillator(); const g = ac.createGain()
      o.connect(g); g.connect(ac.destination); o.frequency.value = ok ? 880 : 240
      g.gain.value = 0.06; o.start(); setTimeout(() => { o.stop(); ac.close() }, ok ? 90 : 200)
    } catch { /* no audio */ }
    try { (navigator as any).vibrate?.(ok ? 35 : [40, 30, 40]) } catch { /* no haptics */ }
  }
  function flash(kind: 'ok' | 'err' | 'info', text: string) { setToast({ kind, text }); setTimeout(() => setToast(t => (t && t.text === text ? null : t)), 2000) }

  async function sendEmail(subject: string, html: string) {
    try { await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: FINANCE, subject, html }) }) } catch { /* non-blocking */ }
  }

  // ---------- PO selection ----------
  function beginScan(selected: PO | null, admin: boolean) {
    setPo(selected); setAdminMode(admin); setRows([]); setMode('scan'); setCreating(false)
  }
  function onPickPo(id: string) {
    if (!id) return
    const found = openPOs.find(p => p.id === id) || null
    if (found) beginScan(found, false)
  }
  async function createPoEntry() {
    if (!newPo.name.trim()) { flash('err', 'Enter an item name'); return }
    const payload: any = {
      name: newPo.name.trim(),
      po_number: newPo.po_number.trim() || null,
      supplier: newPo.supplier.trim() || null,
      supplier_pn: newPo.part_number.trim() || null,
      qty_ordered: newPo.qty_ordered.trim() || null,
      status: 'PO Issued',
      person_requesting: email || null,
      po_date: new Date().toISOString().slice(0, 10),
    }
    const { data, error } = await sb.from('purchasing_requests').insert(payload).select('id,name,po_number,supplier,qty_ordered,qty_received,balance,status').single()
    if (error) { flash('err', 'Could not create entry: ' + error.message); return }
    void sendEmail(
      `New purchasing entry created at receiving — ${payload.name}`,
      `<p>A receiver created a new purchasing entry that was not on the board.</p>
       <ul><li><b>Item:</b> ${payload.name}</li><li><b>PO #:</b> ${payload.po_number || '—'}</li>
       <li><b>Supplier:</b> ${payload.supplier || '—'}</li><li><b>Part #:</b> ${newPo.part_number || '—'}</li>
       <li><b>Created by:</b> ${email || 'unknown'}</li></ul>`
    )
    flash('ok', 'Entry created')
    beginScan(data as PO, false)
  }

  // ---------- scanning ----------
  const recordSuccess = useCallback((d: any) => {
    beep(true)
    setRows(prev => {
      const i = prev.findIndex(r => r.key === d.sku)
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], qty: c[i].qty + 1, onHand: d.on_hand ?? c[i].onHand, movements: [...c[i].movements, d.movement_id] }; const [row] = c.splice(i, 1); return [row, ...c] }
      return [{ key: d.sku, productId: d.product_id, sku: d.sku, name: d.product_name || d.sku, qty: 1, onHand: d.on_hand ?? null, movements: [d.movement_id] }, ...prev]
    })
    flash('ok', `✓ ${d.product_name || d.sku} +1`)
  }, [])

  const handleCode = useCallback(async (raw: string) => {
    const code = (raw || '').trim()
    if (!code || busyRef.current || pausedRef.current) return
    const now = Date.now()
    if (lastRef.current.code === code && now - lastRef.current.t < 1200) return
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

  async function startCamera() {
    try {
      if (!(window as any).Html5Qrcode) {
        await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => res(); s.onerror = () => rej(new Error('load')); document.head.appendChild(s) })
      }
      const H = (window as any).Html5Qrcode
      const Fmt = (window as any).Html5QrcodeSupportedFormats || {}
      const formats = ['QR_CODE', 'UPC_A', 'UPC_E', 'EAN_13', 'EAN_8', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR', 'DATA_MATRIX', 'UPC_EAN_EXTENSION']
        .map(k => Fmt[k]).filter((v: any) => v !== undefined)
      const inst = new H('scan-reader', { formatsToSupport: formats.length ? formats : undefined, experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false })
      scannerRef.current = inst
      const qrbox = (vw: number, vh: number) => { const w = Math.floor(Math.min(vw, 520) * 0.92); return { width: w, height: Math.max(130, Math.floor(w * 0.55)) } }
      await inst.start({ facingMode: 'environment' }, { fps: 12, qrbox, aspectRatio: 1.4 },
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

  // ---------- finish / zone assignment ----------
  function scanComplete() {
    if (rows.length === 0) { flash('info', 'Nothing scanned yet'); return }
    if (camOn) stopCamera()
    setZoneTotal(rows.length)
    setZoneQueue([...rows])
  }
  function cancelZones() { setZoneQueue([]); flash('info', 'Storage assignment canceled — items are still counted') }

  async function finalize() {
    setFinishing(true)
    if (po) {
      const received = num(po.qty_received) + total
      const ordered = num(po.qty_ordered)
      const balance = ordered ? Math.max(0, ordered - received) : null
      const status = balance !== null && balance <= 0 ? 'Received' : 'Partial Received'
      await sb.from('purchasing_requests').update({
        qty_received: String(received),
        balance: balance !== null ? String(balance) : po.balance,
        status,
        date_received: new Date().toISOString().slice(0, 10),
        received_by: email || null,
      }).eq('id', po.id)
    }
    const ids = rows.map(r => r.productId)
    let zoneMap: Record<string, string[]> = {}
    try {
      const { data: pz } = await sb.from('product_zones').select('product_id, storage_zones(code)').in('product_id', ids)
      for (const r of (pz as any[]) || []) { const c = r.storage_zones?.code; if (!c) continue; (zoneMap[r.product_id] ||= []).push(c) }
    } catch { zoneMap = {} }
    const lines = rows.map(r => `<tr><td style="padding:4px 10px">${r.name}</td><td style="padding:4px 10px">${r.sku}</td><td style="padding:4px 10px;text-align:center">${r.qty}</td><td style="padding:4px 10px">${(zoneMap[r.productId] || []).join(', ') || '—'}</td></tr>`).join('')
    await sendEmail(
      `Receiving ${po ? `· PO ${po.po_number || po.name}` : '· Admin / no-PO'} — ${total} unit(s)`,
      `<p>Items received into inventory${po ? ` against <b>${po.name}</b> (PO ${po.po_number || '—'}, ${po.supplier || 'supplier n/a'})` : ' — <b>Admin / no-PO</b>'}.</p>
       <table style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9"><th style="padding:4px 10px;text-align:left">Item</th><th style="padding:4px 10px;text-align:left">SKU</th><th style="padding:4px 10px">Qty</th><th style="padding:4px 10px;text-align:left">Zone(s)</th></tr></thead><tbody>${lines}</tbody></table>
       <p style="color:#64748b;font-size:12px">Received by ${email || 'unknown'} on ${new Date().toLocaleString()}. Lot: ${lot || '—'}.</p>`
    )
    setFinishing(false)
    flash('ok', `Received ${total} unit(s)${po ? ' → PO updated' : ''}. Finance notified.`)
    setRows([]); setPo(null); setAdminMode(false); setLot(''); setMode('setup')
  }

  const inputCls = 'w-full rounded-xl px-4 py-3.5 text-base outline-none'
  const inputSty = { background: '#1A2035', color: '#fff', border: '1px solid #2A3350', fontSize: 16 } as const

  // ================= RENDER =================
  return (
    <div className="text-white flex flex-col" style={{ background: '#0F1424', minHeight: '100dvh' }}>
      {/* App header */}
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: '#0F1424', borderBottom: '1px solid #1c2540', paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-lg font-extrabold">Scan Station</h1>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: adminMode ? '#33261A' : '#0e7a4620', color: adminMode ? '#FBBF24' : '#34d399', border: `1px solid ${adminMode ? '#7c5b1f' : '#0e7a46'}` }}>{adminMode ? 'ADMIN' : 'RECEIVING'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4">

          {/* ---------- SETUP ---------- */}
          {mode === 'setup' && !creating && (
            <>
              <p className="text-sm mb-3" style={{ color: '#8A9FC0' }}>Pick the purchase order you&apos;re receiving against.</p>
              <label className="text-[11px] uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Purchase order</label>
              <div className="relative mt-1 mb-2">
                <select defaultValue="" onChange={e => onPickPo(e.target.value)} className={inputCls + ' appearance-none pr-10'} style={inputSty}>
                  <option value="" disabled>{poLoading ? 'Loading purchase orders…' : `Select an open PO (${openPOs.length})…`}</option>
                  {openPOs.map(p => (
                    <option key={p.id} value={p.id}>{(p.po_number ? `PO ${p.po_number} · ` : '') + p.name + (p.supplier ? ` · ${p.supplier}` : '') + (p.balance ? ` · bal ${p.balance}` : '')}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" style={{ color: '#8A9FC0' }}>▾</span>
              </div>
              <button onClick={() => { setCreating(true) }} className="w-full mt-1 py-3 text-sm font-bold rounded-xl" style={{ background: '#1A2035', color: '#93C5FD', border: '1px dashed #3B6FE0' }}>+ Not on the board — create an entry</button>
              <div className="mt-5 pt-5" style={{ borderTop: '1px solid #1c2540' }}>
                <button onClick={() => beginScan(null, true)} className="w-full py-3.5 text-base font-bold rounded-xl" style={{ background: '#33261A', color: '#FBBF24', border: '1px solid #7c5b1f' }}>🏢 Admin / no-PO receive</button>
                <p className="text-[11px] mt-1.5 text-center" style={{ color: '#5A6E8A' }}>Office / admin supplies — no purchase order required.</p>
              </div>
            </>
          )}

          {mode === 'setup' && creating && (
            <div className="rounded-2xl p-4" style={{ background: '#1A2035', border: '1px solid #3B6FE0' }}>
              <p className="text-base font-bold mb-3" style={{ color: '#93C5FD' }}>New receiving entry</p>
              {([['name', 'Item name *'], ['po_number', 'PO #'], ['supplier', 'Supplier'], ['part_number', 'Part #'], ['qty_ordered', 'Qty ordered']] as const).map(([k, label]) => (
                <input key={k} value={(newPo as any)[k]} onChange={e => setNewPo(n => ({ ...n, [k]: e.target.value }))} placeholder={label}
                  className="w-full mb-2.5 rounded-xl px-4 py-3 text-base outline-none" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} />
              ))}
              <p className="text-[11px] mb-3" style={{ color: '#8A9FC0' }}>Finance will be notified that this entry was created at receiving.</p>
              <div className="flex gap-2">
                <button onClick={createPoEntry} className="flex-1 py-3 text-base font-bold rounded-xl" style={{ background: '#3B6FE0', color: '#fff' }}>Create &amp; start</button>
                <button onClick={() => setCreating(false)} className="px-5 py-3 text-base rounded-xl" style={{ background: '#0F1424', color: '#8A9FC0', border: '1px solid #2A3350' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* ---------- SCAN ---------- */}
          {mode === 'scan' && (
            <>
              <div className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: adminMode ? '#33261A' : '#0e7a4614', border: `1px solid ${adminMode ? '#7c5b1f' : '#0e7a46'}` }}>
                {adminMode ? <p className="text-[13px] font-bold" style={{ color: '#FBBF24' }}>🏢 Admin / no-PO receive</p> : (<>
                  <p className="text-[13px] font-bold truncate">{po?.name}</p>
                  <p className="text-[11px]" style={{ color: '#8A9FC0' }}>PO {po?.po_number || '—'} · {po?.supplier || 'supplier n/a'} · balance {po?.balance || '—'}</p>
                </>)}
                <button onClick={() => { if (camOn) stopCamera(); setMode('setup'); setRows([]) }} className="text-[11px] mt-1" style={{ color: '#8A9FC0' }}>← change / cancel</button>
              </div>

              {/* Camera card */}
              <div className="rounded-2xl overflow-hidden mb-3" style={{ background: '#000', border: '1px solid #2A3350' }}>
                <div id="scan-reader" style={{ width: '100%', minHeight: camOn ? 300 : 0 }} />
                {!camOn
                  ? <button onClick={startCamera} className="w-full py-4 text-base font-extrabold" style={{ background: '#3B6FE0', color: '#fff' }}>📷 Start camera</button>
                  : <button onClick={stopCamera} className="w-full py-3 text-sm font-semibold" style={{ background: '#1A2035', color: '#8A9FC0' }}>Stop camera</button>}
              </div>

              <form onSubmit={e => { e.preventDefault(); const v = manual; setManual(''); handleCode(v) }} className="mb-3">
                <input value={manual} onChange={e => setManual(e.target.value)} inputMode="text" placeholder="…or scan with a handheld / type a code"
                  className={inputCls} style={inputSty} autoComplete="off" />
              </form>

              <div className="mb-4">
                <label className="text-[11px] uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Lot # (optional)</label>
                <input value={lot} onChange={e => setLot(e.target.value)} placeholder="e.g. LOT-2026-07" className={inputCls + ' mt-1'} style={inputSty} />
              </div>

              {unknown && (
                <div className="rounded-2xl p-3.5 mb-4" style={{ background: '#1A2035', border: '1px solid #D97706' }}>
                  <p className="text-sm font-bold mb-1" style={{ color: '#FDBA74' }}>New barcode: <span className="font-mono">{unknown}</span></p>
                  <p className="text-[12px] mb-2" style={{ color: '#8A9FC0' }}>Link it to a product once — future scans match automatically.</p>
                  <input autoFocus value={q} onChange={e => searchProducts(e.target.value)} placeholder="Search product by name or SKU…" className="w-full rounded-xl px-4 py-3 text-base outline-none mb-2" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} />
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {results.map(p => (
                      <button key={p.id} onClick={() => linkTo(p)} className="w-full text-left px-3.5 py-3 rounded-xl text-sm" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350' }}>
                        <span className="font-semibold">{p.product_name || p.sku}</span> <span className="font-mono text-xs" style={{ color: '#8A9FC0' }}>{p.sku}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setUnknown(null); setResults([]); setQ('') }} className="mt-2 text-xs" style={{ color: '#8A9FC0' }}>Skip this scan</button>
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5A6E8A' }}>This session</p>
                <p className="text-2xl font-extrabold" style={{ color: '#34d399' }}>{total}<span className="text-sm font-bold" style={{ color: '#5A6E8A' }}> scanned</span></p>
              </div>
              <div className="space-y-2 pb-4">
                {rows.length === 0 && <p className="text-sm italic" style={{ color: '#5A6E8A' }}>No scans yet.</p>}
                {rows.map(r => (
                  <div key={r.key} className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: '#1A2035', border: '1px solid #2A3350' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <p className="text-[11px] font-mono" style={{ color: '#8A9FC0' }}>{r.sku}{r.onHand != null ? ` · on hand ${r.onHand}` : ''}</p>
                    </div>
                    <span className="text-xl font-extrabold" style={{ color: '#34d399' }}>×{r.qty}</span>
                    <button onClick={() => undoRow(r)} title="Undo one" className="text-base px-3 py-2 rounded-lg" style={{ background: '#0F1424', color: '#F87171', border: '1px solid #3a2530' }}>↩</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sticky bottom action bar */}
      {mode === 'scan' && (
        <div className="sticky bottom-0 z-20 px-4 pt-3" style={{ background: 'linear-gradient(180deg, rgba(15,20,36,0) 0%, #0F1424 22%)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}>
          <div className="max-w-md mx-auto">
            <button onClick={scanComplete} disabled={rows.length === 0}
              className="w-full py-4 text-base font-extrabold rounded-2xl disabled:opacity-40"
              style={{ background: '#059669', color: '#fff', boxShadow: '0 6px 20px rgba(5,150,105,0.35)' }}>✓ Scan complete — pick storage ({total})</button>
          </div>
        </div>
      )}

      {/* End-of-session: one zone picker per product group, then finalize */}
      {zoneQueue.length > 0 && (
        <ZonePicker
          productId={zoneQueue[0].productId}
          productName={`${zoneQueue[0].name}  (×${zoneQueue[0].qty})`}
          currentUserEmail={email}
          stepLabel={`Item ${zoneTotal - zoneQueue.length + 1} of ${zoneTotal} · tap storage zone(s)`}
          onCancel={cancelZones}
          onClose={() => {
            setZoneQueue(prev => {
              const rest = prev.slice(1)
              if (rest.length === 0) { void finalize() }
              return rest
            })
          }}
        />
      )}

      {finishing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(15,20,36,0.7)' }}>
          <p className="text-white text-sm font-bold">Saving &amp; notifying finance…</p>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-bold shadow-xl z-[80]" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)', background: toast.kind === 'ok' ? '#059669' : toast.kind === 'err' ? '#DC2626' : '#D97706', color: '#fff' }}>{toast.text}</div>
      )}
    </div>
  )
}
