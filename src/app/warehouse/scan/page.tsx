'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ZonePicker from '@/components/ZonePicker'

interface Row { key: string; productId: string; sku: string; name: string; qty: number; onHand: number | null; movements: string[]; caseQty: number }
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
  // by-weight receiving (bulk raw materials sold by weight)
  const [byWeight, setByWeight] = useState(false)
  const [bags, setBags] = useState('')
  const [wpb, setWpb] = useState('')
  const [wuom, setWuom] = useState('kg')

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
  const [manualPick, setManualPick] = useState(false)   // "add without scanning" product search
  const [results, setResults] = useState<any[]>([])
  const [q, setQ] = useState('')
  const busyRef = useRef(false)
  const pausedRef = useRef(false)
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 })
  const scannerRef = useRef<any>(null)
  const [allowedId, setAllowedId] = useState<string | null>(null)   // PO session locks to first item scanned
  const [mismatch, setMismatch] = useState<{ code: string; productId: string; sku: string; name: string } | null>(null)
  const pendingCreateRef = useRef<{ name: string; part_number: string; productId: string } | null>(null)
  const photosRef = useRef<Record<string, string[]>>({})

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
  function beginScan(selected: PO | null, admin: boolean, preAllowed: string | null = null) {
    setPo(selected); setAdminMode(admin); setRows([]); setMode('scan'); setCreating(false)
    setAllowedId(preAllowed); setMismatch(null); photosRef.current = {}
  }
  function openCreatePrefilled() {
    const pc = pendingCreateRef.current
    setNewPo({ name: pc?.name || '', po_number: '', supplier: '', qty_ordered: '', part_number: pc?.part_number || '' })
    setMode('setup'); setCreating(true)
  }
  function createFromMismatch() {
    const m = mismatch; if (!m) return
    pendingCreateRef.current = { name: m.name, part_number: m.sku, productId: m.productId }
    setMismatch(null)
    if (rows.length > 0) { scanComplete() }   // finish current item first; create opens after finalize
    else { openCreatePrefilled() }
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
    const pre = pendingCreateRef.current?.productId || null
    pendingCreateRef.current = null
    beginScan(data as PO, false, pre)
  }

  // ---------- scanning ----------
  const recordSuccess = useCallback((d: any) => {
    beep(true)
    const addQty = Number(d.qty) || 1
    setRows(prev => {
      const i = prev.findIndex(r => r.key === d.sku)
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], qty: c[i].qty + addQty, onHand: d.on_hand ?? c[i].onHand, movements: [...c[i].movements, d.movement_id], caseQty: Number(d.case_qty) || c[i].caseQty }; const [row] = c.splice(i, 1); return [row, ...c] }
      return [{ key: d.sku, productId: d.product_id, sku: d.sku, name: d.product_name || d.sku, qty: addQty, onHand: d.on_hand ?? null, movements: [d.movement_id], caseQty: Number(d.case_qty) || 1 }, ...prev]
    })
    flash('ok', `✓ ${d.product_name || d.sku} +${addQty}`)
  }, [])

  const handleCode = useCallback(async (raw: string) => {
    const code = (raw || '').trim()
    if (!code || busyRef.current || pausedRef.current) return
    const now = Date.now()
    if (lastRef.current.code === code && now - lastRef.current.t < 1200) return
    lastRef.current = { code, t: now }
    busyRef.current = true
    try {
      // resolve first (no inventory change) so we can enforce the PO lock before committing
      const { data: pid, error: rerr } = await sb.rpc('find_product_by_code', { p_code: code })
      if (rerr) { beep(false); flash('err', 'Lookup failed'); return }
      if (!pid) { beep(false); setUnknown(code); setQ(''); setResults([]); flash('info', 'New barcode — link it to a product'); return }
      if (!adminMode && allowedId && pid !== allowedId) {
        beep(false)
        const { data: p } = await sb.from('products').select('sku,product_name').eq('id', pid).single()
        setMismatch({ code, productId: pid as string, sku: (p as any)?.sku || '', name: (p as any)?.product_name || (p as any)?.sku || 'this item' })
        return
      }
      const { data, error } = await sb.rpc('receive_scan', { p_code: code, p_qty: 1, p_lot: lot || null, p_user: email || null })
      if (error) { beep(false); flash('err', 'Scan failed: ' + error.message); return }
      if ((data as any)?.ok) {
        recordSuccess(data)
        if (!adminMode && !allowedId) setAllowedId((data as any).product_id)   // lock PO to first item
      } else { beep(false); flash('err', 'Could not record scan') }
    } finally { busyRef.current = false }
  }, [sb, lot, email, recordSuccess, adminMode, allowedId])

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
    if (!adminMode && allowedId && p.id !== allowedId) { flash('err', 'Not on this PO — finish it first'); return }
    const { data, error } = await sb.rpc('link_barcode_and_receive', { p_code: unknown, p_product_id: p.id, p_qty: 1, p_lot: lot || null, p_user: email || null })
    if (error) { flash('err', 'Link failed: ' + error.message); return }
    if ((data as any)?.ok) { recordSuccess(data); if (!adminMode && !allowedId) setAllowedId(p.id); flash('ok', `Linked & counted: ${p.product_name || p.sku}`) }
    setUnknown(null); setResults([]); setQ('')
  }
  // Receive an item by choosing it from the catalog — no barcode/scan required.
  async function addProduct(p: any) {
    if (!adminMode && allowedId && p.id !== allowedId) { flash('err', 'Not on this PO — finish it first'); return }
    const code = p.sku || p.id
    const nBags = parseFloat(bags), perBag = parseFloat(wpb)
    const useWeight = byWeight && nBags > 0 && perBag > 0
    const qty = useWeight ? +(nBags * perBag).toFixed(4) : 1
    const { data, error } = await sb.rpc('receive_scan', {
      p_code: code, p_qty: qty, p_lot: lot || null, p_user: email || null,
      p_pack_qty: useWeight ? nBags : null, p_uom: useWeight ? wuom : null,
    })
    if (error) { flash('err', 'Add failed: ' + error.message); return }
    if ((data as any)?.ok) {
      recordSuccess(data); if (!adminMode && !allowedId) setAllowedId(p.id)
      flash('ok', useWeight ? `Added ${qty} ${wuom} (${nBags} bags): ${p.product_name || p.sku}` : `Added: ${p.product_name || p.sku}`)
    } else { flash('err', 'Could not add item') }
    setManualPick(false); setResults([]); setQ('')
    if (useWeight) { setBags(''); setWpb('') }
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

  // Edit a session line to an exact quantity; reflect the delta to inventory (Ultron)
  async function editRowQty(r: Row, target: number) {
    const t = Math.max(0, Math.floor(Number.isFinite(target) ? target : r.qty))
    const delta = t - r.qty
    if (delta === 0) return
    const { data, error } = await sb.rpc('adjust_receive_qty', { p_product_id: r.productId, p_delta: delta, p_lot: lot || null, p_user: email || null })
    if (error) { flash('err', 'Could not update quantity'); return }
    const onHand = (data as any)?.on_hand ?? r.onHand
    beep(true)
    setRows(prev => prev.flatMap(x => x.key !== r.key ? [x] : (t > 0 ? [{ ...x, qty: t, onHand }] : [])))
    flash('ok', `Set ${r.name} → ${t}`)
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
    const photosByPid = photosRef.current
    const lines = rows.map(r => `<tr><td style="padding:4px 10px">${r.name}</td><td style="padding:4px 10px">${r.sku}</td><td style="padding:4px 10px;text-align:center">${r.qty}</td><td style="padding:4px 10px">${(zoneMap[r.productId] || []).join(', ') || '—'}</td><td style="padding:4px 10px">${(photosByPid[r.productId] || []).length}</td></tr>`).join('')
    const photoHtml = rows.flatMap(r => (photosByPid[r.productId] || []).map(u => `<a href="${u}"><img src="${u}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;margin:4px" /></a>`)).join('')
    await sendEmail(
      `Receiving ${po ? `· PO ${po.po_number || po.name}` : '· Admin / no-PO'} — ${total} unit(s)`,
      `<p>Items received into inventory${po ? ` against <b>${po.name}</b> (PO ${po.po_number || '—'}, ${po.supplier || 'supplier n/a'})` : ' — <b>Admin / no-PO</b>'}.</p>
       <table style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9"><th style="padding:4px 10px;text-align:left">Item</th><th style="padding:4px 10px;text-align:left">SKU</th><th style="padding:4px 10px">Qty</th><th style="padding:4px 10px;text-align:left">Zone(s)</th><th style="padding:4px 10px">Photos</th></tr></thead><tbody>${lines}</tbody></table>
       ${photoHtml ? `<p style="margin-top:10px"><b>Photos of items received:</b></p><div>${photoHtml}</div>` : '<p style="color:#b45309">No photos were captured.</p>'}
       <p style="color:#64748b;font-size:12px">Received by ${email || 'unknown'} on ${new Date().toLocaleString()}. Lot: ${lot || '—'}.</p>`
    )
    // store receiving photos + summary on the PO entry for the record
    if (po) {
      const docs = rows.flatMap(r => (photosByPid[r.productId] || []).map(u => ({ sku: r.sku, name: r.name, url: u, at: new Date().toISOString() })))
      try { await sb.from('purchasing_requests').update({ receiving_docs: docs }).eq('id', po.id) } catch { /* non-blocking */ }
    }
    setFinishing(false)
    flash('ok', `Received ${total} unit(s)${po ? ' → PO updated' : ''}. Finance notified.`)
    setRows([]); setPo(null); setAdminMode(false); setLot(''); setAllowedId(null); setMode('setup')
    photosRef.current = {}
    if (pendingCreateRef.current) { setTimeout(() => openCreatePrefilled(), 50) }   // received one item, now create the mismatched one
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
          <div className="flex items-center gap-2">
            <a href="/warehouse/receiving-log" className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#1A2035', color: '#8A9FC0', border: '1px solid #2A3350' }}>📒 Log</a>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: adminMode ? '#33261A' : '#0e7a4620', color: adminMode ? '#FBBF24' : '#34d399', border: `1px solid ${adminMode ? '#7c5b1f' : '#0e7a46'}` }}>{adminMode ? 'ADMIN' : 'RECEIVING'}</span>
          </div>
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
              <p className="text-[11px] mb-1" style={{ color: '#5A6E8A' }}>Receiving locks to the first item you scan. If something arrives that isn&apos;t on the PO, you&apos;ll be offered to create a request for it.</p>
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

              {/* By-weight receiving: bags × weight-per-bag with a UOM control */}
              <button type="button" onClick={() => setByWeight(v => !v)}
                className="w-full mb-2 py-3 text-sm font-bold rounded-xl"
                style={{ background: byWeight ? '#33261A' : '#1A2035', color: '#FBBF24', border: '1px solid #2A3350' }}>
                ⚖️ Receive by weight (bags){byWeight ? ' — on' : ''}
              </button>
              {byWeight && (
                <div className="rounded-2xl p-3.5 mb-3" style={{ background: '#1A2035', border: '1px solid #7c5b1f' }}>
                  <p className="text-[12px] mb-2" style={{ color: '#FBBF24' }}>Enter bags &amp; weight per bag, choose the unit, then pick the product below. Qty received = bags × weight/bag.</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wide" style={{ color: '#8A9FC0' }}>Bags</label>
                      <input value={bags} onChange={e => setBags(e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-lg px-2.5 py-2.5 text-base outline-none" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide" style={{ color: '#8A9FC0' }}>Wt / bag</label>
                      <input value={wpb} onChange={e => setWpb(e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-lg px-2.5 py-2.5 text-base outline-none" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide" style={{ color: '#8A9FC0' }}>UOM</label>
                      <select value={wuom} onChange={e => setWuom(e.target.value)} className="w-full rounded-lg px-2 py-2.5 text-base outline-none appearance-none" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }}>
                        {['kg','lb','g','oz','Packs','Cases','Ea.','Rolls'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  {parseFloat(bags) > 0 && parseFloat(wpb) > 0 && (
                    <p className="text-[13px] font-bold mt-2.5" style={{ color: '#34d399' }}>= {(parseFloat(bags) * parseFloat(wpb)).toLocaleString()} {wuom} <span style={{ color: '#5A6E8A' }}>({bags} bags × {wpb})</span></p>
                  )}
                  <button type="button" onClick={() => { setManualPick(true); setUnknown(null); setResults([]); setQ('') }} className="w-full mt-2.5 py-2.5 text-sm font-bold rounded-xl" style={{ background: '#3B6FE0', color: '#fff' }}>Pick product to receive →</button>
                </div>
              )}

              {/* Add an item without a barcode / scanner — pick it from the catalog */}
              <button type="button" onClick={() => { setManualPick(v => !v); setUnknown(null); setResults([]); setQ('') }}
                className="w-full mb-3 py-3 text-sm font-bold rounded-xl"
                style={{ background: manualPick ? '#0e2a3a' : '#1A2035', color: '#7DD3FC', border: '1px solid #2A3350' }}>
                ➕ Add an item without scanning
              </button>
              {manualPick && (
                <div className="rounded-2xl p-3.5 mb-4" style={{ background: '#1A2035', border: '1px solid #3B6FE0' }}>
                  <p className="text-sm font-bold mb-2" style={{ color: '#93C5FD' }}>Pick a product to receive — no barcode needed</p>
                  <input autoFocus value={q} onChange={e => searchProducts(e.target.value)} placeholder="Search product by name or SKU…" className="w-full rounded-xl px-4 py-3 text-base outline-none mb-2" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} />
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {results.map(p => (
                      <button key={p.id} onClick={() => addProduct(p)} className="w-full text-left px-3.5 py-3 rounded-xl text-sm" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350' }}>
                        <span className="font-semibold">{p.product_name || p.sku}</span> <span className="font-mono text-xs" style={{ color: '#8A9FC0' }}>{p.sku}</span>
                      </button>
                    ))}
                    {q.trim().length >= 2 && results.length === 0 && <p className="text-xs italic px-1" style={{ color: '#5A6E8A' }}>No matching products.</p>}
                  </div>
                  <button onClick={() => { setManualPick(false); setResults([]); setQ('') }} className="mt-2 text-xs" style={{ color: '#8A9FC0' }}>Cancel</button>
                </div>
              )}

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

              {mismatch && (
                <div className="rounded-2xl p-3.5 mb-4" style={{ background: '#2a1a1a', border: '1px solid #DC2626' }}>
                  <p className="text-sm font-bold mb-1" style={{ color: '#FCA5A5' }}>⚠ Not on this PO</p>
                  <p className="text-[12px] mb-1" style={{ color: '#E5B4B4' }}><b>{mismatch.name}</b> <span className="font-mono">{mismatch.sku}</span> isn&apos;t the item this PO is receiving.</p>
                  <p className="text-[11px] mb-2.5" style={{ color: '#c99' }}>{rows.length > 0 ? 'Tap below to store the current item first, then create a request for this one.' : 'You can create a purchasing request for it now.'}</p>
                  <div className="flex gap-2">
                    <button onClick={createFromMismatch} className="flex-1 py-2.5 text-sm font-bold rounded-xl" style={{ background: '#3B6FE0', color: '#fff' }}>+ Create a request for this item</button>
                    <button onClick={() => setMismatch(null)} className="px-4 py-2.5 text-sm rounded-xl" style={{ background: '#0F1424', color: '#8A9FC0', border: '1px solid #2A3350' }}>Skip</button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5A6E8A' }}>This session</p>
                <p className="text-2xl font-extrabold" style={{ color: '#34d399' }}>{total}<span className="text-sm font-bold" style={{ color: '#5A6E8A' }}> scanned</span></p>
              </div>
              <div className="space-y-2 pb-4">
                {rows.length === 0 && <p className="text-sm italic" style={{ color: '#5A6E8A' }}>No scans yet.</p>}
                {rows.map(r => {
                  const cq = r.caseQty > 1 ? r.caseQty : 0
                  const cases = cq ? Math.floor(r.qty / cq) : 0
                  const rem = cq ? r.qty % cq : 0
                  return (
                  <div key={r.key} className="rounded-xl px-3.5 py-3" style={{ background: '#1A2035', border: '1px solid #2A3350' }}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{r.name}</p>
                        <p className="text-[11px] font-mono" style={{ color: '#8A9FC0' }}>{r.sku}{r.onHand != null ? ` · on hand ${r.onHand}` : ''}</p>
                      </div>
                      <button onClick={() => editRowQty(r, r.qty - 1)} title="Minus one" className="text-lg w-9 h-9 rounded-lg shrink-0" style={{ background: '#0F1424', color: '#8A9FC0', border: '1px solid #2A3350' }}>−</button>
                      <input key={r.key + '-' + r.qty} type="number" inputMode="numeric" defaultValue={r.qty}
                        onBlur={e => editRowQty(r, parseInt(e.target.value || '0', 10))}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        className="w-14 text-center text-lg font-extrabold rounded-lg py-1 shrink-0" style={{ background: '#0F1424', color: '#34d399', border: '1px solid #2A3350', fontSize: 16 }} />
                      <button onClick={() => editRowQty(r, r.qty + 1)} title="Plus one" className="text-lg w-9 h-9 rounded-lg shrink-0" style={{ background: '#0F1424', color: '#34d399', border: '1px solid #2A3350' }}>+</button>
                      <button onClick={() => undoRow(r)} title="Undo last scan" className="text-base px-3 py-2 rounded-lg shrink-0" style={{ background: '#0F1424', color: '#F87171', border: '1px solid #3a2530' }}>↩</button>
                    </div>
                    {cq > 0 && (
                      <p className="text-[11px] mt-1.5 font-semibold" style={{ color: '#FBBF24' }}>{r.qty} packs = {cases} case{cases === 1 ? '' : 's'}{rem > 0 ? ` + ${rem} pack${rem === 1 ? '' : 's'}` : ''} <span style={{ color: '#5A6E8A' }}>· {cq}/case</span></p>
                    )}
                  </div>
                  )
                })}
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
          stepLabel={`Item ${zoneTotal - zoneQueue.length + 1} of ${zoneTotal} · tap zone(s) + photo`}
          capturePhoto
          photoRequired
          onPhoto={(url) => { const pid = zoneQueue[0].productId; photosRef.current[pid] = [...(photosRef.current[pid] || []), url] }}
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
