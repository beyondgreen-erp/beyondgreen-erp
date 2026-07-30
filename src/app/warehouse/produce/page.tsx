'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ZonePicker from '@/components/ZonePicker'

interface FG { id: string; sku: string; product_name: string; case_qty: number | null }
interface Comp { sku: string; name: string | null; consumed: number; uom: string; on_hand: number | null; short: boolean; missing: boolean }
const FINANCE = 'finance@beyondgreenbiotech.com'

export default function ProductionScanPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState('')

  const [mode, setMode] = useState<'setup' | 'scan'>('setup')
  const [unitMode, setUnitMode] = useState<'unit' | 'case'>('unit')
  const [fg, setFg] = useState<FG | null>(null)
  const [fgList, setFgList] = useState<FG[]>([])
  const [fgLoading, setFgLoading] = useState(true)
  const [planLines, setPlanLines] = useState<any[]>([])
  const [planLineId, setPlanLineId] = useState<string>('')

  const [units, setUnits] = useState(0)            // total finished units this run
  const [scans, setScans] = useState(0)            // number of scans/taps
  const movementsRef = useRef<string[]>([])
  const [lastComps, setLastComps] = useState<Comp[]>([])
  const [noBom, setNoBom] = useState(false)
  const [shortAny, setShortAny] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [manual, setManual] = useState('')
  const busyRef = useRef(false)
  const pausedRef = useRef(false)
  const lastRef = useRef<{ code: string; t: number }>({ code: '', t: 0 })
  const scannerRef = useRef<any>(null)

  const [zoneOpen, setZoneOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const photoRef = useRef<string[]>([])

  // app-like: lock zoom + dark bg
  useEffect(() => {
    const head = document.head
    let m = head.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
    const prev = m?.getAttribute('content') || null
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; head.appendChild(m) }
    m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    const pbg = document.body.style.background; document.body.style.background = '#0F1424'
    return () => { if (m && prev) m.setAttribute('content', prev); document.body.style.background = pbg }
  }, [])

  useEffect(() => { sb.auth.getUser().then(({ data }) => { if (data.user?.email) setEmail(data.user.email) }) }, [sb])

  useEffect(() => { (async () => {
    setFgLoading(true)
    const { data } = await sb.from('products').select('id,sku,product_name,case_qty').eq('is_active', true).eq('requires_bom', true).order('product_name')
    setFgList((data as FG[]) || [])
    setFgLoading(false)
    const { data: lines } = await sb.from('production_plan_lines')
      .select('id,plan_id,machine_code,product,operator,production_day_plans!inner(plan_date)')
      .eq('production_day_plans.plan_date', new Date().toISOString().slice(0, 10)).order('sort_order')
    setPlanLines((lines as any[]) || [])
  })() }, [sb])

  const unitsPerScan = unitMode === 'case' ? (fg?.case_qty || 1) : 1

  function beep(ok = true) {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      const ac = new AC(); const o = ac.createOscillator(); const g = ac.createGain()
      o.connect(g); g.connect(ac.destination); o.frequency.value = ok ? 880 : 240
      g.gain.value = 0.06; o.start(); setTimeout(() => { o.stop(); ac.close() }, ok ? 90 : 200)
    } catch { /* */ }
    try { (navigator as any).vibrate?.(ok ? 35 : [40, 30, 40]) } catch { /* */ }
  }
  function flash(kind: 'ok' | 'err' | 'info', text: string) { setToast({ kind, text }); setTimeout(() => setToast(t => (t && t.text === text ? null : t)), 2000) }

  async function sendEmail(subject: string, html: string) {
    try { await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: FINANCE, subject, html }) }) } catch { /* */ }
  }

  function beginRun() {
    if (!fg) { flash('err', 'Pick a finished good'); return }
    setUnits(0); setScans(0); movementsRef.current = []; setLastComps([]); setNoBom(false); setShortAny(false); photoRef.current = []
    setMode('scan')
  }

  const produce = useCallback(async (code: string) => {
    if (!fg || busyRef.current) return
    busyRef.current = true
    try {
      const { data, error } = await sb.rpc('produce_scan', { p_code: code, p_qty: unitsPerScan, p_wo_id: planLineId || null, p_user: email || null })
      if (error) { beep(false); flash('err', 'Failed: ' + error.message); return }
      if (!(data as any)?.ok) { beep(false); flash('err', 'Could not record'); return }
      const d: any = data
      beep(true)
      movementsRef.current = [...movementsRef.current, d.movement_id]
      setUnits(u => u + unitsPerScan); setScans(s => s + 1)
      const comps: Comp[] = d.components || []
      setLastComps(comps)
      if (!d.bom_found) setNoBom(true)
      if (comps.some(c => c.short)) setShortAny(true)
      flash('ok', `✓ +${unitsPerScan} ${d.product_name || d.sku}`)
    } finally { busyRef.current = false }
  }, [sb, fg, unitsPerScan, planLineId, email])

  const handleCode = useCallback(async (raw: string) => {
    const code = (raw || '').trim()
    if (!code || busyRef.current || pausedRef.current || !fg) return
    const now = Date.now()
    if (lastRef.current.code === code && now - lastRef.current.t < 1200) return
    lastRef.current = { code, t: now }
    const { data: pid } = await sb.rpc('find_product_by_code', { p_code: code })
    if (pid && pid !== fg.id) { beep(false); flash('err', 'That barcode is a different product'); return }
    await produce(fg.sku)   // produce the selected finished good
  }, [sb, fg, produce])

  async function startCamera() {
    try {
      if (!(window as any).Html5Qrcode) {
        await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => res(); s.onerror = () => rej(new Error('load')); document.head.appendChild(s) })
      }
      const H = (window as any).Html5Qrcode
      const Fmt = (window as any).Html5QrcodeSupportedFormats || {}
      const formats = ['QR_CODE', 'UPC_A', 'UPC_E', 'EAN_13', 'EAN_8', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR', 'DATA_MATRIX', 'UPC_EAN_EXTENSION'].map(k => Fmt[k]).filter((v: any) => v !== undefined)
      const inst = new H('prod-reader', { formatsToSupport: formats.length ? formats : undefined, experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false })
      scannerRef.current = inst
      const qrbox = (vw: number) => { const w = Math.floor(Math.min(vw, 520) * 0.92); return { width: w, height: Math.max(130, Math.floor(w * 0.55)) } }
      await inst.start({ facingMode: 'environment' }, { fps: 12, qrbox, aspectRatio: 1.4 }, (t: string) => handleCode(t), () => {})
      setCamOn(true)
    } catch { flash('err', 'Camera unavailable — use the +Produced button') }
  }
  async function stopCamera() { try { await scannerRef.current?.stop(); await scannerRef.current?.clear() } catch { /* */ } scannerRef.current = null; setCamOn(false) }
  useEffect(() => () => { try { scannerRef.current?.stop() } catch { /* */ } }, [])

  async function undoLast() {
    const mid = movementsRef.current[movementsRef.current.length - 1]; if (!mid) return
    const { error } = await sb.rpc('undo_production', { p_movement_id: mid })
    if (error) { flash('err', 'Undo failed'); return }
    movementsRef.current = movementsRef.current.slice(0, -1)
    setUnits(u => Math.max(0, u - unitsPerScan)); setScans(s => Math.max(0, s - 1))
    flash('info', `Undid ${unitsPerScan}`)
  }

  function productionComplete() {
    if (units <= 0) { flash('info', 'Nothing produced yet'); return }
    if (camOn) stopCamera()
    setZoneOpen(true)
  }

  async function finalize() {
    setFinishing(true)
    if (planLineId) {
      const line = planLines.find(l => l.id === planLineId)
      try { await sb.from('production_output_logs').insert({ plan_line_id: planLineId, plan_id: line?.plan_id || null, output_qty: units, unit: unitMode === 'case' ? 'cases' : 'units', running_status: 'logged', operator: email || null, note: 'production scan' }) } catch { /* */ }
    }
    let zones: string[] = []
    try { const { data: pz } = await sb.from('product_zones').select('storage_zones(code)').eq('product_id', fg!.id); zones = ((pz as any[]) || []).map(r => r.storage_zones?.code).filter(Boolean) } catch { /* */ }
    const compRows = lastComps.map(c => `<tr><td style="padding:4px 10px">${c.name || c.sku}</td><td style="padding:4px 10px">${c.sku}</td><td style="padding:4px 10px;text-align:right">${c.missing ? 'n/a' : Number(c.consumed).toLocaleString()}</td><td style="padding:4px 10px">${c.missing ? '<b style=color:#b45309>not in inventory</b>' : (c.short ? `<b style=color:#dc2626>SHORT (${c.on_hand})</b>` : c.on_hand)}</td></tr>`).join('')
    const photoHtml = photoRef.current.map(u => `<a href="${u}"><img src="${u}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;margin:4px" /></a>`).join('')
    await sendEmail(
      `Production · ${fg?.product_name || fg?.sku} — ${units} unit(s)`,
      `<p>Produced <b>${units}</b> ${unitMode === 'case' ? 'unit(s) (case mode)' : 'unit(s)'} of <b>${fg?.product_name}</b> (${fg?.sku}).</p>
       ${noBom ? '<p style="color:#b45309"><b>⚠ No BOM defined — components were not deducted.</b></p>' : `<p><b>Components consumed (per last scan × ${scans} scans shown as latest levels):</b></p>
       <table style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9"><th style="padding:4px 10px;text-align:left">Component</th><th style="padding:4px 10px;text-align:left">SKU</th><th style="padding:4px 10px">Consumed/scan</th><th style="padding:4px 10px">On hand</th></tr></thead><tbody>${compRows}</tbody></table>`}
       ${shortAny ? '<p style="color:#dc2626"><b>⚠ One or more components went negative — purchasing should reconcile.</b></p>' : ''}
       <p>Storage zone(s): <b>${zones.join(', ') || '—'}</b></p>
       ${photoHtml ? `<p><b>Photo:</b></p><div>${photoHtml}</div>` : ''}
       <p style="color:#64748b;font-size:12px">Logged by ${email || 'unknown'} on ${new Date().toLocaleString()}.</p>`
    )
    setFinishing(false)
    flash('ok', `Produced ${units}. Inventory updated, finance notified.`)
    setMode('setup'); setFg(null); setPlanLineId(''); setUnits(0); setScans(0); movementsRef.current = []; setLastComps([]); setNoBom(false); setShortAny(false); photoRef.current = []
  }

  const inputCls = 'w-full rounded-xl px-4 py-3.5 text-base outline-none appearance-none'
  const inputSty = { background: '#1A2035', color: '#fff', border: '1px solid #2A3350', fontSize: 16 } as const

  return (
    <div className="text-white flex flex-col" style={{ background: '#0F1424', minHeight: '100dvh' }}>
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: '#0F1424', borderBottom: '1px solid #1c2540', paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-lg font-extrabold">Production Scan</h1>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#d9770620', color: '#fbbf24', border: '1px solid #7c5b1f' }}>PRODUCTION</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4">
          {mode === 'setup' && (
            <>
              <p className="text-sm mb-3" style={{ color: '#8A9FC0' }}>Scan finished goods off the line — inventory goes up and the BOM components come down.</p>

              <label className="text-[11px] uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Counting by</label>
              <div className="grid grid-cols-2 gap-2 mt-1 mb-3">
                {(['unit', 'case'] as const).map(u => (
                  <button key={u} onClick={() => setUnitMode(u)} className="py-3 rounded-xl text-sm font-bold" style={{ background: unitMode === u ? '#3B6FE0' : '#1A2035', color: unitMode === u ? '#fff' : '#8A9FC0', border: '1px solid #2A3350' }}>{u === 'unit' ? 'Units' : 'Cases'}</button>
                ))}
              </div>

              <label className="text-[11px] uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Finished good</label>
              <div className="relative mt-1 mb-3">
                <select value={fg?.id || ''} onChange={e => setFg(fgList.find(x => x.id === e.target.value) || null)} className={inputCls + ' pr-10'} style={inputSty}>
                  <option value="" disabled>{fgLoading ? 'Loading…' : `Select a finished good (${fgList.length})…`}</option>
                  {fgList.map(p => (<option key={p.id} value={p.id}>{p.product_name} · {p.sku}{p.case_qty ? ` · case ${p.case_qty}` : ''}</option>))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" style={{ color: '#8A9FC0' }}>▾</span>
              </div>

              {planLines.length > 0 && (
                <>
                  <label className="text-[11px] uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Attach to today&apos;s daily-plan line (optional)</label>
                  <div className="relative mt-1 mb-3">
                    <select value={planLineId} onChange={e => setPlanLineId(e.target.value)} className={inputCls + ' pr-10'} style={inputSty}>
                      <option value="">None</option>
                      {planLines.map(l => (<option key={l.id} value={l.id}>{[l.machine_code, l.product, l.operator].filter(Boolean).join(' · ')}</option>))}
                    </select>
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" style={{ color: '#8A9FC0' }}>▾</span>
                  </div>
                </>
              )}

              <button onClick={beginRun} disabled={!fg} className="w-full mt-2 py-3.5 text-base font-extrabold rounded-xl disabled:opacity-40" style={{ background: '#D97706', color: '#fff' }}>Start production run →</button>
            </>
          )}

          {mode === 'scan' && fg && (
            <>
              <div className="rounded-xl px-3.5 py-2.5 mb-3" style={{ background: '#d9770614', border: '1px solid #7c5b1f' }}>
                <p className="text-[13px] font-bold truncate">{fg.product_name}</p>
                <p className="text-[11px]" style={{ color: '#8A9FC0' }}>{fg.sku} · counting {unitMode === 'case' ? `cases (${fg.case_qty || 1}/case)` : 'units'}{planLineId ? ' · linked to plan' : ''}</p>
                <button onClick={() => { if (camOn) stopCamera(); setMode('setup') }} className="text-[11px] mt-1" style={{ color: '#8A9FC0' }}>← change / cancel</button>
              </div>

              <button onClick={() => produce(fg.sku)} className="w-full py-5 text-lg font-extrabold rounded-2xl mb-3" style={{ background: '#059669', color: '#fff', boxShadow: '0 6px 20px rgba(5,150,105,0.35)' }}>＋ Produced {unitMode === 'case' ? `1 case (+${unitsPerScan})` : '1'}</button>

              <div className="rounded-2xl overflow-hidden mb-3" style={{ background: '#000', border: '1px solid #2A3350' }}>
                <div id="prod-reader" style={{ width: '100%', minHeight: camOn ? 300 : 0 }} />
                {!camOn
                  ? <button onClick={startCamera} className="w-full py-3 text-sm font-bold" style={{ background: '#1A2035', color: '#93C5FD' }}>📷 …or scan the finished-good barcode</button>
                  : <button onClick={stopCamera} className="w-full py-3 text-sm font-semibold" style={{ background: '#1A2035', color: '#8A9FC0' }}>Stop camera</button>}
              </div>

              <form onSubmit={e => { e.preventDefault(); const v = manual; setManual(''); handleCode(v) }} className="mb-4">
                <input value={manual} onChange={e => setManual(e.target.value)} placeholder="…or scan with a handheld / type a code" className="w-full rounded-xl px-4 py-3.5 text-base outline-none" style={inputSty} autoComplete="off" />
              </form>

              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5A6E8A' }}>Produced this run</p>
                <p className="text-2xl font-extrabold" style={{ color: '#34d399' }}>{units}<span className="text-sm font-bold" style={{ color: '#5A6E8A' }}> unit(s)</span></p>
              </div>

              {noBom && <div className="rounded-xl px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#33261A', color: '#FBBF24', border: '1px solid #7c5b1f' }}>⚠ No BOM for this item — components are not being deducted.</div>}
              {shortAny && <div className="rounded-xl px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#2a1a1a', color: '#FCA5A5', border: '1px solid #DC2626' }}>⚠ A component has gone negative — flag purchasing.</div>}

              {lastComps.length > 0 && (
                <div className="rounded-xl px-3 py-2.5 mb-2" style={{ background: '#1A2035', border: '1px solid #2A3350' }}>
                  <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: '#5A6E8A' }}>Deducted last scan</p>
                  {lastComps.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-[12px] py-0.5">
                      <span className="truncate mr-2">{c.name || c.sku}</span>
                      <span style={{ color: c.missing ? '#FBBF24' : c.short ? '#FCA5A5' : '#8A9FC0' }}>{c.missing ? 'not tracked' : `−${Number(c.consumed).toLocaleString()} → ${c.on_hand}`}</span>
                    </div>
                  ))}
                </div>
              )}

              {scans > 0 && <button onClick={undoLast} className="w-full py-2.5 text-sm font-semibold rounded-xl mb-6" style={{ background: '#0F1424', color: '#F87171', border: '1px solid #3a2530' }}>↩ Undo last ({unitsPerScan})</button>}
            </>
          )}
        </div>
      </div>

      {mode === 'scan' && (
        <div className="sticky bottom-0 z-20 px-4 pt-3" style={{ background: 'linear-gradient(180deg, rgba(15,20,36,0) 0%, #0F1424 22%)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}>
          <div className="max-w-md mx-auto">
            <button onClick={productionComplete} disabled={units <= 0} className="w-full py-4 text-base font-extrabold rounded-2xl disabled:opacity-40" style={{ background: '#D97706', color: '#fff', boxShadow: '0 6px 20px rgba(217,119,6,0.35)' }}>✓ Production complete — store ({units})</button>
          </div>
        </div>
      )}

      {zoneOpen && fg && (
        <ZonePicker
          productId={fg.id}
          productName={`${fg.product_name}  (${units})`}
          currentUserEmail={email}
          stepLabel="Where is the finished stock stored? Tap zone(s) + photo"
          capturePhoto
          photoRequired
          onPhoto={(url) => { photoRef.current = [...photoRef.current, url] }}
          onCancel={() => { setZoneOpen(false); flash('info', 'Storage skipped — production still recorded'); setMode('setup'); setFg(null); setUnits(0); setScans(0); movementsRef.current = [] }}
          onClose={() => { setZoneOpen(false); void finalize() }}
        />
      )}

      {finishing && (<div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(15,20,36,0.7)' }}><p className="text-white text-sm font-bold">Saving & notifying finance…</p></div>)}
      {toast && (<div className="fixed left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-bold shadow-xl z-[80]" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)', background: toast.kind === 'ok' ? '#059669' : toast.kind === 'err' ? '#DC2626' : '#D97706', color: '#fff' }}>{toast.text}</div>)}
    </div>
  )
}
