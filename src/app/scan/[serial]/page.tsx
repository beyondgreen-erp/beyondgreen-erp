'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

interface Row { key: string; productId: string; sku: string; name: string; qty: number; onHand: number | null; movements: string[]; caseQty: number }

export default function DeviceScanPage() {
  const params = useParams<{ serial: string }>()
  const serial = params?.serial as string

  const [meta, setMeta] = useState<{ label: string; mode: 'receiving' | 'production' } | null>(null)
  const [metaErr, setMetaErr] = useState('')
  const [pin, setPin] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authErr, setAuthErr] = useState('')

  const [lot, setLot] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [manual, setManual] = useState('')
  const [manualPick, setManualPick] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const busyRef = useRef(false)
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 })
  const scannerRef = useRef<any>(null)

  // by-weight (receiving)
  const [byWeight, setByWeight] = useState(false)
  const [bags, setBags] = useState('')
  const [wpb, setWpb] = useState('')
  const [wuom, setWuom] = useState('kg')

  // production
  const [fg, setFg] = useState<any | null>(null)
  const [caseMode, setCaseMode] = useState(false)

  const total = rows.reduce((a, r) => a + r.qty, 0)

  useEffect(() => {
    const head = document.head
    let m = head.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; head.appendChild(m) }
    m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    const prevBg = document.body.style.background; document.body.style.background = '#0F1424'
    return () => { document.body.style.background = prevBg }
  }, [])

  useEffect(() => {
    if (!serial) return
    fetch(`/api/device-scan/${serial}`).then(r => r.json()).then(d => {
      if (d?.ok) { setMeta({ label: d.label, mode: d.mode }); try { const saved = localStorage.getItem('scanpin_' + serial); if (saved) setPin(saved) } catch { /* */ } }
      else setMetaErr(d?.error || 'Device not found')
    }).catch(() => setMetaErr('Could not reach the server'))
  }, [serial])

  function flash(kind: 'ok' | 'err' | 'info', text: string) { setToast({ kind, text }); setTimeout(() => setToast(t => (t && t.text === text ? null : t)), 2200) }
  function beep(ok = true) {
    try { const AC = (window as any).AudioContext || (window as any).webkitAudioContext; const ac = new AC(); const o = ac.createOscillator(); const g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = ok ? 880 : 240; g.gain.value = 0.06; o.start(); setTimeout(() => { o.stop(); ac.close() }, ok ? 90 : 200) } catch { /* */ }
    try { (navigator as any).vibrate?.(ok ? 35 : [40, 30, 40]) } catch { /* */ }
  }

  async function api(action: string, payload: any = {}) {
    const r = await fetch(`/api/device-scan/${serial}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, pin, ...payload }) })
    return r.json()
  }

  async function tryAuth() {
    setAuthErr('')
    const d = await api('auth')
    if (d?.ok) { setAuthed(true); try { localStorage.setItem('scanpin_' + serial, pin) } catch { /* */ } }
    else setAuthErr(d?.error || 'Wrong PIN')
  }

  function recordSuccess(d: any) {
    beep(true)
    const addQty = Number(d.qty) || 1
    setRows(prev => {
      const i = prev.findIndex(r => r.key === d.sku)
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], qty: c[i].qty + addQty, onHand: d.on_hand ?? c[i].onHand, movements: [...c[i].movements, d.movement_id], caseQty: Number(d.case_qty) || c[i].caseQty }; const [row] = c.splice(i, 1); return [row, ...c] }
      return [{ key: d.sku, productId: d.product_id, sku: d.sku, name: d.product_name || d.sku, qty: addQty, onHand: d.on_hand ?? null, movements: [d.movement_id], caseQty: Number(d.case_qty) || 1 }, ...prev]
    })
    flash('ok', `✓ ${d.product_name || d.sku} +${addQty}`)
  }

  const handleCode = useCallback(async (raw: string) => {
    const code = (raw || '').trim()
    if (!code || busyRef.current) return
    const now = Date.now()
    if (lastRef.current.code === code && now - lastRef.current.t < 1200) return
    lastRef.current = { code, t: now }
    busyRef.current = true
    try {
      if (meta?.mode === 'production') {
        const qty = caseMode && fg?.case_qty ? Number(fg.case_qty) : 1
        const d = await api('produce', { code, qty })
        if (d?.ok) recordSuccess(d); else flash('err', d?.error || 'Could not record')
      } else {
        const nBags = parseFloat(bags), perBag = parseFloat(wpb)
        const useWeight = byWeight && nBags > 0 && perBag > 0
        const qty = useWeight ? +(nBags * perBag).toFixed(4) : 1
        const d = await api('receive', { code, qty, lot: lot || null, pack_qty: useWeight ? nBags : null, uom: useWeight ? wuom : null })
        if (d?.ok) { recordSuccess(d); if (useWeight) { setBags(''); setWpb('') } }
        else if (d?.unknown) flash('err', `Unknown code ${code} — search & add it below`)
        else flash('err', d?.error || 'Could not record scan')
      }
    } finally { busyRef.current = false }
  }, [meta, caseMode, fg, bags, wpb, byWeight, wuom, lot, pin, serial])

  async function startCamera() {
    try {
      if (!(window as any).Html5Qrcode) {
        await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => res(); s.onerror = () => rej(new Error('load')); document.head.appendChild(s) })
      }
      const H = (window as any).Html5Qrcode
      const Fmt = (window as any).Html5QrcodeSupportedFormats || {}
      const formats = ['QR_CODE', 'UPC_A', 'UPC_E', 'EAN_13', 'EAN_8', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR', 'DATA_MATRIX', 'UPC_EAN_EXTENSION'].map(k => Fmt[k]).filter((v: any) => v !== undefined)
      const inst = new H('scan-reader', { formatsToSupport: formats.length ? formats : undefined, experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false })
      scannerRef.current = inst
      const qrbox = (vw: number, vh: number) => { const w = Math.floor(Math.min(vw, 520) * 0.92); return { width: w, height: Math.max(130, Math.floor(w * 0.55)) } }
      await inst.start({ facingMode: 'environment' }, { fps: 12, qrbox, aspectRatio: 1.4 }, (txt: string) => handleCode(txt), () => {})
      setCamOn(true)
    } catch { flash('err', 'Camera unavailable — use a handheld or type the code') }
  }
  async function stopCamera() { try { await scannerRef.current?.stop(); await scannerRef.current?.clear() } catch { /* */ } scannerRef.current = null; setCamOn(false) }
  useEffect(() => () => { try { scannerRef.current?.stop() } catch { /* */ } }, [])

  async function search(text: string) {
    setQ(text)
    if (text.trim().length < 2) { setResults([]); return }
    const d = await api('search', { q: text })
    setResults(d?.results || [])
  }
  async function pickProduct(p: any) {
    if (meta?.mode === 'production') { setFg(p); setManualPick(false); setResults([]); setQ(''); flash('ok', `Producing: ${p.product_name || p.sku}`); return }
    const nBags = parseFloat(bags), perBag = parseFloat(wpb)
    const useWeight = byWeight && nBags > 0 && perBag > 0
    const qty = useWeight ? +(nBags * perBag).toFixed(4) : 1
    const d = await api('receive', { code: p.sku, qty, lot: lot || null, pack_qty: useWeight ? nBags : null, uom: useWeight ? wuom : null })
    if (d?.ok) { recordSuccess(d); if (useWeight) { setBags(''); setWpb('') } } else flash('err', d?.error || 'Could not add')
    setManualPick(false); setResults([]); setQ('')
  }
  async function editRowQty(r: Row, target: number) {
    const t = Math.max(0, Math.floor(Number.isFinite(target) ? target : r.qty)); const delta = t - r.qty
    if (delta === 0) return
    if (meta?.mode === 'production') { flash('info', 'Use Undo to correct production counts'); return }
    const d = await api('adjust', { product_id: r.productId, delta, lot: lot || null })
    if (!d?.ok) { flash('err', d?.error || 'Could not update'); return }
    beep(true)
    setRows(prev => prev.flatMap(x => x.key !== r.key ? [x] : (t > 0 ? [{ ...x, qty: t, onHand: d.on_hand ?? x.onHand }] : [])))
    flash('ok', `Set ${r.name} → ${t}`)
  }
  async function produceTap() {
    if (!fg) { flash('info', 'Pick a product first'); return }
    handleCode(fg.sku)
  }

  const inputCls = 'w-full rounded-xl px-4 py-3.5 text-base outline-none'
  const inputSty = { background: '#1A2035', color: '#fff', border: '1px solid #2A3350', fontSize: 16 } as const

  // ---------------- render ----------------
  if (metaErr) return <div className="min-h-[100dvh] grid place-items-center text-center px-6" style={{ background: '#0F1424', color: '#fff' }}><div><p className="text-2xl font-extrabold mb-2">Device not available</p><p className="text-sm" style={{ color: '#8A9FC0' }}>{metaErr}</p></div></div>
  if (!meta) return <div className="min-h-[100dvh] grid place-items-center" style={{ background: '#0F1424', color: '#8A9FC0' }}>Loading…</div>

  const modeColor = meta.mode === 'production' ? '#A855F7' : '#34d399'

  if (!authed) return (
    <div className="min-h-[100dvh] grid place-items-center px-6" style={{ background: '#0F1424', color: '#fff' }}>
      <div className="w-full max-w-xs text-center">
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: modeColor + '22', color: modeColor, border: `1px solid ${modeColor}` }}>{meta.mode.toUpperCase()}</span>
        <h1 className="text-2xl font-extrabold mt-3">{meta.label}</h1>
        <p className="text-sm mt-1 mb-5" style={{ color: '#8A9FC0' }}>Enter the device PIN to start scanning.</p>
        <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={e => { if (e.key === 'Enter') tryAuth() }} inputMode="numeric" type="password" placeholder="PIN" className="w-full text-center tracking-[0.4em] rounded-xl px-4 py-4 text-2xl font-extrabold outline-none" style={inputSty} autoFocus />
        {authErr && <p className="text-sm mt-2" style={{ color: '#F87171' }}>{authErr}</p>}
        <button onClick={tryAuth} className="w-full mt-4 py-4 text-base font-extrabold rounded-2xl" style={{ background: modeColor, color: '#08210f' }}>Unlock</button>
      </div>
    </div>
  )

  return (
    <div className="text-white flex flex-col" style={{ background: '#0F1424', minHeight: '100dvh' }}>
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: '#0F1424', borderBottom: '1px solid #1c2540', paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold leading-tight">{meta.label}</h1>
            <p className="text-[11px]" style={{ color: '#5A6E8A' }}>{total} {meta.mode === 'production' ? 'produced' : 'received'} this session</p>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: modeColor + '22', color: modeColor, border: `1px solid ${modeColor}` }}>{meta.mode.toUpperCase()}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4">

          {meta.mode === 'receiving' && (
            <div className="mb-3">
              <label className="text-[11px] uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Lot / batch (optional)</label>
              <input value={lot} onChange={e => setLot(e.target.value)} placeholder="Lot #" className={inputCls + ' mt-1'} style={inputSty} />
            </div>
          )}

          {meta.mode === 'production' && (
            <div className="rounded-2xl p-3.5 mb-3" style={{ background: '#1A2035', border: '1px solid #3b2a5a' }}>
              {fg ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="text-sm font-bold truncate">{fg.product_name || fg.sku}</p><p className="text-[11px] font-mono" style={{ color: '#8A9FC0' }}>{fg.sku}</p></div>
                  <button onClick={() => setFg(null)} className="text-xs px-2.5 py-1.5 rounded-lg shrink-0" style={{ background: '#0F1424', color: '#8A9FC0', border: '1px solid #2A3350' }}>Change</button>
                </div>
              ) : <p className="text-sm" style={{ color: '#C4B5FD' }}>Pick the finished product you&apos;re making, then scan/tap to count units into inventory.</p>}
              {fg && (
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => setCaseMode(false)} className="flex-1 py-2 text-sm font-bold rounded-lg" style={{ background: caseMode ? '#0F1424' : '#A855F7', color: caseMode ? '#8A9FC0' : '#fff', border: '1px solid #2A3350' }}>Unit</button>
                  <button onClick={() => setCaseMode(true)} className="flex-1 py-2 text-sm font-bold rounded-lg" style={{ background: caseMode ? '#A855F7' : '#0F1424', color: caseMode ? '#fff' : '#8A9FC0', border: '1px solid #2A3350' }}>Case{fg.case_qty ? ` (${fg.case_qty})` : ''}</button>
                </div>
              )}
            </div>
          )}

          {/* Camera */}
          <div className="rounded-2xl overflow-hidden mb-3" style={{ background: '#000', border: '1px solid #2A3350' }}>
            <div id="scan-reader" style={{ width: '100%', minHeight: camOn ? 300 : 0 }} />
            {!camOn ? <button onClick={startCamera} className="w-full py-4 text-base font-extrabold" style={{ background: '#3B6FE0', color: '#fff' }}>📷 Start camera</button>
              : <button onClick={stopCamera} className="w-full py-3 text-sm font-semibold" style={{ background: '#1A2035', color: '#8A9FC0' }}>Stop camera</button>}
          </div>

          <form onSubmit={e => { e.preventDefault(); const v = manual; setManual(''); handleCode(v) }} className="mb-3">
            <input value={manual} onChange={e => setManual(e.target.value)} inputMode="text" placeholder="…or scan with a handheld / type a code" className={inputCls} style={inputSty} autoComplete="off" />
          </form>

          {meta.mode === 'production' && fg && (
            <button onClick={produceTap} className="w-full mb-3 py-4 text-base font-extrabold rounded-2xl" style={{ background: '#A855F7', color: '#fff' }}>+ Produce {caseMode && fg.case_qty ? `1 case (${fg.case_qty})` : '1 unit'}</button>
          )}

          {meta.mode === 'receiving' && (
            <>
              <button type="button" onClick={() => setByWeight(v => !v)} className="w-full mb-2 py-3 text-sm font-bold rounded-xl" style={{ background: byWeight ? '#33261A' : '#1A2035', color: '#FBBF24', border: '1px solid #2A3350' }}>⚖️ Receive by weight (bags){byWeight ? ' — on' : ''}</button>
              {byWeight && (
                <div className="rounded-2xl p-3.5 mb-3" style={{ background: '#1A2035', border: '1px solid #7c5b1f' }}>
                  <div className="grid grid-cols-3 gap-2">
                    <div><label className="text-[10px] uppercase" style={{ color: '#8A9FC0' }}>Bags</label><input value={bags} onChange={e => setBags(e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-lg px-2.5 py-2.5 outline-none" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} /></div>
                    <div><label className="text-[10px] uppercase" style={{ color: '#8A9FC0' }}>Wt / bag</label><input value={wpb} onChange={e => setWpb(e.target.value)} inputMode="decimal" placeholder="0" className="w-full rounded-lg px-2.5 py-2.5 outline-none" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} /></div>
                    <div><label className="text-[10px] uppercase" style={{ color: '#8A9FC0' }}>UOM</label><select value={wuom} onChange={e => setWuom(e.target.value)} className="w-full rounded-lg px-2 py-2.5 outline-none appearance-none" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }}>{['kg', 'lb', 'g', 'oz', 'Packs', 'Cases', 'Ea.', 'Rolls'].map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                  </div>
                  {parseFloat(bags) > 0 && parseFloat(wpb) > 0 && <p className="text-[13px] font-bold mt-2.5" style={{ color: '#34d399' }}>= {(parseFloat(bags) * parseFloat(wpb)).toLocaleString()} {wuom}</p>}
                </div>
              )}
            </>
          )}

          <button type="button" onClick={() => { setManualPick(v => !v); setResults([]); setQ('') }} className="w-full mb-3 py-3 text-sm font-bold rounded-xl" style={{ background: manualPick ? '#0e2a3a' : '#1A2035', color: '#7DD3FC', border: '1px solid #2A3350' }}>{meta.mode === 'production' ? '🔎 Pick a product to make' : '➕ Add an item without scanning'}</button>
          {manualPick && (
            <div className="rounded-2xl p-3.5 mb-4" style={{ background: '#1A2035', border: '1px solid #3B6FE0' }}>
              <input autoFocus value={q} onChange={e => search(e.target.value)} placeholder="Search product by name or SKU…" className="w-full rounded-xl px-4 py-3 text-base outline-none mb-2" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350', fontSize: 16 }} />
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {results.map(p => <button key={p.id} onClick={() => pickProduct(p)} className="w-full text-left px-3.5 py-3 rounded-xl text-sm" style={{ background: '#0F1424', color: '#fff', border: '1px solid #2A3350' }}><span className="font-semibold">{p.product_name || p.sku}</span> <span className="font-mono text-xs" style={{ color: '#8A9FC0' }}>{p.sku}</span></button>)}
                {q.trim().length >= 2 && results.length === 0 && <p className="text-xs italic px-1" style={{ color: '#5A6E8A' }}>No matching products.</p>}
              </div>
            </div>
          )}

          {/* Session list */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5A6E8A' }}>This session</p>
            <p className="text-2xl font-extrabold" style={{ color: modeColor }}>{total}<span className="text-sm font-bold" style={{ color: '#5A6E8A' }}> {meta.mode === 'production' ? 'made' : 'recvd'}</span></p>
          </div>
          <div className="space-y-2 pb-6">
            {rows.length === 0 && <p className="text-sm italic" style={{ color: '#5A6E8A' }}>Nothing yet.</p>}
            {rows.map(r => {
              const cq = r.caseQty > 1 ? r.caseQty : 0
              const cases = cq ? Math.floor(r.qty / cq) : 0
              const rem = cq ? r.qty % cq : 0
              return (
                <div key={r.key} className="rounded-xl px-3.5 py-3" style={{ background: '#1A2035', border: '1px solid #2A3350' }}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{r.name}</p><p className="text-[11px] font-mono" style={{ color: '#8A9FC0' }}>{r.sku}{r.onHand != null ? ` · on hand ${r.onHand}` : ''}</p></div>
                    {meta.mode === 'receiving' && <button onClick={() => editRowQty(r, r.qty - 1)} className="text-lg w-9 h-9 rounded-lg shrink-0" style={{ background: '#0F1424', color: '#8A9FC0', border: '1px solid #2A3350' }}>−</button>}
                    <span className="text-lg font-extrabold px-1 shrink-0" style={{ color: modeColor }}>×{r.qty}</span>
                    {meta.mode === 'receiving' && <button onClick={() => editRowQty(r, r.qty + 1)} className="text-lg w-9 h-9 rounded-lg shrink-0" style={{ background: '#0F1424', color: '#34d399', border: '1px solid #2A3350' }}>+</button>}
                  </div>
                  {cq > 0 && <p className="text-[11px] mt-1.5 font-semibold" style={{ color: '#FBBF24' }}>{r.qty} packs = {cases} case{cases === 1 ? '' : 's'}{rem > 0 ? ` + ${rem} pack${rem === 1 ? '' : 's'}` : ''} · {cq}/case</p>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {toast && <div className="fixed left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-bold shadow-xl z-[80]" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 24px)', background: toast.kind === 'ok' ? '#059669' : toast.kind === 'err' ? '#DC2626' : '#D97706', color: '#fff' }}>{toast.text}</div>}
    </div>
  )
}
