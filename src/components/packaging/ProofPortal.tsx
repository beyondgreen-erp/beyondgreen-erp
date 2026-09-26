'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// External printer proof portal — lives outside the ERP (own host), token-gated.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import * as fabric from 'fabric'
import { restore } from '@/lib/packaging/canvasIO'
import { buildProofObjects, loadBrandLogo, sheetLayout, drawProof } from '@/lib/packaging/proofTemplate'
import { loadFamily } from '@/lib/packaging/fonts'
import { exportDesign, exportProofSheet, downloadBlob, DEFAULT_EXPORT, type ExportFormat } from '@/lib/packaging/exporters'
import { fmtUnit, safeFileName, type DesignDoc } from '@/lib/packaging/doc'
import CommentsPanel, { type PkgComment } from './CommentsPanel'
import SpecSheet from './SpecSheet'
import { ACTIVITY_LABELS } from '@/lib/packaging/activity'

interface Payload {
  link: { printer_company: string | null; printer_contact: string | null; printer_email: string | null; message: string | null; allow_download: boolean; allow_comments: boolean; expires_at: string | null }
  design: { name: string; customer_name: string | null; sku: string | null; product_type: string | null; status: string; width_pt: number; height_pt: number; unit: 'in' | 'mm' | 'pt'; updated_at: string }
  doc: DesignDoc | null
  assets: Record<string, string>
  files: { id: string; format: string; file_name: string; size_bytes: number | null; created_at: string; label: string | null; url: string | null }[]
  source?: { name: string; size: number; sha256: string; uploaded_at: string; url: string } | null
  approval?: { round_no: number; status: string; submitted_at: string; submitted_by_name: string; printer_note: string | null; approved_at: string | null; approval_sent_at: string | null; closed_note: string | null; source_name: string; source_sha256: string; approved_url: string | null; approvers: { name: string; decision: string | null; decided_at: string | null }[]; confirmed: number; total: number } | null
  activity?: { actor_type: string; actor_name: string | null; action: string; details: any; created_at: string }[]
  comments: PkgComment[]
}

const fmtSize = (n?: number | null) => !n ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`

export default function ProofPortal() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string)
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [who, setWho] = useState<{ name: string; email: string } | null>(null)
  const [gate, setGate] = useState({ name: '', email: '' })
  const [tab, setTab] = useState<'comments' | 'specs' | 'downloads' | 'activity'>('comments')
  const [submitOpen, setSubmitOpen] = useState(false)
  const [sub, setSub] = useState({ sizes: false, colours: false, note: '', busy: false, err: '' })
  const [mode, setMode] = useState<'view' | 'comment'>('view')
  const [draft, setDraft] = useState<{ x: number; y: number; w?: number; h?: number } | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(true)
  const [showDieline, setShowDieline] = useState(true)
  const [vpt, setVpt] = useState<number[]>([1, 0, 0, 1, 0, 0])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fcRef = useRef<fabric.StaticCanvas | null>(null)
  const docRef = useRef<DesignDoc | null>(null)
  const updatedRef = useRef<string>('')
  const dragRef = useRef<any>(null)
  const [dragBox, setDragBox] = useState<any>(null)

  const storageKey = `bg-proof-who-${token}`
  useEffect(() => {
    try { const s = localStorage.getItem(storageKey); if (s) setWho(JSON.parse(s)) } catch { /* private mode */ }
  }, [storageKey])

  const fetchData = useCallback(async (first = false) => {
    let whoName = ''
    try { whoName = JSON.parse(localStorage.getItem(`bg-proof-who-${token}`) || '{}').name || '' } catch { /* ignore */ }
    const r = await fetch(`/api/proof/${token}${first ? '?view=1&who=' + encodeURIComponent(whoName) : ''}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({ error: 'Could not load this proof.' }))
    if (!r.ok) { setErr(j.error || 'Could not load this proof.'); return null }
    return j as Payload
  }, [token])

  const proofObjsRef = useRef<fabric.FabricObject[]>([])
  const renderDoc = useCallback(async (p: Payload) => {
    const fc = fcRef.current
    if (!fc || !p.doc) return
    setRendering(true)
    docRef.current = p.doc
    await restore(fc, p.doc, async (path) => {
      const url = p.assets[path]; if (!url) throw new Error('missing asset')
      const b = await (await fetch(url)).blob(); return URL.createObjectURL(b)
    })
    applyVisibility(p.doc, showDieline)
    proofObjsRef.current = []
    if (p.doc.proof && p.doc.proof.enabled !== false) {
      try {
        const [logo] = await Promise.all([loadBrandLogo(), loadFamily('Inter')])
        proofObjsRef.current = buildProofObjects(p.doc.proof, p.doc.width, p.doc.height, logo)
      } catch { /* sheet is optional */ }
    }
    fit()
    setRendering(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyVisibility = (doc: DesignDoc, dieline: boolean) => {
    const fc = fcRef.current; if (!fc) return
    const byId = new Map(doc.layers.map(l => [l.id, l]))
    const rank = (o: any) => { const i = doc.layers.findIndex(l => l.id === o.layerId); return i < 0 ? doc.layers.length : i }
    ;(fc as any)._objects.sort((a: any, b: any) => rank(b) - rank(a))
    for (const o of fc.getObjects() as any[]) {
      const l = byId.get(o.layerId)
      o.visible = !!l && l.visible && (dieline || l.kind !== 'dieline')
    }
    fc.requestRenderAll()
  }

  // bootstrap
  useEffect(() => {
    document.title = 'Packaging proof — beyondGREEN'
    let alive = true
    ;(async () => {
      const p = await fetchData(true)
      if (!alive || !p) return
      setData(p); updatedRef.current = p.design.updated_at
      if (p.link.printer_contact || p.link.printer_email) setGate({ name: p.link.printer_contact || '', email: p.link.printer_email || '' })
    })()
    return () => { alive = false }
  }, [fetchData])

  // create the static canvas once the container exists
  useEffect(() => {
    if (!data || !canvasElRef.current || fcRef.current) return
    const fc = new fabric.StaticCanvas(canvasElRef.current, { backgroundColor: '#E5E7EB', enableRetinaScaling: true } as any)
    fcRef.current = fc
    const origBg = (fc as any)._renderBackground.bind(fc)
    ;(fc as any)._renderBackground = (ctx: CanvasRenderingContext2D) => {
      origBg(ctx)
      const d = docRef.current
      if (ctx !== fc.getContext() || !d) return
      const v = fc.viewportTransform
      ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
      if (proofObjsRef.current.length) {
        const L = sheetLayout(d.width, d.height)
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 14; ctx.fillStyle = '#fff'; ctx.fillRect(L.x, L.y, L.w, L.h); ctx.restore()
        drawProof(ctx, proofObjsRef.current)
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, d.width, d.height)
      } else { ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 14; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, d.width, d.height) }
      ctx.restore()
    }
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => { fc.setDimensions({ width: el.clientWidth, height: el.clientHeight }); fc.requestRenderAll(); setVpt(fc.viewportTransform.slice()) })
    ro.observe(el)
    fc.setDimensions({ width: el.clientWidth, height: el.clientHeight })
    renderDoc(data)
    return () => { ro.disconnect(); fc.dispose(); fcRef.current = null }
  }, [data ? 1 : 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // poll for new comments / artwork updates
  useEffect(() => {
    if (!data) return
    const t = setInterval(async () => {
      const p = await fetchData(false); if (!p) return
      setData(prev => prev ? { ...prev, comments: p.comments, files: p.files, link: p.link, design: p.design, approval: p.approval, activity: p.activity, source: p.source } : p)
      if (p.design.updated_at !== updatedRef.current) {
        updatedRef.current = p.design.updated_at
        await renderDoc(p)
        setNotice('The artwork was just updated by beyondGREEN.'); setTimeout(() => setNotice(null), 6000)
      }
    }, 20000)
    return () => clearInterval(t)
  }, [data ? 1 : 0, fetchData, renderDoc]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (docRef.current) applyVisibility(docRef.current, showDieline) }, [showDieline])

  // ── view helpers ──
  const fit = () => {
    const fc = fcRef.current, d = docRef.current; if (!fc || !d) return
    const r = proofObjsRef.current.length ? sheetLayout(d.width, d.height) : { x: 0, y: 0, w: d.width, h: d.height }
    const W = fc.getWidth(), H = fc.getHeight(), z = Math.min((W - 60) / r.w, (H - 60) / r.h)
    fc.setViewportTransform([z, 0, 0, z, (W - r.w * z) / 2 - r.x * z, (H - r.h * z) / 2 - r.y * z]); setVpt(fc.viewportTransform.slice())
  }
  const zoomAt = (z: number, px?: number, py?: number) => {
    const fc = fcRef.current; if (!fc) return
    z = Math.max(0.05, Math.min(40, z))
    fc.zoomToPoint(new fabric.Point(px ?? fc.getWidth() / 2, py ?? fc.getHeight() / 2), z); setVpt(fc.viewportTransform.slice())
  }
  const toScene = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect(), v = vpt
    return { x: (clientX - r.left - v[4]) / v[0], y: (clientY - r.top - v[5]) / v[3], sx: clientX - r.left, sy: clientY - r.top }
  }
  const toScreen = (x: number, y: number) => ({ x: x * vpt[0] + vpt[4], y: y * vpt[3] + vpt[5] })

  const onWheel = (e: React.WheelEvent) => {
    const fc = fcRef.current; if (!fc) return
    const r = wrapRef.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) zoomAt(fc.getZoom() * Math.pow(0.998, e.deltaY), e.clientX - r.left, e.clientY - r.top)
    else { fc.relativePan(new fabric.Point(-e.deltaX, -e.deltaY)); setVpt(fc.viewportTransform.slice()) }
  }
  useEffect(() => {
    const el = wrapRef.current; if (!el) return
    const stop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false }); return () => el.removeEventListener('wheel', stop)
  }, [data ? 1 : 0])

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const p = toScene(e.clientX, e.clientY)
    dragRef.current = { kind: mode === 'comment' ? 'area' : 'pan', start: p, last: { x: e.clientX, y: e.clientY }, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const dr = dragRef.current; if (!dr) return
    const fc = fcRef.current!
    if (Math.abs(e.clientX - dr.last.x) + Math.abs(e.clientY - dr.last.y) > 2) dr.moved = true
    if (dr.kind === 'pan') { fc.relativePan(new fabric.Point(e.clientX - dr.last.x, e.clientY - dr.last.y)); dr.last = { x: e.clientX, y: e.clientY }; setVpt(fc.viewportTransform.slice()) }
    else { const p = toScene(e.clientX, e.clientY); dr.cur = p; setDragBox({ x0: Math.min(dr.start.sx, p.sx), y0: Math.min(dr.start.sy, p.sy), x1: Math.max(dr.start.sx, p.sx), y1: Math.max(dr.start.sy, p.sy) }) }
  }
  const onUp = () => {
    const dr = dragRef.current; dragRef.current = null; setDragBox(null)
    if (!dr || dr.kind !== 'area') return
    const d = docRef.current; if (!d) return
    const a = dr.start, b = dr.cur || dr.start
    const inside = (p: any) => p.x >= -1 && p.y >= -1 && p.x <= d.width + 1 && p.y <= d.height + 1
    if (!inside(a)) { setNotice('Click on the artwork to place a comment.'); setTimeout(() => setNotice(null), 3000); return }
    const small = Math.abs(b.sx - a.sx) < 6 && Math.abs(b.sy - a.sy) < 6
    if (!who) { setNotice('Please enter your name first.'); return }
    setDraft(small ? { x: a.x, y: a.y } : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })
    setTab('comments')
  }

  // ── comments ──
  const post = async (payload: any) => {
    const r = await fetch(`/api/proof/${token}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, author_name: who?.name, author_email: who?.email }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert(j.error || 'Could not post.'); return null }
    const p = await fetchData(false); if (p) setData(prev => prev ? { ...prev, comments: p.comments } : p)
    return j.comment
  }
  const submitDraft = async (body: string) => {
    if (!draft) return
    const c = await post({ body, ...draft })
    if (c) { setDraft(null); setMode('view'); setFocusId(c.id) }
  }
  const focus = (id: string) => {
    setFocusId(id)
    const c = data?.comments.find(x => x.id === id); const fc = fcRef.current
    if (!c || !fc || c.x == null) return
    const z = fc.getZoom(), cx = Number(c.x) + (Number(c.w) || 0) / 2, cy = Number(c.y) + (Number(c.h) || 0) / 2
    fc.setViewportTransform([z, 0, 0, z, fc.getWidth() / 2 - cx * z, fc.getHeight() / 2 - cy * z]); setVpt(fc.viewportTransform.slice())
  }

  // ── downloads of the current working file ──
  const exportCurrent = async (fmt: ExportFormat) => {
    const fc = fcRef.current, d = docRef.current; if (!fc || !d || !data) return
    setBusy(fmt.toUpperCase())
    try {
      const r = await exportDesign(fc, { width: d.width, height: d.height, title: data.design.name, layers: d.layers }, fmt, { ...DEFAULT_EXPORT, includeDieline: true })
      downloadBlob(r.blob, `${safeFileName(data.design.name)}_proof.${fmt}`)
    } catch (e: any) { alert(e?.message || 'Export failed') } finally { setBusy(null) }
  }

  const logDownload = (file: string, kind: string) => {
    try { fetch(`/api/proof/${token}/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'downloaded', file, kind, name: who?.name, email: who?.email }), keepalive: true }) } catch { /* ignore */ }
  }
  const submitForApproval = async () => {
    if (!who) return
    setSub(s => ({ ...s, busy: true, err: '' }))
    const r = await fetch(`/api/proof/${token}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: who.name, email: who.email, note: sub.note, checked_sizes: sub.sizes, checked_colours: sub.colours }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setSub(s => ({ ...s, busy: false, err: j.error || 'Could not submit' })); return }
    setSub({ sizes: false, colours: false, note: '', busy: false, err: '' }); setSubmitOpen(false)
    const p = await fetchData(false); if (p) setData(prev => prev ? { ...prev, approval: p.approval, activity: p.activity } : p)
  }
  const exportProof = async () => {
    const fc = fcRef.current, d = docRef.current; if (!fc || !d || !data || !d.proof) return
    setBusy('PROOF')
    try {
      const r = await exportProofSheet(fc, { width: d.width, height: d.height, title: data.design.name, layers: d.layers }, d.proof)
      downloadBlob(r.blob, `${safeFileName(data.design.name)}_APPROVAL_PROOF.pdf`)
    } catch (e: any) { alert(e?.message || 'Export failed') } finally { setBusy(null) }
  }

  if (err) return (
    <div className="min-h-screen grid place-items-center bg-[#F5F6FA] p-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto w-12 h-12 rounded-xl grid place-items-center text-white font-bold" style={{ background: '#2ABF06' }}>bG</div>
        <p className="text-gray-800 font-medium">{err}</p>
      </div>
    </div>
  )
  if (!data) return <div className="min-h-screen grid place-items-center text-gray-400 text-sm">Loading proof…</div>

  const d = data.design
  const threads = data.comments.filter(c => !c.parent_id && c.x != null && (showResolved || c.status === 'open'))
  const needGate = !who

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <header className="shrink-0 border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl grid place-items-center text-white font-bold text-sm" style={{ background: '#2ABF06' }}>bG</div>
        <div className="min-w-0">
          <p className="font-bold text-gray-900 truncate">{d.name}</p>
          <p className="text-xs text-gray-500 truncate">
            {[d.customer_name, d.sku, d.product_type].filter(Boolean).join(' · ')}{[d.customer_name, d.sku, d.product_type].some(Boolean) ? ' · ' : ''}
            {fmtUnit(d.width_pt, d.unit)} × {fmtUnit(d.height_pt, d.unit)} {d.unit} · updated {new Date(d.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {who && <span className="hidden sm:inline text-xs text-gray-500">Commenting as <b className="text-gray-700">{who.name}</b> <button onClick={() => setWho(null)} className="text-[#3B6FE0] hover:underline">change</button></span>}
          <span className="text-[11px] text-gray-400 hidden md:inline">Proof shared by beyondGREEN biotech</span>
        </div>
      </header>
      {data.link.message && <div className="shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900"><i className="ti ti-info-circle" /> {data.link.message}</div>}
      {(() => {
        const a = data.approval
        const canSubmit = data.link.allow_comments && !!data.source && (!a || a.status === 'changes_requested' || a.status === 'cancelled')
        const st = (x?: string | null) => x ? new Date(x).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
        if (a?.status === 'approved') return (
          <div className="shrink-0 px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 flex items-center gap-3 flex-wrap">
            <span className="border-[3px] border-emerald-600 text-emerald-700 rounded-md px-2 py-0.5 font-extrabold tracking-[0.18em] text-xs -rotate-1">APPROVED FOR PRODUCTION</span>
            <span className="text-sm text-emerald-900">{st(a.approved_at)} · confirmed by {a.approvers.map(x => x.name).join(', ')}</span>
            {a.approved_url && <a href={a.approved_url} onClick={() => logDownload(a.source_name, 'approved')} className="ml-auto text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5"><i className="ti ti-download" /> Download approved file</a>}
          </div>
        )
        if (a?.status === 'awaiting_team') return (
          <div className="shrink-0 px-4 py-2 bg-blue-50 border-b border-blue-200 text-sm text-blue-900 flex items-center gap-2 flex-wrap">
            <i className="ti ti-hourglass" /> Sent for approval {st(a.submitted_at)} by {a.submitted_by_name} — waiting for beyondGREEN to confirm ({a.confirmed} of {a.total}). Do not print until you receive the approval.
          </div>
        )
        return (
          <div className="shrink-0 px-4 py-2 bg-gray-50 border-b border-gray-200 text-sm text-gray-700 flex items-center gap-2 flex-wrap">
            {a?.status === 'changes_requested' ? <span className="text-orange-800"><i className="ti ti-alert-triangle" /> beyondGREEN requested changes{a.closed_note ? `: ${a.closed_note}` : ''}</span>
              : <span><i className="ti ti-info-circle" /> Review the artwork, sizes and colour codes. When everything is correct, send it back for approval.</span>}
            {canSubmit && <button onClick={() => { if (!who) return; setSubmitOpen(true) }} className="ml-auto text-sm font-semibold text-white bg-[#3B6FE0] hover:bg-[#2f5bc0] rounded-lg px-3 py-1.5"><i className="ti ti-send" /> Submit for approval</button>}
          </div>
        )
      })()}

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <div className="relative flex-1 min-h-[50vh] min-w-0 bg-[#E5E7EB]">
          <div ref={wrapRef} className="absolute inset-0 touch-none" style={{ cursor: mode === 'comment' ? 'crosshair' : 'grab' }}
            onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
            <canvas ref={canvasElRef} />
          </div>
          {/* pins */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {threads.map(c => {
              const p = toScreen(Number(c.x), Number(c.y))
              const area = c.w != null && Number(c.w) > 0
              const q = area ? toScreen(Number(c.x) + Number(c.w), Number(c.y) + Number(c.h)) : p
              const color = c.status === 'resolved' ? '#9CA3AF' : '#8B5CF6'
              return (
                <div key={c.id}>
                  {area && <div className="absolute border-2 border-dashed rounded-sm" style={{ left: p.x, top: p.y, width: q.x - p.x, height: q.y - p.y, borderColor: color, background: focusId === c.id ? 'rgba(139,92,246,0.08)' : undefined }} />}
                  <button onClick={() => focus(c.id)} className="absolute pointer-events-auto -translate-x-1/2 -translate-y-full w-8 h-8 rounded-full rounded-bl-none text-white text-xs font-bold shadow-md grid place-items-center border-2 border-white"
                    style={{ left: p.x, top: p.y, background: color, outline: focusId === c.id ? '2px solid #111827' : undefined }}>{c.pin_no}</button>
                </div>
              )
            })}
            {draft && (() => { const p = toScreen(draft.x, draft.y); const q = draft.w ? toScreen(draft.x + draft.w, draft.y + (draft.h || 0)) : null; return <>
              {q && <div className="absolute border-2 border-dashed border-violet-500 bg-violet-500/10" style={{ left: p.x, top: p.y, width: q.x - p.x, height: q.y - p.y }} />}
              <div className="absolute -translate-x-1/2 -translate-y-full w-8 h-8 rounded-full rounded-bl-none bg-violet-500 border-2 border-white shadow animate-pulse" style={{ left: p.x, top: p.y }} />
            </> })()}
            {dragBox && <div className="absolute border-2 border-dashed border-violet-500 bg-violet-500/10" style={{ left: dragBox.x0, top: dragBox.y0, width: dragBox.x1 - dragBox.x0, height: dragBox.y1 - dragBox.y0 }} />}
          </div>
          {/* toolbar */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white rounded-xl shadow-lg border border-gray-200 p-1 text-sm">
            <button onClick={() => { setMode('view'); setDraft(null) }} className={`px-3 py-1.5 rounded-lg ${mode === 'view' ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'}`}><i className="ti ti-hand-stop" /> Move</button>
            {data.link.allow_comments && <button onClick={() => setMode('comment')} className={`px-3 py-1.5 rounded-lg ${mode === 'comment' ? 'bg-violet-600 text-white' : 'hover:bg-gray-100'}`}><i className="ti ti-message-circle-plus" /> Comment</button>}
            <span className="w-px h-5 bg-gray-200 mx-1" />
            <button onClick={() => zoomAt((vpt[0] || 1) / 1.25)} className="px-2 py-1.5 rounded-lg hover:bg-gray-100"><i className="ti ti-zoom-out" /></button>
            <span className="text-xs w-12 text-center text-gray-600">{Math.round((vpt[0] || 1) * 100)}%</span>
            <button onClick={() => zoomAt((vpt[0] || 1) * 1.25)} className="px-2 py-1.5 rounded-lg hover:bg-gray-100"><i className="ti ti-zoom-in" /></button>
            <button onClick={fit} className="px-2 py-1.5 rounded-lg hover:bg-gray-100" title="Fit"><i className="ti ti-arrows-maximize" /></button>
            <label className="flex items-center gap-1 px-2 text-xs text-gray-600"><input type="checkbox" checked={showDieline} onChange={e => setShowDieline(e.target.checked)} /> Dieline</label>
          </div>
          {mode === 'comment' && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-xs px-3 py-2 rounded-lg shadow">Click a spot to pin a comment, or drag to mark an area.</div>}
          {rendering && <div className="absolute inset-0 grid place-items-center text-gray-500 text-sm pointer-events-none">Rendering artwork…</div>}
          {notice && <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow">{notice}</div>}
        </div>

        <aside className="md:w-[340px] shrink-0 border-t md:border-t-0 md:border-l border-gray-200 flex flex-col min-h-0 max-h-[50vh] md:max-h-none">
          <div className="flex border-b border-gray-200 text-sm font-medium">
            <button onClick={() => setTab('comments')} className={`flex-1 py-2.5 ${tab === 'comments' ? 'text-violet-700 border-b-2 border-violet-600' : 'text-gray-500'}`}>Comments ({data.comments.filter(c => !c.parent_id).length})</button>
            <button onClick={() => setTab('specs')} className={`flex-1 py-2.5 ${tab === 'specs' ? 'text-violet-700 border-b-2 border-violet-600' : 'text-gray-500'}`}>Specs</button>
            {data.link.allow_download && <button onClick={() => setTab('downloads')} className={`flex-1 py-2.5 ${tab === 'downloads' ? 'text-violet-700 border-b-2 border-violet-600' : 'text-gray-500'}`}>Downloads</button>}
            <button onClick={() => setTab('activity')} className={`flex-1 py-2.5 ${tab === 'activity' ? 'text-violet-700 border-b-2 border-violet-600' : 'text-gray-500'}`}>Activity</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {tab === 'comments' && (
              <CommentsPanel comments={data.comments} draft={draft} onSubmitDraft={submitDraft} onCancelDraft={() => setDraft(null)}
                onReply={async (parent, body) => { await post({ body, parent_id: parent.id }) }} onFocus={focus} focusId={focusId}
                showResolved={showResolved} setShowResolved={setShowResolved}
                hint={data.link.allow_comments ? <>Choose <b>Comment</b>, then click any part of the packaging (or drag around an area) to ask a question or request a change. The beyondGREEN team is notified right away.</> : 'Comments are turned off for this link.'} />
            )}
            {tab === 'specs' && (
              (docRef.current as any)?.spec ? <SpecSheet spec={(docRef.current as any).spec} source={data.source ? { name: data.source.name, sha256: data.source.sha256 } : null} compact />
                : <p className="text-sm text-gray-500">The exact sizes and colour codes will appear here once beyondGREEN attaches the original artwork file.</p>
            )}
            {tab === 'activity' && (
              <ol className="space-y-2.5">
                {!(data.activity || []).length && <li className="text-sm text-gray-400">No activity yet.</li>}
                {(data.activity || []).map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className={`w-6 h-6 shrink-0 rounded-full grid place-items-center text-[11px] ${a.actor_type === 'printer' ? 'bg-violet-100 text-violet-700' : a.actor_type === 'system' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{a.actor_type === 'printer' ? 'P' : a.actor_type === 'system' ? '✓' : 'bG'}</span>
                    <div className="min-w-0">
                      <p className="text-gray-900"><b>{a.actor_type === 'system' ? 'beyondGREEN' : a.actor_name || (a.actor_type === 'printer' ? 'Printer' : 'beyondGREEN')}</b> · {ACTIVITY_LABELS[a.action] || a.action}{a.details?.round ? ` (round ${a.details.round})` : ''}</p>
                      {(a.details?.file || a.details?.note) && <p className="text-xs text-gray-500 truncate">{a.details.note || a.details.file}</p>}
                      <p className="text-[11px] text-gray-400">{new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {tab === 'downloads' && data.link.allow_download && (
              <div className="space-y-4">
                {data.source && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Original artwork file</p>
                    <a href={data.source.url} onClick={() => logDownload(data.source!.name, 'original')} className="block p-2.5 rounded-lg border-2 border-emerald-500 bg-emerald-50 hover:bg-emerald-100 text-sm">
                      <span className="flex items-center gap-2">
                        <i className="ti ti-shield-check text-emerald-600 text-lg" />
                        <span className="flex-1 min-w-0 truncate font-medium">{data.source.name}</span>
                        <span className="text-[11px] text-gray-500">{fmtSize(data.source.size)}</span>
                        <i className="ti ti-download text-gray-500" />
                      </span>
                      <span className="block text-[11px] text-emerald-800 mt-1">Exactly as uploaded by beyondGREEN — unaltered, with original fonts, colours and layers. Use this file for production.</span>
                      <span className="block text-[10px] text-gray-400 mt-0.5 font-mono break-all">SHA-256 {data.source.sha256}</span>
                    </a>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Confirmed print files</p>
                  {!data.files.length && <p className="text-sm text-gray-500">No final files have been released yet.</p>}
                  <div className="space-y-1.5">
                    {data.files.map(f => (
                      <a key={f.id} href={f.url || '#'} onClick={() => logDownload(f.file_name, f.format)} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 hover:border-gray-400 text-sm">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-900 text-white uppercase">{f.format}</span>
                        <span className="truncate flex-1">{f.file_name}</span>
                        <span className="text-[11px] text-gray-400">{fmtSize(f.size_bytes)}</span>
                        <i className="ti ti-download text-gray-500" />
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Current working file (live proof)</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['pdf', 'ai', 'eps', 'ps', 'svg', 'png'] as ExportFormat[]).map(f => (
                      <button key={f} disabled={!!busy || rendering} onClick={() => exportCurrent(f)} className="py-2 rounded-lg border border-gray-200 hover:border-gray-400 text-xs font-semibold disabled:opacity-50">
                        {busy === f.toUpperCase() ? <i className="ti ti-loader-2 animate-spin" /> : '.' + f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {docRef.current?.proof && docRef.current.proof.enabled !== false && (
                    <button disabled={!!busy || rendering} onClick={exportProof} className="mt-1.5 w-full py-2 rounded-lg border border-gray-900 bg-gray-900 text-white text-xs font-semibold disabled:opacity-50">
                      {busy === 'PROOF' ? <i className="ti ti-loader-2 animate-spin" /> : <><i className="ti ti-file-certificate" /> Approval proof sheet (PDF)</>}
                    </button>
                  )}
                  <p className="text-[11px] text-amber-700 mt-2">These are rebuilt from the online proof for reference — for production use the original artwork file or the confirmed print files above.</p>
                  <p className="text-[11px] text-gray-400 mt-2">Vector files have text converted to outlines and open in Adobe Illustrator and CorelDRAW (File ▸ Import).</p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {submitOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setSubmitOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Submit for approval</h2>
            <p className="text-sm text-gray-600">beyondGREEN will review and confirm. You will receive the approval — with the exact file to print — only after every approver has confirmed. <b>Do not print before that.</b></p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={sub.sizes} onChange={e => setSub({ ...sub, sizes: e.target.checked })} /> <span>I have checked all sizes and dieline dimensions (see the <b>Specs</b> tab).</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={sub.colours} onChange={e => setSub({ ...sub, colours: e.target.checked })} /> <span>I have checked the colour codes (CMYK / spot) and can print them.</span></label>
            <textarea value={sub.note} onChange={e => setSub({ ...sub, note: e.target.value })} rows={3} placeholder="Anything we should know? (optional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            {sub.err && <p className="text-sm text-red-600">{sub.err}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSubmitOpen(false)} className="px-4 py-2 rounded-lg text-sm border border-gray-300">Cancel</button>
              <button disabled={sub.busy || !sub.sizes || !sub.colours} onClick={submitForApproval} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#3B6FE0] disabled:opacity-50">{sub.busy ? 'Sending…' : 'Submit for approval'}</button>
            </div>
          </div>
        </div>
      )}
      {needGate && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4">
          <form className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-3" onSubmit={e => {
            e.preventDefault(); if (!gate.name.trim()) return
            const w = { name: gate.name.trim(), email: gate.email.trim() }
            setWho(w); try { localStorage.setItem(storageKey, JSON.stringify(w)) } catch { /* ignore */ }
          }}>
            <div className="w-10 h-10 rounded-xl grid place-items-center text-white font-bold text-sm" style={{ background: '#2ABF06' }}>bG</div>
            <h2 className="text-lg font-bold">Packaging proof{data.link.printer_company ? ` for ${data.link.printer_company}` : ''}</h2>
            <p className="text-sm text-gray-500">Enter your name so the beyondGREEN team knows who left each comment.</p>
            <input autoFocus required value={gate.name} onChange={e => setGate({ ...gate, name: e.target.value })} placeholder="Your name" className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            <input type="email" value={gate.email} onChange={e => setGate({ ...gate, email: e.target.value })} placeholder="Email (optional)" className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            <button className="w-full py-2 rounded-lg text-white font-semibold" style={{ background: '#3B6FE0' }}>Open proof</button>
          </form>
        </div>
      )}
    </div>
  )
}
