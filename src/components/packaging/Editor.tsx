'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Packaging Studio — Illustrator-style vector editor built on fabric.js.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import * as fabric from 'fabric'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { type DesignDoc, type DesignRow, type DocLayer, type Swatch, BUCKET, OBJ_PROPS, UNIT_PT, fmtUnit, uid, safeFileName, sha256Hex } from '@/lib/packaging/doc'
import { ensureAssets, restore, serialize, thumbnail } from '@/lib/packaging/canvasIO'
import { importFile, ACCEPT } from '@/lib/packaging/importers'
import { fontFamilies, loadFamily, DEFAULT_FONT } from '@/lib/packaging/fonts'
import ColorField, { type ColorValue } from './ColorField'
import CommentsPanel, { type PkgComment } from './CommentsPanel'
import ProofPanel from './ProofPanel'
import { buildProofObjects, collectInks, customerFromRow, productFromRow, loadBrandLogo, sheetLayout, drawProof, CUSTOMER_COLS, PRODUCT_COLS, type ProofInfo } from '@/lib/packaging/proofTemplate'
import { exportProofSheet, downloadBlob } from '@/lib/packaging/exporters'

type Tool = 'select' | 'direct' | 'pen' | 'rect' | 'ellipse' | 'line' | 'text' | 'hand' | 'zoom' | 'eyedropper' | 'comment'
const TOOLS: { key: Tool; icon: string; label: string; kbd: string }[] = [
  { key: 'select', icon: 'ti-pointer', label: 'Selection', kbd: 'V' },
  { key: 'direct', icon: 'ti-pointer-bolt', label: 'Direct Selection (edit points)', kbd: 'A' },
  { key: 'pen', icon: 'ti-vector-bezier', label: 'Pen', kbd: 'P' },
  { key: 'rect', icon: 'ti-square', label: 'Rectangle', kbd: 'M' },
  { key: 'ellipse', icon: 'ti-circle', label: 'Ellipse', kbd: 'L' },
  { key: 'line', icon: 'ti-line', label: 'Line', kbd: '\\' },
  { key: 'text', icon: 'ti-typography', label: 'Type', kbd: 'T' },
  { key: 'eyedropper', icon: 'ti-color-picker', label: 'Eyedropper', kbd: 'I' },
  { key: 'hand', icon: 'ti-hand-stop', label: 'Hand (hold Space)', kbd: 'H' },
  { key: 'zoom', icon: 'ti-zoom-in', label: 'Zoom (Alt-click to zoom out)', kbd: 'Z' },
  { key: 'comment', icon: 'ti-message-circle-plus', label: 'Comment — click for a pin, drag for an area', kbd: 'C' },
]
const KEY_TO_TOOL: Record<string, Tool> = { v: 'select', a: 'direct', p: 'pen', m: 'rect', l: 'ellipse', '\\': 'line', t: 'text', i: 'eyedropper', h: 'hand', z: 'zoom', c: 'comment' }
const DOC_PATH = (id: string) => `designs/${id}/current.json`
const THUMB_PATH = (id: string) => `designs/${id}/thumb.png`
const RULER = 20

export interface EditorHandle {
  getCanvas: () => fabric.Canvas | null
  getExportDoc: () => { width: number; height: number; title: string; layers: DocLayer[] }
  getDoc: () => DesignDoc | null
  saveNow: (force?: boolean) => Promise<boolean>
  loadDoc: (doc: DesignDoc) => Promise<void>
  focusComment: (id: string) => void
  getProofInfo: () => ProofInfo | null
}

interface Props {
  design: DesignRow
  initialDoc: DesignDoc
  user: { email: string; name: string }
  onSaved: (row: Partial<DesignRow>) => void
  onSaveState: (s: SaveState) => void
  visible: boolean
  initialPanel?: 'import'
  /** next/dynamic does not forward refs — pass the handle ref here instead */
  editorRef?: React.MutableRefObject<EditorHandle | null>
}
export type SaveState = { status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'; at?: number; message?: string }

interface PenPt { x: number; y: number; hin: { x: number; y: number }; hout: { x: number; y: number } }

const multiSelCount = (o: any) => (o && (o.type === 'activeselection' || o.type === 'activeSelection')) ? o.getObjects().filter((x: any) => x.type === 'path').length : 0

const Editor = forwardRef<EditorHandle, Props>(function Editor({ design, initialDoc, user, onSaved, onSaveState, visible, initialPanel, editorRef }, ref) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fcRef = useRef<fabric.Canvas | null>(null)
  const docRef = useRef<DesignDoc>({ ...initialDoc, objects: [] })
  const revRef = useRef<number>(design.rev)
  const [ready, setReady] = useState(false)
  const [tool, setToolState] = useState<Tool>('select')
  const toolRef = useRef<Tool>('select')
  const [layers, setLayers] = useState<DocLayer[]>(initialDoc.layers)
  const [activeLayerId, setActiveLayerId] = useState(initialDoc.activeLayerId)
  const [swatches, setSwatches] = useState<Swatch[]>(initialDoc.swatches)
  const [artboard, setArtboard] = useState({ w: initialDoc.width, h: initialDoc.height, unit: initialDoc.unit })
  const [sel, setSel] = useState<any>(null) // snapshot of selection props
  const [vpt, setVpt] = useState<number[]>([1, 0, 0, 1, 0, 0])
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [panel, setPanel] = useState<'props' | 'layers' | 'comments' | 'import' | 'proof'>(initialPanel || 'props')
  const [importing, setImporting] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string[]>([])
  const [importTarget, setImportTarget] = useState<'dieline' | 'active' | 'new' | 'replace'>('active')
  const [fitArtboard, setFitArtboard] = useState(true)
  const [importUngroup, setImportUngroup] = useState(true)
  const [importText, setImportText] = useState<'live' | 'outline'>('outline')
  const [comments, setComments] = useState<PkgComment[]>([])
  const [draftComment, setDraftComment] = useState<{ x: number; y: number; w?: number; h?: number } | null>(null)
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [objList, setObjList] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  // ── official approval proof sheet ──
  const [proof, setProof] = useState<ProofInfo>(() => ({ enabled: true, ...(initialDoc.proof || {}) }))
  const proofObjsRef = useRef<fabric.FabricObject[]>([])
  const proofTimer = useRef<any>(null)
  const logoRef = useRef<HTMLImageElement | null>(null)
  const versionRef = useRef<number>(1)
  const designRef = useRef(design)
  designRef.current = design
  const [proofBusy, setProofBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const placeRef = useRef<HTMLInputElement>(null)

  // history
  const histRef = useRef<{ stack: string[]; idx: number; lock: boolean }>({ stack: [], idx: -1, lock: false })
  const saveTimer = useRef<any>(null)
  const savingRef = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false })
  const clipboardRef = useRef<any[] | null>(null)
  const penRef = useRef<{ pts: PenPt[]; dragging: boolean; mouse: { x: number; y: number } | null }>({ pts: [], dragging: false, mouse: null })
  const dragRef = useRef<any>(null)
  const spaceRef = useRef(false)
  const fittedRef = useRef(false)
  const readyRef = useRef(false)

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(t => t === m ? null : t), 3500) }

  // ── layer helpers ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const layerIndex = useCallback((id: string) => docRef.current.layers.findIndex(l => l.id === id), [])
  const normalizeStack = useCallback(() => {
    const fc = fcRef.current; if (!fc) return
    const L = docRef.current.layers
    const rank = (o: any) => { const i = L.findIndex(l => l.id === o.layerId); return i < 0 ? L.length : i }
    const objs = (fc as any)._objects as any[]
    const sorted = objs.map((o, i) => ({ o, i })).sort((a, b) => (rank(b.o) - rank(a.o)) || (a.i - b.i)).map(x => x.o)
    ;(fc as any)._objects = sorted
  }, [])
  const applyLayerStates = useCallback(() => {
    const fc = fcRef.current; if (!fc) return
    const byId = new Map(docRef.current.layers.map(l => [l.id, l]))
    const fallback = docRef.current.layers[docRef.current.layers.length - 1]
    for (const o of fc.getObjects() as any[]) {
      if (!o.layerId || !byId.has(o.layerId)) o.layerId = fallback?.id
      const l = byId.get(o.layerId)!
      o.visible = l.visible
      const locked = l.locked || o.lockedObj
      o.selectable = !locked; o.evented = !locked
    }
    normalizeStack()
    fc.requestRenderAll()
  }, [normalizeStack])
  const syncLayersState = () => { setLayers(docRef.current.layers.map(l => ({ ...l }))); setActiveLayerId(docRef.current.activeLayerId) }

  // ── selection snapshot for the properties panel ──────────────────────────
  const refreshSel = useCallback(() => {
    const fc = fcRef.current; if (!fc) return
    const o: any = fc.getActiveObject()
    if (!o) { setSel(null); return }
    const br = o.getBoundingRect()
    const isText = ['i-text', 'textbox', 'text'].includes(o.type)
    const multi = o.type === 'activeselection' || o.type === 'activeSelection'
    const first: any = multi ? o.getObjects()[0] : o
    setSel({
      type: o.type, multi, count: multi ? o.getObjects().length : 1,
      x: br.left, y: br.top, w: br.width, h: br.height, angle: Math.round((o.angle || 0) * 100) / 100,
      fill: typeof first?.fill === 'string' ? first.fill : null, cmykFill: first?.cmykFill || null, spotFill: first?.spotFill || null,
      stroke: typeof first?.stroke === 'string' && first.strokeWidth > 0 ? first.stroke : null, cmykStroke: first?.cmykStroke || null, spotStroke: first?.spotStroke || null,
      strokeWidth: first?.strokeWidth ?? 0, dash: (first?.strokeDashArray || []).join(' '), opacity: Math.round((o.opacity ?? 1) * 100),
      overprint: !!first?.overprint, isText, fontFamily: first?.fontFamily, fontSize: first?.fontSize, fontWeight: first?.fontWeight, fontStyle: first?.fontStyle,
      textAlign: first?.textAlign, lineHeight: first?.lineHeight, charSpacing: first?.charSpacing, underline: first?.underline,
      rx: first?.rx, name: first?.name || '', layerId: (() => { let t: any = first; while (t?.group) t = t.group; return t?.layerId })(), isPath: o.type === 'path', isGroup: o.type === 'group',
      hasClip: !!o.clipPath, inGroup: !!o.group,
      multiPart: o.type === 'path' && (o.path || []).filter((c: any[]) => c[0] === 'M').length > 1,
      pathCount: multiSelCount(o),
      canConvert: ['rect', 'ellipse', 'circle', 'triangle', 'polygon', 'polyline', 'line'].includes(o.type),
      lockProportions: !!o.lockUniScaling,
    })
  }, [])

  // ── history / autosave ───────────────────────────────────────────────────
  const snapshot = () => {
    const fc = fcRef.current!
    return JSON.stringify({
      objects: (fc.getObjects() as any[]).map(o => o.toObject(OBJ_PROPS)),
      layers: docRef.current.layers, width: docRef.current.width, height: docRef.current.height,
    })
  }
  const rebuildProof = () => {
    const fc = fcRef.current; if (!fc) return
    const d = docRef.current, dz = designRef.current as any
    const prev: ProofInfo = { enabled: true, ...(d.proof || {}) }
    const info: ProofInfo = {
      ...prev,
      jobName: dz.name, productType: dz.product_type || '', status: dz.status,
      proofNo: dz.proof_no ? `BG-${dz.proof_no}` : (prev.proofNo || ''),
      version: versionRef.current, date: new Date().toISOString(),
      dieline: `${fmtUnit(d.width, d.unit, d.unit === 'mm' ? 1 : 2)} × ${fmtUnit(d.height, d.unit, d.unit === 'mm' ? 1 : 2)} ${d.unit}`,
      inks: collectInks(fc.getObjects(), d.layers, d.swatches),
      artist: prev.artist || user.name,
    }
    d.proof = info
    setProof(info)
    proofObjsRef.current = info.enabled !== false ? buildProofObjects(info, d.width, d.height, logoRef.current) : []
    fc.requestRenderAll()
  }
  const rebuildProofRef = useRef(rebuildProof)
  rebuildProofRef.current = rebuildProof
  const updateProof = (patch: Partial<ProofInfo>) => {
    docRef.current.proof = { enabled: true, ...(docRef.current.proof || {}), ...patch }
    rebuildProof(); scheduleSave()
    if ('enabled' in patch) setTimeout(() => fitToScreenRef.current(), 0)
  }
  /** Pull the latest customer / lead and product data from the ERP into the proof. */
  const loadProofFromErp = async () => {
    const dz = designRef.current as any
    const [c, p, v] = await Promise.all([
      dz.customer_id ? sb.from('customers').select(CUSTOMER_COLS).eq('id', dz.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      dz.product_id ? sb.from('products').select(PRODUCT_COLS).eq('id', dz.product_id).maybeSingle()
        : dz.sku ? sb.from('products').select(PRODUCT_COLS).ilike('sku', dz.sku).limit(1).maybeSingle() : Promise.resolve({ data: null }),
      sb.from('packaging_design_versions').select('version_no').eq('design_id', dz.id).order('version_no', { ascending: false }).limit(1),
    ])
    versionRef.current = (((v as any).data?.[0]?.version_no) || 0) + 1
    const prev = docRef.current.proof || { enabled: true }
    const customer = customerFromRow((c as any).data) || (dz.customer_name ? { ...(prev.customer || {}), name: dz.customer_name } : prev.customer || null)
    const product = productFromRow((p as any).data) || (dz.sku ? { ...(prev.product || {}), sku: dz.sku } : prev.product || null)
    docRef.current.proof = { ...prev, enabled: prev.enabled !== false, customer, product }
    logoRef.current = await loadBrandLogo()
    rebuildProof()
  }
  const pickCustomer = async (row: any | null) => {
    const patch = { customer_id: row?.id || null, customer_name: row?.company_name || null }
    const { data } = await sb.from('packaging_designs').update(patch).eq('id', design.id).select().maybeSingle()
    if (data) { designRef.current = { ...designRef.current, ...(data as any) }; onSaved(data as any) }
    updateProof({ customer: customerFromRow(row) })
  }
  const pickProduct = async (row: any | null) => {
    const patch: any = { product_id: row?.id || null, sku: row?.sku || null }
    const { data } = await sb.from('packaging_designs').update(patch).eq('id', design.id).select().maybeSingle()
    if (data) { designRef.current = { ...designRef.current, ...(data as any) }; onSaved(data as any) }
    updateProof({ product: productFromRow(row) })
  }
  const downloadProofPdf = async () => {
    const fc = fcRef.current; if (!fc) return
    setProofBusy(true)
    try {
      rebuildProof()
      const d = docRef.current
      const r = await exportProofSheet(fc, { width: d.width, height: d.height, title: design.name, layers: d.layers }, d.proof!)
      downloadBlob(r.blob, `${(design.name || 'design').replace(/[^\w\-]+/g, '_')}_PROOF_${d.proof?.proofNo || ''}_V${d.proof?.version || 1}.pdf`)
    } catch (e: any) { flash('Proof PDF failed: ' + (e?.message || e)) } finally { setProofBusy(false) }
  }
  const scheduleSave = useCallback(() => {
    clearTimeout(proofTimer.current); proofTimer.current = setTimeout(() => rebuildProofRef.current(), 300)
    onSaveState({ status: 'dirty' })
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveNowRef.current() }, 1500)
  }, [onSaveState])
  const commit = useCallback(() => {
    const h = histRef.current
    if (h.lock || !fcRef.current) return
    const s = snapshot()
    if (h.stack[h.idx] === s) return
    h.stack = h.stack.slice(0, h.idx + 1); h.stack.push(s)
    if (h.stack.length > 60) h.stack.shift()
    h.idx = h.stack.length - 1
    setObjList(n => n + 1)
    scheduleSave()
  }, [scheduleSave])
  const loadSnapshot = async (s: string) => {
    const fc = fcRef.current!; const h = histRef.current
    h.lock = true
    const data = JSON.parse(s)
    docRef.current.layers = data.layers; docRef.current.width = data.width; docRef.current.height = data.height
    const objs = await fabric.util.enlivenObjects(data.objects) as any[]
    fc.discardActiveObject()
    fc.remove(...fc.getObjects())
    fc.add(...objs)
    isolatedRef.current = null; setIsolated(null)
    applyLayerStates(); syncLayersState(); syncGroupInteractivity()
    setArtboard(a => ({ ...a, w: data.width, h: data.height }))
    h.lock = false
    refreshSel(); setObjList(n => n + 1); scheduleSave()
  }
  const undo = async () => { const h = histRef.current; if (h.idx > 0) { h.idx--; await loadSnapshot(h.stack[h.idx]) } }
  const redo = async () => { const h = histRef.current; if (h.idx < h.stack.length - 1) { h.idx++; await loadSnapshot(h.stack[h.idx]) } }

  const currentDoc = (): DesignDoc => serialize(fcRef.current!, { ...docRef.current, layers: docRef.current.layers, swatches: docRef.current.swatches, activeLayerId: docRef.current.activeLayerId })

  const saveNow = useCallback(async (force = false): Promise<boolean> => {
    const fc = fcRef.current; if (!fc) return false
    if (savingRef.current.busy) { savingRef.current.again = true; return false }
    savingRef.current.busy = true
    clearTimeout(saveTimer.current)
    onSaveState({ status: 'saving' })
    try {
      await ensureAssets(fc, design.id, async (path, blob) => {
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'image/png', cacheControl: '31536000' })
        if (error && !/exists/i.test(error.message)) throw error
      })
      const doc = currentDoc()
      const body = new Blob([JSON.stringify(doc)], { type: 'application/json' })
      const up = await sb.storage.from(BUCKET).upload(DOC_PATH(design.id), body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
      if (up.error) throw up.error
      try {
        const th = await thumbnail(fc, doc)
        await sb.storage.from(BUCKET).upload(THUMB_PATH(design.id), th, { upsert: true, contentType: 'image/png', cacheControl: '0' })
      } catch { /* thumbnail is best-effort */ }
      if (force) {
        const { data: cur } = await sb.from('packaging_designs').select('rev').eq('id', design.id).single()
        if (cur) revRef.current = (cur as any).rev
      }
      const q = sb.from('packaging_designs').update({
        rev: revRef.current + 1, updated_at: new Date().toISOString(), updated_by: user.email,
        width_pt: doc.width, height_pt: doc.height, unit: doc.unit, doc_path: DOC_PATH(design.id), thumb_path: THUMB_PATH(design.id),
      }).eq('id', design.id).eq('rev', revRef.current)
      const { data, error } = await q.select().maybeSingle()
      if (error) throw error
      if (!data) { onSaveState({ status: 'conflict', message: 'Someone else saved this design after you opened it.' }); return false }
      revRef.current = (data as any).rev
      onSaved(data as any)
      onSaveState({ status: 'saved', at: Date.now() })
      return true
    } catch (e: any) {
      onSaveState({ status: 'error', message: e?.message || 'Save failed' })
      return false
    } finally {
      savingRef.current.busy = false
      if (savingRef.current.again) { savingRef.current.again = false; setTimeout(() => saveNowRef.current(), 200) }
    }
  }, [design.id, sb, user.email, onSaved, onSaveState]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveNowRef = useRef<(force?: boolean) => Promise<boolean>>(saveNow)
  useEffect(() => { saveNowRef.current = saveNow }, [saveNow])

  // ── comments ─────────────────────────────────────────────────────────────
  const loadComments = useCallback(async () => {
    const { data } = await sb.from('packaging_comments').select('*').eq('design_id', design.id).order('created_at')
    setComments((data || []) as PkgComment[])
  }, [sb, design.id])
  useEffect(() => { loadComments(); const t = setInterval(loadComments, 30000); return () => clearInterval(t) }, [loadComments])

  // ── zoom helpers ─────────────────────────────────────────────────────────
  const fitToScreen = useCallback(() => {
    const fc = fcRef.current; if (!fc) return
    const W = fc.getWidth(), H = fc.getHeight(), d = docRef.current
    const r = d.proof?.enabled !== false ? (() => { const L = sheetLayout(d.width, d.height); return { x: L.x, y: L.y, w: L.w, h: L.h } })() : { x: 0, y: 0, w: d.width, h: d.height }
    const z = Math.min((W - 60) / r.w, (H - 60) / r.h)
    fc.setViewportTransform([z, 0, 0, z, (W - r.w * z) / 2 - r.x * z, (H - r.h * z) / 2 - r.y * z])
    setVpt(fc.viewportTransform.slice())
  }, [])
  const fitToScreenRef = useRef(fitToScreen)
  fitToScreenRef.current = fitToScreen
  const zoomTo = (z: number, at?: { x: number; y: number }) => {
    const fc = fcRef.current; if (!fc) return
    z = Math.max(0.05, Math.min(64, z))
    const p = at || { x: fc.getWidth() / 2, y: fc.getHeight() / 2 }
    fc.zoomToPoint(new fabric.Point(p.x, p.y), z)
    setVpt(fc.viewportTransform.slice())
  }

  // ── groups: Illustrator-like selection (click = whole group, double-click = edit inside) ──
  const isolatedRef = useRef<any>(null)
  const [isolated, setIsolated] = useState<string | null>(null)
  const forEachGroup = (objs: any[], fn: (g: any) => void) => { for (const o of objs) if (o.type === 'group') { fn(o); forEachGroup(o.getObjects(), fn) } }
  const syncGroupInteractivity = () => {
    const fc = fcRef.current; if (!fc) return
    const direct = toolRef.current === 'direct'
    const iso = isolatedRef.current
    forEachGroup(fc.getObjects(), g => {
      g.subTargetCheck = true
      // inside isolation: the isolated group and its ancestors are open; direct-select opens everything
      let open = direct
      if (!open && iso) { let p: any = iso; while (p) { if (p === g) { open = true; break } p = p.group } }
      g.interactive = open
    })
  }
  const enterIsolation = (g: any) => {
    isolatedRef.current = g; setIsolated(g.name || 'Group')
    syncGroupInteractivity(); fcRef.current?.requestRenderAll()
  }
  const exitIsolation = () => {
    const fc = fcRef.current; const g = isolatedRef.current
    if (!g || !fc) return
    const parent = g.group
    isolatedRef.current = parent || null; setIsolated(parent ? (parent.name || 'Group') : null)
    syncGroupInteractivity(); fc.discardActiveObject()
    if (!parent) fc.setActiveObject(g)
    fc.requestRenderAll(); refreshSel()
  }

  // ── tool switching ───────────────────────────────────────────────────────
  const restoreControls = (o: any) => { if (o && o.__origControls) { o.controls = o.__origControls; delete o.__origControls; o.hasBorders = true; o.setCoords() } }
  const setTool = useCallback((t: Tool) => {
    const fc = fcRef.current
    toolRef.current = t; setToolState(t)
    if (!fc) return
    if (t !== 'pen' && penRef.current.pts.length) finishPen(false)
    const interactive = t === 'select' || t === 'direct'
    fc.selection = interactive
    fc.skipTargetFind = !(interactive || t === 'eyedropper')
    fc.defaultCursor = t === 'hand' ? 'grab' : t === 'zoom' ? 'zoom-in' : t === 'select' || t === 'direct' ? 'default' : 'crosshair'
    fc.hoverCursor = t === 'eyedropper' ? 'copy' : 'move'
    const all: any[] = []; const walk = (os: any[]) => os.forEach(o => { all.push(o); if (o.type === 'group') walk(o.getObjects()) }); walk(fc.getObjects())
    for (const o of all) restoreControls(o)
    syncGroupInteractivity()
    if (t === 'direct') enterDirect(fc.getActiveObject())
    fc.requestRenderAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const enterDirect = (o: any) => {
    if (!o || o.type !== 'path' || o.__origControls) return
    o.__origControls = o.controls
    o.controls = fabric.controlsUtils.createPathControls(o, {
      controlPointStyle: { controlFill: '#fff', controlStroke: '#3B6FE0', connectionDashArray: [3, 3] },
      pointStyle: { controlFill: '#3B6FE0', controlStroke: '#fff' },
    } as any)
    o.hasBorders = false
    o.setCoords()
    fcRef.current?.requestRenderAll()
  }

  // ── pen tool ─────────────────────────────────────────────────────────────
  const penD = (pts: PenPt[], close: boolean) => {
    if (!pts.length) return ''
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      d += ` C ${a.hout.x} ${a.hout.y} ${b.hin.x} ${b.hin.y} ${b.x} ${b.y}`
    }
    if (close && pts.length > 2) {
      const a = pts[pts.length - 1], b = pts[0]
      d += ` C ${a.hout.x} ${a.hout.y} ${b.hin.x} ${b.hin.y} ${b.x} ${b.y} Z`
    }
    return d
  }
  const finishPen = (close: boolean) => {
    const fc = fcRef.current; const pen = penRef.current
    if (fc && pen.pts.length >= 2) {
      const p = new fabric.Path(penD(pen.pts, close), { fill: close ? '#D1FAE5' : '', stroke: '#1F2937', strokeWidth: 1, objectCaching: false } as any)
      addObject(p)
    }
    pen.pts = []; pen.dragging = false; pen.mouse = null
    fc?.requestRenderAll()
  }

  // ── object creation ──────────────────────────────────────────────────────
  const addObject = (o: any, opts: { select?: boolean; layerId?: string } = {}) => {
    const fc = fcRef.current!; const d = docRef.current
    let layerId = opts.layerId || d.activeLayerId
    const layer = d.layers.find(l => l.id === layerId)
    if (layer && layer.locked && !opts.layerId) {
      const open = d.layers.find(l => !l.locked && l.visible)
      if (open) { layerId = open.id; flash(`Layer "${layer.name}" is locked — added to "${open.name}"`) }
    }
    o.id = o.id || uid(); o.layerId = layerId
    if (o.strokeUniform === undefined) o.strokeUniform = false
    fc.add(o)
    applyLayerStates()
    if (opts.select !== false && o.selectable) fc.setActiveObject(o)
    fc.requestRenderAll()
    commit()
  }

  // ── canvas bootstrap ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasElRef.current || fcRef.current) return
    const fc = new fabric.Canvas(canvasElRef.current, {
      backgroundColor: '#E5E7EB', preserveObjectStacking: true, stopContextMenu: true, fireRightClick: true,
      selectionColor: 'rgba(59,111,224,0.08)', selectionBorderColor: '#3B6FE0', selectionLineWidth: 1,
      uniformScaling: false, uniScaleKey: 'shiftKey', controlsAboveOverlay: true, enableRetinaScaling: true,
    } as any)
    fcRef.current = fc
    // Illustrator-style hit testing: clicks land on painted pixels, not bounding boxes
    ;(fc as any).perPixelTargetFind = true
    ;(fc as any).targetFindTolerance = 6
    if (wrapRef.current) {
      const w = wrapRef.current.clientWidth - RULER, h = wrapRef.current.clientHeight - RULER
      if (w > 0 && h > 0) { fc.setDimensions({ width: w, height: h }); setSize({ w, h }) }
    }
    fabric.FabricObject.ownDefaults.borderColor = '#3B6FE0'
    fabric.FabricObject.ownDefaults.cornerColor = '#ffffff'
    fabric.FabricObject.ownDefaults.cornerStrokeColor = '#3B6FE0'
    fabric.FabricObject.ownDefaults.cornerSize = 8
    fabric.FabricObject.ownDefaults.transparentCorners = false
    fabric.FabricObject.ownDefaults.borderScaleFactor = 1

    // artboard (white page + shadow) drawn under the objects on the on-screen canvas only
    const origBg = (fc as any)._renderBackground.bind(fc)
    ;(fc as any)._renderBackground = (ctx: CanvasRenderingContext2D) => {
      origBg(ctx)
      if (ctx !== fc.getContext()) return
      const v = fc.viewportTransform, d = docRef.current
      ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
      const pobjs = proofObjsRef.current
      if (pobjs.length) {
        const L = sheetLayout(d.width, d.height)
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 16; ctx.fillStyle = '#ffffff'; ctx.fillRect(L.x, L.y, L.w, L.h); ctx.restore()
        drawProof(ctx, pobjs)
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, d.width, d.height)
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 12; ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, d.width, d.height)
      }
      ctx.restore()
    }
    fc.on('after:render', ({ ctx }: any) => {
      if (ctx !== fc.getContext()) return
      const v = fc.viewportTransform, d = docRef.current
      ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
      ctx.lineWidth = 1 / v[0]; ctx.strokeStyle = 'rgba(17,24,39,0.35)'; ctx.strokeRect(0, 0, d.width, d.height)
      // pen preview
      const pen = penRef.current
      if (pen.pts.length) {
        ctx.lineWidth = 1 / v[0]; ctx.strokeStyle = '#3B6FE0'
        const path = new Path2D(penD(pen.pts, false) + (pen.mouse && !pen.dragging ? ` L ${pen.mouse.x} ${pen.mouse.y}` : ''))
        ctx.stroke(path)
        for (const p of pen.pts) {
          const r = 3 / v[0]
          ctx.fillStyle = '#fff'; ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r); ctx.strokeRect(p.x - r, p.y - r, 2 * r, 2 * r)
          if (p.hout.x !== p.x || p.hout.y !== p.y) {
            ctx.beginPath(); ctx.moveTo(p.hin.x, p.hin.y); ctx.lineTo(p.hout.x, p.hout.y); ctx.stroke()
          }
        }
      }
      // drag rectangle for comment areas / zoom
      const dr = dragRef.current
      if (dr && dr.kind === 'marquee' && dr.cur) {
        ctx.setLineDash([4 / v[0], 3 / v[0]]); ctx.strokeStyle = toolRef.current === 'comment' ? '#F59E0B' : '#3B6FE0'
        ctx.strokeRect(Math.min(dr.x, dr.cur.x), Math.min(dr.y, dr.cur.y), Math.abs(dr.cur.x - dr.x), Math.abs(dr.cur.y - dr.y))
      }
      ctx.restore()
    })

    const onSel = () => {
      if (toolRef.current === 'direct') { for (const o of fc.getObjects()) if (o !== fc.getActiveObject()) restoreControls(o); enterDirect(fc.getActiveObject()) }
      refreshSel()
    }
    fc.on('selection:created', onSel); fc.on('selection:updated', onSel)
    fc.on('selection:cleared', () => { for (const o of fc.getObjects()) restoreControls(o); refreshSel() })
    fc.on('object:modified', () => { refreshSel(); commit() })
    fc.on('object:moving', refreshSel); fc.on('object:scaling', refreshSel); fc.on('object:rotating', refreshSel)
    fc.on('text:editing:exited', () => commit())
    fc.on('text:changed', () => { scheduleSave() })

    // ── mouse handling for tools ──
    fc.on('mouse:down', (opt: any) => {
      const e = opt.e as MouseEvent
      const t = spaceRef.current ? 'hand' : toolRef.current
      const p = fc.getScenePoint(e)
      if (t === 'hand' || e.button === 1) { dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY }; fc.setCursor('grabbing'); return }
      if (t === 'zoom') { const vp = fc.getViewportPoint(e); if (e.altKey) zoomTo(fc.getZoom() / 1.5, vp); else dragRef.current = { kind: 'marquee', x: p.x, y: p.y, vp }; return }
      if (t === 'eyedropper') {
        const target: any = opt.target, active: any = fc.getActiveObject()
        if (target && active && target !== active) {
          const apply = (o: any) => o.set({ fill: target.fill, stroke: target.stroke, strokeWidth: target.strokeWidth, cmykFill: target.cmykFill, spotFill: target.spotFill, cmykStroke: target.cmykStroke, spotStroke: target.spotStroke, opacity: target.opacity })
          if (active.type === 'activeselection' || active.type === 'activeSelection') active.getObjects().forEach(apply); else apply(active)
          fc.requestRenderAll(); commit(); refreshSel()
        } else if (target) { fc.setActiveObject(target); refreshSel(); flash('Now select a target first, then click the colour source with the eyedropper') }
        return
      }
      if (t === 'pen') {
        const pen = penRef.current
        if (pen.pts.length > 2) {
          const f = pen.pts[0], z = fc.getZoom()
          if (Math.hypot((f.x - p.x) * z, (f.y - p.y) * z) < 8) { finishPen(true); return }
        }
        pen.pts.push({ x: p.x, y: p.y, hin: { x: p.x, y: p.y }, hout: { x: p.x, y: p.y } }); pen.dragging = true
        fc.requestRenderAll(); return
      }
      if (t === 'rect' || t === 'ellipse' || t === 'line' || t === 'text' || t === 'comment') {
        dragRef.current = { kind: 'marquee', x: p.x, y: p.y, tool: t }
      }
    })
    fc.on('mouse:move', (opt: any) => {
      const e = opt.e as MouseEvent
      const p = fc.getScenePoint(e)
      setCursor({ x: p.x, y: p.y })
      const dr = dragRef.current
      if (dr?.kind === 'pan') {
        fc.relativePan(new fabric.Point(e.clientX - dr.sx, e.clientY - dr.sy)); dr.sx = e.clientX; dr.sy = e.clientY
        setVpt(fc.viewportTransform.slice()); return
      }
      if (toolRef.current === 'pen') {
        const pen = penRef.current; pen.mouse = { x: p.x, y: p.y }
        if (pen.dragging && pen.pts.length) {
          const last = pen.pts[pen.pts.length - 1]
          last.hout = { x: p.x, y: p.y }; last.hin = { x: 2 * last.x - p.x, y: 2 * last.y - p.y }
        }
        fc.requestRenderAll(); return
      }
      if (dr?.kind === 'marquee') {
        let cur = { x: p.x, y: p.y }
        if ((e.shiftKey) && (dr.tool === 'rect' || dr.tool === 'ellipse')) { const s = Math.max(Math.abs(p.x - dr.x), Math.abs(p.y - dr.y)); cur = { x: dr.x + Math.sign(p.x - dr.x) * s, y: dr.y + Math.sign(p.y - dr.y) * s } }
        dr.cur = cur
        if (dr.tool === 'rect' || dr.tool === 'ellipse' || dr.tool === 'line') {
          if (!dr.obj) {
            const common = { fill: dr.tool === 'line' ? '' : '#FFFFFF', stroke: '#1F2937', strokeWidth: 1, originX: 'left', originY: 'top', objectCaching: false }
            dr.obj = dr.tool === 'rect' ? new fabric.Rect({ ...common, left: dr.x, top: dr.y, width: 1, height: 1 } as any)
              : dr.tool === 'ellipse' ? new fabric.Ellipse({ ...common, left: dr.x, top: dr.y, rx: 0.5, ry: 0.5 } as any)
                : new fabric.Line([dr.x, dr.y, dr.x, dr.y], { stroke: '#1F2937', strokeWidth: 1 } as any)
            dr.obj.isHelper = true
            fc.add(dr.obj)
          }
          const x0 = Math.min(dr.x, cur.x), y0 = Math.min(dr.y, cur.y), w = Math.abs(cur.x - dr.x), h = Math.abs(cur.y - dr.y)
          if (dr.tool === 'rect') dr.obj.set({ left: x0, top: y0, width: Math.max(w, 0.1), height: Math.max(h, 0.1) })
          else if (dr.tool === 'ellipse') dr.obj.set({ left: x0, top: y0, rx: Math.max(w / 2, 0.05), ry: Math.max(h / 2, 0.05) })
          else {
            let x2 = p.x, y2 = p.y
            if (e.shiftKey) { const a = Math.round(Math.atan2(y2 - dr.y, x2 - dr.x) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(x2 - dr.x, y2 - dr.y); x2 = dr.x + len * Math.cos(a); y2 = dr.y + len * Math.sin(a) }
            dr.obj.set({ x2, y2 })
          }
          dr.obj.setCoords()
        }
        fc.requestRenderAll()
      }
    })
    fc.on('mouse:up', (opt: any) => {
      const e = opt.e as MouseEvent
      const dr = dragRef.current; dragRef.current = null
      if (toolRef.current === 'pen') { penRef.current.dragging = false; fc.requestRenderAll(); return }
      if (!dr) return
      if (dr.kind === 'pan') { fc.setCursor(fc.defaultCursor || 'default'); return }
      const cur = dr.cur || { x: dr.x, y: dr.y }
      const z = fc.getZoom()
      const tiny = Math.abs(cur.x - dr.x) * z < 4 && Math.abs(cur.y - dr.y) * z < 4
      if (toolRef.current === 'zoom' || (dr.vp && !dr.tool)) {
        if (tiny) zoomTo(fc.getZoom() * 1.5, dr.vp)
        else {
          const x0 = Math.min(dr.x, cur.x), y0 = Math.min(dr.y, cur.y), w = Math.abs(cur.x - dr.x), h = Math.abs(cur.y - dr.y)
          const nz = Math.max(0.05, Math.min(64, Math.min(fc.getWidth() / w, fc.getHeight() / h) * 0.9))
          fc.setViewportTransform([nz, 0, 0, nz, fc.getWidth() / 2 - (x0 + w / 2) * nz, fc.getHeight() / 2 - (y0 + h / 2) * nz]); setVpt(fc.viewportTransform.slice())
        }
        fc.requestRenderAll(); return
      }
      if (dr.tool === 'comment') {
        const x0 = Math.min(dr.x, cur.x), y0 = Math.min(dr.y, cur.y)
        setDraftComment(tiny ? { x: dr.x, y: dr.y } : { x: x0, y: y0, w: Math.abs(cur.x - dr.x), h: Math.abs(cur.y - dr.y) })
        setPanel('comments'); fc.requestRenderAll(); return
      }
      if (dr.tool === 'text') {
        const t = tiny
          ? new fabric.IText('Type here', { left: dr.x, top: dr.y, originX: 'left', originY: 'top', fontFamily: DEFAULT_FONT, fontSize: 18, fill: '#1F2937' } as any)
          : new fabric.Textbox('Type here', { left: Math.min(dr.x, cur.x), top: Math.min(dr.y, cur.y), width: Math.abs(cur.x - dr.x), originX: 'left', originY: 'top', fontFamily: DEFAULT_FONT, fontSize: 18, fill: '#1F2937' } as any)
        addObject(t)
        setTool('select')
        ;(t as any).enterEditing(); (t as any).selectAll(); fc.requestRenderAll()
        return
      }
      if (dr.obj) {
        const o = dr.obj; fc.remove(o); delete o.isHelper
        if (tiny) {
          if (dr.tool === 'rect') o.set({ width: 72, height: 72 })
          else if (dr.tool === 'ellipse') o.set({ rx: 36, ry: 36 })
          else o.set({ x2: dr.x + 72, y2: dr.y })
        }
        o.setCoords()
        addObject(o)
        void e
      }
    })
    fc.on('mouse:dblclick', (opt: any) => {
      if (toolRef.current === 'pen') { finishPen(false); return }
      const t: any = opt.target
      if (toolRef.current === 'select' && t && t.type === 'path') { setTool('direct'); fc.setActiveObject(t); enterDirect(t) }
      if (toolRef.current === 'select' && t && t.type === 'group') {
        // Illustrator isolation mode: double-click a group to edit what's inside it
        enterIsolation(t)
        const subs: any[] = opt.subTargets || []
        const child = subs.length ? subs[subs.length - 1] : null
        if (child) { fc.discardActiveObject(); fc.setActiveObject(child); if (child.type === 'path') { setTool('direct'); fc.setActiveObject(child); enterDirect(child) } }
        fc.requestRenderAll(); refreshSel()
      }
    })
    fc.on('mouse:wheel', (opt: any) => {
      const e = opt.e as WheelEvent
      e.preventDefault(); e.stopPropagation()
      if (e.ctrlKey || e.metaKey) {
        const vp = fc.getViewportPoint(e)
        zoomTo(fc.getZoom() * Math.pow(0.998, e.deltaY), vp)
      } else {
        fc.relativePan(new fabric.Point(-e.deltaX, -e.deltaY)); setVpt(fc.viewportTransform.slice())
      }
    })
    fc.on('path:created' as any, () => commit())

    // initial content
    ;(async () => {
      const d = docRef.current
      histRef.current.lock = true
      try {
        await restore(fc, initialDoc, async (path) => {
          const { data, error } = await sb.storage.from(BUCKET).download(path)
          if (error || !data) throw error || new Error('asset')
          return URL.createObjectURL(data)
        })
      } catch (e: any) { flash('Some content could not be loaded: ' + (e?.message || e)) }
      d.layers = initialDoc.layers; d.activeLayerId = initialDoc.activeLayerId
      applyLayerStates(); syncGroupInteractivity(); setObjList(n => n + 1)
      histRef.current.lock = false
      histRef.current.stack = [snapshot()]; histRef.current.idx = 0
      loadFamily(DEFAULT_FONT).then(() => fc.requestRenderAll())
      setReady(true); readyRef.current = true
      loadProofFromErp().then(() => { if (fittedRef.current) fitToScreen() }).catch(() => rebuildProof())
      const pending = (window as any).__pkgPendingImport
      if (pending && pending.designId === design.id && pending.file) {
        delete (window as any).__pkgPendingImport
        setTimeout(() => doImportRef.current(pending.file, { target: 'active', fit: true, ungroup: true, text: pending.text || 'live' }), 50)
      }
      const el = wrapRef.current
      if (el && el.clientWidth > RULER && el.clientHeight > RULER) { fittedRef.current = true; fitToScreen() }
    })()
    return () => { fc.dispose(); fcRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const proofNoDep = (design as any).proof_no
  useEffect(() => { if (readyRef.current) rebuildProofRef.current() }, [design.name, design.status, design.product_type, proofNoDep])

  // resize canvas to container
  useEffect(() => {
    const el = wrapRef.current; if (!el) return
    const ro = new ResizeObserver(() => {
      const fc = fcRef.current; if (!fc) return
      const w = el.clientWidth - RULER, h = el.clientHeight - RULER
      if (w <= 0 || h <= 0) return
      const first = !fittedRef.current
      fc.setDimensions({ width: w, height: h }); setSize({ w, h })
      if (first && readyRef.current) { fittedRef.current = true; fitToScreen() }
      fc.requestRenderAll()
    })
    ro.observe(el); return () => ro.disconnect()
  }, [])
  useEffect(() => { if (visible && ready) { const fc = fcRef.current; if (fc) { fc.calcOffset(); fc.requestRenderAll() } } }, [visible, ready])

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return
    const onKey = async (e: KeyboardEvent) => {
      const fc = fcRef.current; if (!fc) return
      const tgt = e.target as HTMLElement
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return
      const active: any = fc.getActiveObject()
      if (active?.isEditing) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (e.code === 'Space' && !spaceRef.current) { spaceRef.current = true; fc.defaultCursor = 'grab'; fc.skipTargetFind = true; e.preventDefault(); return }
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) await redo(); else await undo(); return }
      if (mod && k === 'y') { e.preventDefault(); await redo(); return }
      if (mod && k === 's') { e.preventDefault(); saveNowRef.current(); return }
      if (mod && k === 'c') { e.preventDefault(); copySel(); return }
      if (mod && k === 'x') { e.preventDefault(); copySel(); deleteSel(); return }
      if (mod && k === 'v') { e.preventDefault(); await paste(); return }
      if (mod && k === 'd') { e.preventDefault(); copySel(); await paste(10); return }
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return }
      if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else group(); return }
      if (mod && (k === '0')) { e.preventDefault(); fitToScreen(); return }
      if (mod && (k === '1')) { e.preventDefault(); zoomTo(1); return }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomTo(fc.getZoom() * 1.25); return }
      if (mod && k === '-') { e.preventDefault(); zoomTo(fc.getZoom() / 1.25); return }
      if (mod && k === ']') { e.preventDefault(); arrange(e.shiftKey ? 'front' : 'forward'); return }
      if (mod && k === '[') { e.preventDefault(); arrange(e.shiftKey ? 'back' : 'backward'); return }
      if (k === 'delete' || k === 'backspace') { if (active) { e.preventDefault(); deleteSel() } return }
      if (k === 'escape') { if (toolRef.current === 'pen') finishPen(false); if (isolatedRef.current) { exitIsolation(); return } fc.discardActiveObject(); setDraftComment(null); fc.requestRenderAll(); return }
      if (k === 'enter' && toolRef.current === 'pen') { finishPen(false); return }
      if (k.startsWith('arrow') && active) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        active.set({ left: active.left + (k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0), top: active.top + (k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0) })
        active.setCoords(); fc.requestRenderAll(); refreshSel(); commit(); return
      }
      if (!mod && !e.altKey && KEY_TO_TOOL[k]) { setTool(KEY_TO_TOOL[k]); return }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceRef.current) { spaceRef.current = false; setTool(toolRef.current) }
    }
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp) }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── editing operations ───────────────────────────────────────────────────
  const activeList = (): any[] => {
    const fc = fcRef.current; if (!fc) return []
    const a: any = fc.getActiveObject(); if (!a) return []
    return a.type === 'activeselection' || a.type === 'activeSelection' ? a.getObjects() : [a]
  }
  const deleteSel = () => {
    const fc = fcRef.current!; const list = activeList(); if (!list.length) return
    fc.discardActiveObject()
    for (const o of list) { if (o.group) o.group.remove(o); else fc.remove(o) }
    fc.requestRenderAll(); commit(); refreshSel(); setObjList(n => n + 1)
  }
  // clipboard keeps each object's absolute placement so copies of items inside groups paste in place
  const copySel = () => {
    clipboardRef.current = activeList().map(o => {
      const j: any = o.toObject(OBJ_PROPS)
      if (o.group) j.__world = o.calcTransformMatrix()
      if (!j.layerId) { let p = o; while (p.group) p = p.group; j.layerId = p.layerId }
      return j
    })
  }
  const paste = async (offset = 10) => {
    const fc = fcRef.current!; const data = clipboardRef.current; if (!data?.length) return
    const objs = await fabric.util.enlivenObjects(JSON.parse(JSON.stringify(data))) as any[]
    fc.discardActiveObject()
    const raw = JSON.parse(JSON.stringify(data))
    objs.forEach((o: any, i: number) => { if (raw[i].__world) fabric.util.applyTransformToObject(o, raw[i].__world) })
    for (const o of objs) {
      o.set({ left: o.left + offset, top: o.top + offset }); o.id = uid()
      const l = docRef.current.layers.find(x => x.id === o.layerId)
      if (!l || l.locked) o.layerId = docRef.current.activeLayerId
      fc.add(o)
    }
    applyLayerStates()
    if (objs.length === 1) fc.setActiveObject(objs[0]); else fc.setActiveObject(new fabric.ActiveSelection(objs, { canvas: fc }))
    clipboardRef.current = objs.map(o => o.toObject(OBJ_PROPS))
    syncGroupInteractivity(); setObjList(n => n + 1)
    fc.requestRenderAll(); commit(); refreshSel()
  }
  const selectAll = () => {
    const fc = fcRef.current!
    const objs = fc.getObjects().filter((o: any) => o.selectable && o.visible)
    fc.discardActiveObject()
    if (objs.length) fc.setActiveObject(objs.length === 1 ? objs[0] : new fabric.ActiveSelection(objs, { canvas: fc }))
    fc.requestRenderAll(); refreshSel()
  }
  const group = () => {
    const fc = fcRef.current!; const a: any = fc.getActiveObject()
    if (!a || !(a.type === 'activeselection' || a.type === 'activeSelection')) return
    const objs = a.getObjects().slice()
    const layerId = objs[0].layerId
    fc.discardActiveObject()
    fc.remove(...objs)
    const g: any = new fabric.Group(objs, { subTargetCheck: true, interactive: false } as any)
    g.id = uid(); g.layerId = layerId
    fc.add(g); applyLayerStates(); syncGroupInteractivity(); setObjList(n => n + 1); fc.setActiveObject(g); fc.requestRenderAll(); commit(); refreshSel()
  }
  const ungroup = () => {
    const fc = fcRef.current!; const g: any = fc.getActiveObject()
    if (!g || g.type !== 'group') return
    let top: any = g; while (top.group) top = top.group
    const layerId = top.layerId
    const parent = g.group
    if (g.clipPath) flash('Clipping mask released')
    g.clipPath = undefined
    const objs = g.removeAll()
    fc.discardActiveObject()
    if (parent) { parent.remove(g); parent.add(...objs) }
    else { fc.remove(g); for (const o of objs) { o.layerId = layerId; o.id = o.id || uid(); fc.add(o) } }
    if (isolatedRef.current === g) { isolatedRef.current = parent || null; setIsolated(parent ? (parent.name || 'Group') : null) }
    applyLayerStates(); syncGroupInteractivity(); setObjList(n => n + 1)
    if (!parent) fc.setActiveObject(new fabric.ActiveSelection(objs, { canvas: fc }))
    fc.requestRenderAll(); commit(); refreshSel()
  }
  const releaseClip = () => {
    const fc = fcRef.current!; const g: any = fc.getActiveObject()
    if (!g || !g.clipPath) return
    g.clipPath = undefined; g.dirty = true; fc.requestRenderAll(); commit(); refreshSel()
  }
  // Compound paths: split a multi-part path into separate shapes, or join several into one
  const releaseCompound = () => {
    const fc = fcRef.current!; const p: any = fc.getActiveObject()
    if (!p || p.type !== 'path') return
    const cmds: any[] = p.path
    const parts: any[][] = []
    for (const c of cmds) { if (c[0] === 'M' || !parts.length) parts.push([]); parts[parts.length - 1].push(c) }
    if (parts.length < 2) { flash('This path has only one part'); return }
    const m = p.calcTransformMatrix(); const off = p.pathOffset
    const style = { fill: p.fill, stroke: p.stroke, strokeWidth: p.strokeWidth, strokeDashArray: p.strokeDashArray, strokeLineCap: p.strokeLineCap, strokeLineJoin: p.strokeLineJoin, opacity: p.opacity, fillRule: p.fillRule, cmykFill: p.cmykFill, spotFill: p.spotFill, cmykStroke: p.cmykStroke, spotStroke: p.spotStroke, overprint: p.overprint, objectCaching: false }
    const pieces = parts.map(cs => {
      // path commands are in the object's own plane (offset by pathOffset) → bake the transform in
      const d = cs.map((c: any[]) => { const out = [c[0]]; for (let i = 1; i + 1 < c.length; i += 2) { const pt = new fabric.Point(c[i] - off.x, c[i + 1] - off.y).transform(m); out.push(pt.x, pt.y) } return out.join(' ') }).join(' ')
      const np: any = new fabric.Path(d, style as any); np.id = uid(); return np
    })
    const parent = p.group
    fc.discardActiveObject()
    if (parent) { const idx = parent.getObjects().indexOf(p); parent.remove(p); pieces.forEach((np, i) => parent.insertAt(idx + i, np)) }
    else { const idx = fc.getObjects().indexOf(p); fc.remove(p); pieces.forEach((np, i) => { np.layerId = p.layerId; fc.insertAt(idx + i, np) }) }
    applyLayerStates(); setObjList(n => n + 1)
    fc.setActiveObject(new fabric.ActiveSelection(pieces, { canvas: fc })); fc.requestRenderAll(); commit(); refreshSel()
    flash(`Split into ${pieces.length} shapes`)
  }
  const makeCompound = () => {
    const fc = fcRef.current!; const list = activeList().filter(o => o.type === 'path')
    if (list.length < 2) { flash('Select two or more paths'); return }
    const d = list.map(p => { const m = p.calcTransformMatrix(); const off = p.pathOffset; return p.path.map((c: any[]) => { const out = [c[0]]; for (let i = 1; i + 1 < c.length; i += 2) { const pt = new fabric.Point(c[i] - off.x, c[i + 1] - off.y).transform(m); out.push(pt.x, pt.y) } return out.join(' ') }).join(' ') }).join(' ')
    const first = list[0]
    const np: any = new fabric.Path(d, { fill: first.fill, stroke: first.stroke, strokeWidth: first.strokeWidth, opacity: first.opacity, fillRule: 'evenodd', cmykFill: first.cmykFill, spotFill: first.spotFill, objectCaching: false } as any)
    np.id = uid(); np.layerId = first.layerId || docRef.current.activeLayerId
    fc.discardActiveObject()
    for (const o of list) { if (o.group) o.group.remove(o); else fc.remove(o) }
    fc.add(np); applyLayerStates(); setObjList(n => n + 1); fc.setActiveObject(np); fc.requestRenderAll(); commit(); refreshSel()
  }
  const arrange = (how: 'front' | 'back' | 'forward' | 'backward') => {
    const fc = fcRef.current!; const list = activeList(); if (!list.length) return
    for (const o of how === 'front' || how === 'forward' ? list : list.slice().reverse()) {
      const c: any = o.group || fc
      if (how === 'front') c.bringObjectToFront(o)
      else if (how === 'back') c.sendObjectToBack(o)
      else if (how === 'forward') c.bringObjectForward(o)
      else c.sendObjectBackwards(o)
      if (o.group) o.group.triggerLayout?.()
    }
    normalizeStack(); fc.requestRenderAll(); commit()
  }
  const align = (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'dist-h' | 'dist-v') => {
    const fc = fcRef.current!; const a: any = fc.getActiveObject(); if (!a) return
    const list = activeList()
    const toArtboard = list.length === 1
    fc.discardActiveObject()
    const boxes = list.map(o => ({ o, b: o.getBoundingRect() }))
    const ref = toArtboard ? { left: 0, top: 0, width: docRef.current.width, height: docRef.current.height }
      : boxes.reduce((r, { b }) => { const x1 = Math.max(r.left + r.width, b.left + b.width), y1 = Math.max(r.top + r.height, b.top + b.height); const x0 = Math.min(r.left, b.left), y0 = Math.min(r.top, b.top); return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 } }, { ...boxes[0].b })
    const move = (o: any, dx: number, dy: number) => { o.set({ left: o.left + dx, top: o.top + dy }); o.setCoords() }
    if (how === 'dist-h' || how === 'dist-v') {
      const horiz = how === 'dist-h'
      const s = boxes.slice().sort((p, q) => horiz ? p.b.left - q.b.left : p.b.top - q.b.top)
      if (s.length > 2) {
        const total = s.reduce((t, { b }) => t + (horiz ? b.width : b.height), 0)
        const gap = ((horiz ? ref.width : ref.height) - total) / (s.length - 1)
        let pos = horiz ? ref.left : ref.top
        for (const { o, b } of s) { move(o, horiz ? pos - b.left : 0, horiz ? 0 : pos - b.top); pos += (horiz ? b.width : b.height) + gap }
      }
    } else {
      for (const { o, b } of boxes) {
        if (how === 'left') move(o, ref.left - b.left, 0)
        if (how === 'right') move(o, ref.left + ref.width - (b.left + b.width), 0)
        if (how === 'hcenter') move(o, ref.left + ref.width / 2 - (b.left + b.width / 2), 0)
        if (how === 'top') move(o, 0, ref.top - b.top)
        if (how === 'bottom') move(o, 0, ref.top + ref.height - (b.top + b.height))
        if (how === 'vcenter') move(o, 0, ref.top + ref.height / 2 - (b.top + b.height / 2))
      }
    }
    fc.setActiveObject(list.length === 1 ? list[0] : new fabric.ActiveSelection(list, { canvas: fc }))
    fc.requestRenderAll(); refreshSel(); commit()
  }
  const flip = (axis: 'x' | 'y') => { const fc = fcRef.current!; const a: any = fc.getActiveObject(); if (!a) return; a.set(axis === 'x' ? { flipX: !a.flipX } : { flipY: !a.flipY }); fc.requestRenderAll(); commit() }
  const convertToPath = () => {
    const fc = fcRef.current!; const a: any = fc.getActiveObject(); if (!a) return
    // reuse the exporter geometry by building an SVG path from the shape
    const svg = a.toSVG()
    fabric.loadSVGFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`).then(({ objects }) => {
      const o: any = objects[0]; if (!o) return
      let path: any = o
      if (o.type !== 'path') {
        const pts = o.type === 'line' ? [[o.x1, o.y1], [o.x2, o.y2]] : null
        if (pts) path = new fabric.Path(`M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`, { stroke: o.stroke, strokeWidth: o.strokeWidth } as any)
        else {
          const r = new fabric.Path(shapeToD(a), { fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, strokeDashArray: a.strokeDashArray, opacity: a.opacity } as any)
          fabric.util.applyTransformToObject(r, a.calcTransformMatrix()); path = r
        }
      }
      Object.assign(path, { id: a.id, layerId: a.layerId, cmykFill: a.cmykFill, spotFill: a.spotFill, cmykStroke: a.cmykStroke, spotStroke: a.spotStroke, overprint: a.overprint })
      fc.discardActiveObject(); const idx = fc.getObjects().indexOf(a); fc.remove(a); fc.insertAt(idx, path)
      applyLayerStates(); fc.setActiveObject(path); commit(); refreshSel()
    })
  }

  // ── property setters from the panel ──────────────────────────────────────
  const setProps = (patch: any, opts: { commit?: boolean } = {}) => {
    const fc = fcRef.current!; const list = activeList(); if (!list.length) return
    for (const o of list) {
      if (['i-text', 'textbox', 'text'].includes(o.type) && (patch.fontFamily || patch.fontWeight || patch.fontStyle)) {
        const fam = patch.fontFamily || o.fontFamily
        loadFamily(fam).then(() => { o.initDimensions?.(); o.setCoords(); fc.requestRenderAll() })
      }
      o.set(patch); o.setCoords?.()
      if (o.initDimensions && (patch.fontSize || patch.fontFamily || patch.lineHeight || patch.charSpacing || patch.fontWeight)) o.initDimensions()
    }
    fc.requestRenderAll(); refreshSel()
    if (opts.commit !== false) commit()
  }
  const setColor = (kind: 'fill' | 'stroke', v: ColorValue) => {
    const patch: any = kind === 'fill'
      ? { fill: v.hex || '', cmykFill: v.cmyk || null, spotFill: v.spot || null }
      : { stroke: v.hex || '', cmykStroke: v.cmyk || null, spotStroke: v.spot || null }
    if (kind === 'stroke' && v.hex && !(sel?.strokeWidth > 0)) patch.strokeWidth = 1
    if (kind === 'stroke' && !v.hex) patch.strokeWidth = 0
    setProps(patch)
  }
  const setGeom = (key: 'x' | 'y' | 'w' | 'h' | 'angle', valUnits: number) => {
    const fc = fcRef.current!; const a: any = fc.getActiveObject(); if (!a || !isFinite(valUnits)) return
    const pt = key === 'angle' ? valUnits : valUnits * UNIT_PT[docRef.current.unit]
    const b = a.getBoundingRect()
    if (key === 'x') a.set({ left: a.left + (pt - b.left) })
    if (key === 'y') a.set({ top: a.top + (pt - b.top) })
    if (key === 'w' && pt > 0) { const f = pt / b.width; a.set({ scaleX: a.scaleX * f, ...(sel?.lockProportions ? { scaleY: a.scaleY * f } : {}) }) }
    if (key === 'h' && pt > 0) { const f = pt / b.height; a.set({ scaleY: a.scaleY * f, ...(sel?.lockProportions ? { scaleX: a.scaleX * f } : {}) }) }
    if (key === 'angle') a.rotate(pt)
    a.setCoords(); fc.requestRenderAll(); refreshSel(); commit()
  }

  // ── layers ───────────────────────────────────────────────────────────────
  const updateLayers = (fn: (ls: DocLayer[]) => DocLayer[]) => {
    docRef.current.layers = fn(docRef.current.layers.map(l => ({ ...l })))
    if (!docRef.current.layers.find(l => l.id === docRef.current.activeLayerId)) docRef.current.activeLayerId = docRef.current.layers[0]?.id
    const fc = fcRef.current!
    const a: any = fc.getActiveObject()
    if (a) { const locked = activeList().some(o => docRef.current.layers.find(l => l.id === o.layerId)?.locked); if (locked) fc.discardActiveObject() }
    applyLayerStates(); syncLayersState(); commit()
  }
  const addLayer = () => {
    const id = uid()
    const n = docRef.current.layers.length + 1
    updateLayers(ls => [{ id, name: `Layer ${n}`, visible: true, locked: false, color: ['#3B6FE0', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'][n % 5] }, ...ls])
    docRef.current.activeLayerId = id; setActiveLayerId(id)
  }
  const moveSelToLayer = (layerId: string) => {
    const fc = fcRef.current!; const list = activeList(); if (!list.length) return
    list.forEach(o => (o.layerId = layerId)); fc.discardActiveObject(); applyLayerStates(); commit(); refreshSel()
  }

  // ── import & place ───────────────────────────────────────────────────────
  type ImportOpts = { target: 'dieline' | 'active' | 'new' | 'replace'; fit: boolean; ungroup: boolean; text: 'live' | 'outline' }
  const doImport = async (file: File, override?: Partial<ImportOpts>) => {
    const o: ImportOpts = { target: importTarget, fit: fitArtboard, ungroup: importUngroup, text: importText, ...override }
    const fc = fcRef.current!; setImporting('Reading file…'); setImportMsg([]); setPanel('import')
    try {
      const res = await importFile(file, s => setImporting(s), { text: o.text })
      const isVector = !(res.kind === 'png' || res.kind === 'jpg')
      const empty = !(fc.getObjects() as any[]).some(x => !x.isHelper)
      // keep the uploaded file byte-for-byte: printers always get exactly what we uploaded
      if (isVector && (o.target === 'replace' || empty)) {
        setImporting('Storing the original file…')
        const bytes = await file.arrayBuffer()
        const sha = await sha256Hex(bytes)
        const path = `designs/${design.id}/source/${sha.slice(0, 16)}-${safeFileName(file.name)}`
        const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream', cacheControl: '31536000' })
        if (up.error && !/exists/i.test(up.error.message)) throw new Error('Could not store the original file: ' + up.error.message)
        docRef.current.source = { path, name: file.name, size: file.size, sha256: sha, uploaded_at: new Date().toISOString(), uploaded_by: user.email, text: o.text }
      }
      if (o.target === 'replace') {
        histRef.current.lock = true
        fc.discardActiveObject()
        fc.remove(...(fc.getObjects() as any[]).filter(x => !x.isHelper))
        isolatedRef.current = null; setIsolated(null)
        histRef.current.lock = false
      }
      // replace canvas-backed images with blob images so snapshots stay light
      const convertImages = async (objs: any[]) => {
        for (const o of objs) {
          if (o.type === 'group') await convertImages(o.getObjects())
          if (o.type === 'image' && o.getElement() instanceof HTMLCanvasElement) {
            const blob: Blob = await new Promise(r => (o.getElement() as HTMLCanvasElement).toBlob(b => r(b!), 'image/png'))
            const url = URL.createObjectURL(blob)
            const img = await fabric.util.loadImage(url)
            o.setElement(img); o.__srcBlob = blob
          }
        }
      }
      await convertImages(res.objects)
      if (res.kind === 'png' || res.kind === 'jpg') { (res.objects[0] as any).__srcBlob = file }
      let layerId = docRef.current.activeLayerId
      if (o.target === 'replace') {
        const art = docRef.current.layers.find(l => l.kind !== 'dieline' && !l.locked) || docRef.current.layers.find(l => l.kind !== 'dieline')
        if (art) { layerId = art.id; docRef.current.activeLayerId = art.id }
      } else if (o.target === 'dieline') {
        let die = docRef.current.layers.find(l => l.kind === 'dieline')
        if (!die) { die = { id: uid(), name: 'Dieline', visible: true, locked: true, color: '#EC008C', kind: 'dieline' }; docRef.current.layers = [die, ...docRef.current.layers] }
        layerId = die.id
      } else if (o.target === 'new') {
        const l = { id: uid(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), visible: true, locked: false, color: '#10B981' }
        docRef.current.layers = [l, ...docRef.current.layers]; layerId = l.id; docRef.current.activeLayerId = l.id
      }
      const isVectorPage = isVector
      if ((o.fit || o.target === 'replace') && isVectorPage) { docRef.current.width = res.width; docRef.current.height = res.height; setArtboard(a => ({ ...a, w: res.width, h: res.height })) }
      const layer = docRef.current.layers.find(l => l.id === layerId)
      let placed: any[]
      if (isVectorPage) {
        const group: any = res.objects.length === 1 ? res.objects[0] : new fabric.Group(res.objects, { subTargetCheck: true, interactive: true } as any)
        if (!o.fit && o.target !== 'replace') group.set({ left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' })
        group.setCoords()
        if (o.ungroup && res.objects.length > 1) placed = group.removeAll()
        else { group.name = file.name; placed = [group] }
      } else {
        const img: any = res.objects[0]
        const sc = Math.min(1, (docRef.current.width * 0.8) / img.width, (docRef.current.height * 0.8) / img.height)
        img.set({ scaleX: sc, scaleY: sc, left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' })
        img.name = file.name; placed = [img]
      }
      histRef.current.lock = true
      for (const obj of placed) { obj.setCoords(); addObject(obj, { layerId, select: false }) }
      histRef.current.lock = false
      syncGroupInteractivity(); setObjList(n => n + 1)
      commit()
      if (!layer?.locked && placed.length) {
        fc.discardActiveObject()
        fc.setActiveObject(placed.length === 1 ? placed[0] : new fabric.ActiveSelection(placed, { canvas: fc }))
        fc.requestRenderAll(); refreshSel()
      }
      syncLayersState()
      const textCount = placed.reduce((n: number, x: any) => n + (x.type === 'i-text' ? 1 : x.type === 'group' ? x.getObjects().filter((c: any) => c.type === 'i-text').length : 0), 0)
      setImportMsg([`Imported ${file.name}${layer ? ` onto "${layer.name}"` : ''} — ${placed.length} object${placed.length === 1 ? '' : 's'}${textCount ? `, ${textCount} editable text` : ''}.`, ...res.warnings])
      fitToScreen()
    } catch (e: any) {
      setImportMsg(['Import failed: ' + (e?.message || String(e))])
    } finally { setImporting(null) }
  }
  const docSource = (docRef.current as any).source as (DesignDoc['source'] | undefined)
  const doImportRef = useRef(doImport)
  doImportRef.current = doImport
  const placeImage = async (file: File) => {
    const url = URL.createObjectURL(file)
    const img: any = await fabric.FabricImage.fromURL(url)
    img.__srcBlob = file; img.name = file.name
    const s = Math.min(1, (docRef.current.width * 0.6) / img.width, (docRef.current.height * 0.6) / img.height)
    img.set({ scaleX: s, scaleY: s, left: docRef.current.width / 2, top: docRef.current.height / 2, originX: 'center', originY: 'center' })
    addObject(img)
  }

  // ── artboard ─────────────────────────────────────────────────────────────
  const setArtboardSize = (wUnits: number, hUnits: number, unit: DesignDoc['unit']) => {
    if (!(wUnits > 0 && hUnits > 0)) return
    docRef.current.width = wUnits * UNIT_PT[unit]; docRef.current.height = hUnits * UNIT_PT[unit]; docRef.current.unit = unit
    setArtboard({ w: docRef.current.width, h: docRef.current.height, unit })
    fcRef.current?.requestRenderAll(); commit(); fitToScreen()
  }
  const setUnit = (unit: DesignDoc['unit']) => { docRef.current.unit = unit; setArtboard(a => ({ ...a, unit })); refreshSel(); scheduleSave() }

  // ── comments on the canvas ───────────────────────────────────────────────
  const submitComment = async (body: string) => {
    if (!draftComment || !body.trim()) return
    const top = comments.filter(c => !c.parent_id)
    const pin = (top.reduce((m, c) => Math.max(m, c.pin_no || 0), 0) || 0) + 1
    const { error } = await sb.from('packaging_comments').insert({
      design_id: design.id, pin_no: pin, x: draftComment.x, y: draftComment.y, w: draftComment.w ?? null, h: draftComment.h ?? null,
      body: body.trim(), author_name: user.name, author_email: user.email, author_type: 'team',
    })
    if (error) { flash(error.message); return }
    setDraftComment(null); loadComments()
  }
  const reply = async (parent: PkgComment, body: string) => {
    const { error } = await sb.from('packaging_comments').insert({ design_id: design.id, parent_id: parent.id, body: body.trim(), author_name: user.name, author_email: user.email, author_type: 'team' })
    if (error) flash(error.message); else loadComments()
  }
  const setResolved = async (c: PkgComment, resolved: boolean) => {
    await sb.from('packaging_comments').update(resolved ? { status: 'resolved', resolved_by: user.email, resolved_at: new Date().toISOString() } : { status: 'open', resolved_by: null, resolved_at: null }).eq('id', c.id)
    loadComments()
  }
  const deleteComment = async (c: PkgComment) => { await sb.from('packaging_comments').delete().eq('id', c.id); loadComments() }
  const focusComment = (id: string) => {
    const c = comments.find(x => x.id === id); const fc = fcRef.current
    setFocusCommentId(id); setPanel('comments')
    if (!c || !fc || c.x == null) return
    const z = fc.getZoom(), cx = Number(c.x) + (Number(c.w) || 0) / 2, cy = Number(c.y) + (Number(c.h) || 0) / 2
    fc.setViewportTransform([z, 0, 0, z, fc.getWidth() / 2 - cx * z, fc.getHeight() / 2 - cy * z]); setVpt(fc.viewportTransform.slice())
  }

  useImperativeHandle(editorRef || ref, () => ({
    getCanvas: () => fcRef.current,
    getExportDoc: () => ({ width: docRef.current.width, height: docRef.current.height, title: design.name, layers: docRef.current.layers }),
    getDoc: () => fcRef.current ? currentDoc() : null,
    saveNow: (force?: boolean) => saveNowRef.current(force),
    loadDoc: async (doc: DesignDoc) => {
      const fc = fcRef.current!; histRef.current.lock = true
      docRef.current = { ...doc, objects: [] }
      await restore(fc, doc, async (path) => { const { data } = await sb.storage.from(BUCKET).download(path); return URL.createObjectURL(data!) })
      applyLayerStates(); syncLayersState(); setSwatches(doc.swatches || [])
      setArtboard({ w: doc.width, h: doc.height, unit: doc.unit })
      histRef.current.lock = false; commit(); fitToScreen()
    },
    focusComment,
    getProofInfo: () => { if (fcRef.current) rebuildProof(); return docRef.current.proof || null },
  }))

  // ── derived UI data ──────────────────────────────────────────────────────
  const unit = artboard.unit
  const u = (pt: number) => fmtUnit(pt, unit, unit === 'mm' ? 2 : 3)
  const pinsVisible = comments.filter(c => !c.parent_id && c.x != null && (showResolved || c.status === 'open'))
  const toScreen = (x: number, y: number) => ({ x: x * vpt[0] + vpt[4], y: y * vpt[3] + vpt[5] })
  const objectsByLayer = useMemo(() => {
    const fc = fcRef.current; const m: Record<string, any[]> = {}
    if (!fc) return m
    for (const o of (fc.getObjects() as any[]).slice().reverse()) { if (o.isHelper) continue; (m[o.layerId] ||= []).push(o) }
    return m
  }, [objList, layers]) // eslint-disable-line react-hooks/exhaustive-deps
  const objLabel = (o: any) => o.name || ({ 'i-text': 'Text', textbox: 'Text', path: 'Path', rect: 'Rectangle', ellipse: 'Ellipse', circle: 'Circle', line: 'Line', group: 'Group', image: 'Image', polygon: 'Polygon', polyline: 'Polyline' } as any)[o.type] || o.type
  const openComments = comments.filter(c => !c.parent_id && c.status === 'open').length

  return (
    <div className="flex flex-col h-full min-h-0" style={{ display: visible ? 'flex' : 'none' }}>
      {/* context bar */}
      <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-gray-200 bg-white text-xs overflow-x-auto">
        <button onClick={undo} title="Undo (⌘Z)" className="pk-btn"><i className="ti ti-arrow-back-up" /></button>
        <button onClick={redo} title="Redo (⌘⇧Z)" className="pk-btn"><i className="ti ti-arrow-forward-up" /></button>
        <span className="w-px h-6 bg-gray-200 mx-1" />
        {sel ? (
          <>
            <span className="text-gray-500 font-medium whitespace-nowrap">{sel.multi ? `${sel.count} objects` : objLabel(fcRef.current?.getActiveObject())}</span>
            {(['x', 'y', 'w', 'h'] as const).map(k => (
              <NumField key={k} label={k.toUpperCase()} value={u(sel[k])} onCommit={v => setGeom(k, v)} />
            ))}
            <button onClick={() => { const a: any = fcRef.current?.getActiveObject(); if (a) { a.lockUniScaling = !a.lockUniScaling; refreshSel() } }} title="Constrain proportions"
              className={`pk-btn ${sel.lockProportions ? 'text-blue-600' : ''}`}><i className={`ti ${sel.lockProportions ? 'ti-link' : 'ti-unlink'}`} /></button>
            <NumField label="°" value={sel.angle} onCommit={v => setGeom('angle', v)} />
            <span className="w-px h-6 bg-gray-200 mx-1" />
            {[['left', 'ti-layout-align-left'], ['hcenter', 'ti-layout-align-center'], ['right', 'ti-layout-align-right'], ['top', 'ti-layout-align-top'], ['vcenter', 'ti-layout-align-middle'], ['bottom', 'ti-layout-align-bottom']].map(([k, ic]) => (
              <button key={k} onClick={() => align(k as any)} title={`Align ${k}${sel.multi ? '' : ' to artboard'}`} className="pk-btn"><i className={`ti ${ic}`} /></button>
            ))}
            {sel.multi && <>
              <button onClick={() => align('dist-h')} title="Distribute horizontally" className="pk-btn"><i className="ti ti-layout-distribute-vertical" /></button>
              <button onClick={() => align('dist-v')} title="Distribute vertically" className="pk-btn"><i className="ti ti-layout-distribute-horizontal" /></button>
            </>}
            <span className="w-px h-6 bg-gray-200 mx-1" />
            <button onClick={() => flip('x')} title="Flip horizontal" className="pk-btn"><i className="ti ti-flip-vertical" /></button>
            <button onClick={() => flip('y')} title="Flip vertical" className="pk-btn"><i className="ti ti-flip-horizontal" /></button>
            {sel.multi && <button onClick={group} title="Group (⌘G)" className="pk-btn"><i className="ti ti-box-multiple" /></button>}
            {sel.isGroup && <button onClick={ungroup} title="Ungroup (⌘⇧G)" className="pk-btn"><i className="ti ti-box-off" /></button>}
            {sel.isGroup && !sel.multi && <button onClick={() => { const g: any = fcRef.current?.getActiveObject(); if (g) { enterIsolation(g); fcRef.current?.discardActiveObject(); refreshSel() } }} title="Edit inside this group (or double-click it)" className="pk-btn"><i className="ti ti-arrow-bar-to-down" /></button>}
            {sel.hasClip && <button onClick={releaseClip} title="Release clipping mask" className="pk-btn"><i className="ti ti-crop" /></button>}
            {sel.multiPart && <button onClick={releaseCompound} title="Release compound path (split letters / pieces into separate shapes)" className="pk-btn"><i className="ti ti-vector-spline" /></button>}
            {sel.pathCount > 1 && <button onClick={makeCompound} title="Make compound path" className="pk-btn"><i className="ti ti-link" /></button>}
            <button onClick={() => arrange('front')} title="Bring to front (⌘⇧])" className="pk-btn"><i className="ti ti-stack-front" /></button>
            <button onClick={() => arrange('back')} title="Send to back (⌘⇧[)" className="pk-btn"><i className="ti ti-stack-back" /></button>
            {sel.canConvert && <button onClick={convertToPath} title="Convert to editable path" className="pk-btn"><i className="ti ti-vector" /></button>}
            <button onClick={() => { copySel(); paste(10) }} title="Duplicate (⌘D)" className="pk-btn"><i className="ti ti-copy" /></button>
            <button onClick={deleteSel} title="Delete" className="pk-btn text-red-600"><i className="ti ti-trash" /></button>
          </>
        ) : (
          <>
            <span className="text-gray-500 font-medium">Artboard</span>
            <NumField label="W" value={u(artboard.w)} onCommit={v => setArtboardSize(v, artboard.h / UNIT_PT[unit], unit)} />
            <NumField label="H" value={u(artboard.h)} onCommit={v => setArtboardSize(artboard.w / UNIT_PT[unit], v, unit)} />
            <select value={unit} onChange={e => setUnit(e.target.value as any)} className="border border-gray-300 rounded px-1 py-1">
              <option value="in">in</option><option value="mm">mm</option><option value="pt">pt</option>
            </select>
            <span className="text-gray-400 ml-2 whitespace-nowrap">Tip: drop an AI / PDF / EPS dieline here or use Import →</span>
          </>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* tool strip */}
        <div className="w-11 shrink-0 bg-[#1A2035] flex flex-col items-center py-2 gap-1">
          {TOOLS.map(t => (
            <button key={t.key} onClick={() => setTool(t.key)} title={`${t.label} (${t.kbd})`}
              className={`w-9 h-9 rounded-md flex items-center justify-center text-[17px] ${tool === t.key ? 'bg-[#3B6FE0] text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              <i className={`ti ${t.icon}`} />
            </button>
          ))}
          <button onClick={() => placeRef.current?.click()} title="Place image (PNG/JPG)" className="w-9 h-9 rounded-md flex items-center justify-center text-[17px] text-white/70 hover:bg-white/10 hover:text-white"><i className="ti ti-photo-plus" /></button>
          <input ref={placeRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) placeImage(f); e.target.value = '' }} />
          <div className="flex-1" />
          <button onClick={fitToScreen} title="Fit artboard (⌘0)" className="w-9 h-9 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10"><i className="ti ti-arrows-maximize" /></button>
        </div>

        {/* canvas + rulers */}
        <div ref={wrapRef} className="relative flex-1 min-w-0 bg-[#E5E7EB] overflow-hidden"
          onDragOver={e => { e.preventDefault() }}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (!f) return; if (/image\/(png|jpeg)/.test(f.type)) placeImage(f); else { setPanel('import'); doImport(f) } }}>
          <Rulers vpt={vpt} w={size.w} h={size.h} unit={unit} cursor={cursor} />
          <div className="absolute" style={{ left: RULER, top: RULER }}>
            <canvas ref={canvasElRef} />
          </div>
          {/* comment pins */}
          <div className="absolute pointer-events-none" style={{ left: RULER, top: RULER, width: size.w, height: size.h, overflow: 'hidden' }}>
            {pinsVisible.map(c => {
              const p = toScreen(Number(c.x), Number(c.y))
              const hasArea = c.w != null && Number(c.w) > 0
              const q = hasArea ? toScreen(Number(c.x) + Number(c.w), Number(c.y) + Number(c.h)) : p
              return (
                <div key={c.id}>
                  {hasArea && <div className="absolute border-2 border-dashed rounded-sm" style={{ left: p.x, top: p.y, width: q.x - p.x, height: q.y - p.y, borderColor: c.status === 'resolved' ? '#9CA3AF' : c.author_type === 'printer' ? '#8B5CF6' : '#F59E0B', background: focusCommentId === c.id ? 'rgba(245,158,11,0.08)' : undefined }} />}
                  <button onClick={() => focusComment(c.id)}
                    className="absolute pointer-events-auto -translate-x-1/2 -translate-y-full w-7 h-7 rounded-full rounded-bl-none text-white text-xs font-bold shadow-md flex items-center justify-center border-2 border-white"
                    style={{ left: p.x, top: p.y, background: c.status === 'resolved' ? '#9CA3AF' : c.author_type === 'printer' ? '#8B5CF6' : '#F59E0B', outline: focusCommentId === c.id ? '2px solid #1F2937' : undefined }}>
                    {c.pin_no}
                  </button>
                </div>
              )
            })}
            {draftComment && (() => { const p = toScreen(draftComment.x, draftComment.y); return <div className="absolute -translate-x-1/2 -translate-y-full w-7 h-7 rounded-full rounded-bl-none bg-amber-500 border-2 border-white shadow animate-pulse" style={{ left: p.x, top: p.y }} /> })()}
          </div>
          {isolated && (
            <div className="absolute left-1/2 -translate-x-1/2 bg-[#1A2035] text-white text-xs rounded-lg shadow-lg px-3 py-2 flex items-center gap-3" style={{ top: RULER + 8 }}>
              <span><i className="ti ti-focus-2" /> Editing inside group <b>{isolated}</b> — click any piece to select it</span>
              <button onClick={() => { while (isolatedRef.current) exitIsolation() }} className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25">Done (Esc)</button>
            </div>
          )}
          {!ready && <div className="absolute inset-0 grid place-items-center text-gray-500 text-sm">Loading design…</div>}
          {toast && <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg">{toast}</div>}
          {/* status bar */}
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-white/90 border-t border-gray-200 flex items-center gap-4 px-3 text-[11px] text-gray-600">
            <span>{Math.round((vpt[0] || 1) * 100)}%</span>
            <button onClick={() => zoomTo((vpt[0] || 1) / 1.25)} className="hover:text-black"><i className="ti ti-minus" /></button>
            <button onClick={() => zoomTo((vpt[0] || 1) * 1.25)} className="hover:text-black"><i className="ti ti-plus" /></button>
            <span>Artboard {u(artboard.w)} × {u(artboard.h)} {unit}</span>
            {cursor && <span>X {u(cursor.x)}  Y {u(cursor.y)}</span>}
            <span className="ml-auto">{TOOLS.find(t => t.key === tool)?.label}{tool === 'pen' ? ' — click for corners, drag for curves, click first point to close, Enter to finish' : ''}</span>
          </div>
        </div>

        {/* right panel */}
        <div className="w-[300px] shrink-0 border-l border-gray-200 bg-white flex flex-col min-h-0">
          <div className="flex border-b border-gray-200 text-xs font-medium">
            {([['props', 'Properties'], ['layers', 'Layers'], ['proof', 'Proof'], ['comments', `Comments${openComments ? ` (${openComments})` : ''}`], ['import', 'Import']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setPanel(k)} className={`flex-1 py-2.5 ${panel === k ? 'text-[#3B6FE0] border-b-2 border-[#3B6FE0]' : 'text-gray-500 hover:text-gray-800'}`}>{l}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-sm">
            {panel === 'props' && (sel ? (
              <>
                {!sel.multi && (
                  <input value={sel.name} placeholder="Object name" onChange={e => setProps({ name: e.target.value }, { commit: false })} onBlur={() => commit()}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
                )}
                {sel.type !== 'image' && <ColorField label="Fill" value={{ hex: sel.fill, cmyk: sel.cmykFill, spot: sel.spotFill }} onChange={v => setColor('fill', v)} />}
                <ColorField label="Stroke" value={{ hex: sel.stroke, cmyk: sel.cmykStroke, spot: sel.spotStroke }} onChange={v => setColor('stroke', v)} />
                {sel.stroke && (
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Weight pt" value={sel.strokeWidth} onCommit={v => setProps({ strokeWidth: Math.max(0, v) })} wide />
                    <label className="text-[11px] text-gray-500">Dash
                      <input defaultValue={sel.dash} key={sel.dash} placeholder="e.g. 6 3" onBlur={e => setProps({ strokeDashArray: e.target.value.trim() ? e.target.value.trim().split(/[\s,]+/).map(Number).filter(n => n >= 0) : null })}
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
                    </label>
                    <label className="text-[11px] text-gray-500 col-span-2 flex items-center gap-2">
                      <input type="checkbox" checked={!!fcRef.current?.getActiveObject()?.strokeUniform} onChange={e => setProps({ strokeUniform: e.target.checked })} /> Keep stroke weight when scaling
                    </label>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Opacity %" value={sel.opacity} onCommit={v => setProps({ opacity: Math.max(0, Math.min(100, v)) / 100 })} wide />
                  {sel.type === 'rect' && <NumField label="Corner pt" value={sel.rx || 0} onCommit={v => setProps({ rx: Math.max(0, v), ry: Math.max(0, v) })} wide />}
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={sel.overprint} onChange={e => setProps({ overprint: e.target.checked })} /> Overprint (for dielines / varnish / white ink)</label>
                {sel.isText && (
                  <div className="space-y-2 border-t pt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Character</span>
                    <select value={sel.fontFamily} onChange={e => setProps({ fontFamily: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs">
                      {fontFamilies().map(f => <option key={f} value={f}>{f}</option>)}
                      {!fontFamilies().includes(sel.fontFamily) && <option value={sel.fontFamily}>{sel.fontFamily} (missing)</option>}
                    </select>
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="Size" value={sel.fontSize} onCommit={v => setProps({ fontSize: Math.max(1, v) })} wide />
                      <NumField label="Leading" value={sel.lineHeight} onCommit={v => setProps({ lineHeight: Math.max(0.5, v) })} wide />
                      <NumField label="Tracking" value={sel.charSpacing} onCommit={v => setProps({ charSpacing: v })} wide />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setProps({ fontWeight: sel.fontWeight === 'bold' || sel.fontWeight >= 600 ? 'normal' : 'bold' })} className={`pk-btn border ${sel.fontWeight === 'bold' || sel.fontWeight >= 600 ? 'bg-gray-200' : ''}`}><i className="ti ti-bold" /></button>
                      <button onClick={() => setProps({ fontStyle: sel.fontStyle === 'italic' ? 'normal' : 'italic' })} className={`pk-btn border ${sel.fontStyle === 'italic' ? 'bg-gray-200' : ''}`}><i className="ti ti-italic" /></button>
                      <button onClick={() => setProps({ underline: !sel.underline })} className={`pk-btn border ${sel.underline ? 'bg-gray-200' : ''}`}><i className="ti ti-underline" /></button>
                      <span className="w-2" />
                      {['left', 'center', 'right', 'justify'].map(a => (
                        <button key={a} onClick={() => setProps({ textAlign: a })} className={`pk-btn border ${sel.textAlign === a ? 'bg-gray-200' : ''}`}><i className={`ti ti-align-${a === 'justify' ? 'justified' : a}`} /></button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="border-t pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Layer</span>
                  <select value={sel.layerId || ''} onChange={e => moveSelToLayer(e.target.value)} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-xs">
                    {layers.map(l => <option key={l.id} value={l.id}>{l.name}{l.locked ? ' (locked)' : ''}</option>)}
                  </select>
                </div>
                <Swatches swatches={swatches} onPick={(s, stroke) => setColor(stroke ? 'stroke' : 'fill', { hex: s.hex, cmyk: s.cmyk || null, spot: s.spot || null })}
                  onAdd={() => { if (!sel.fill) return; const s: Swatch = { name: sel.spotFill || sel.fill, hex: sel.fill, cmyk: sel.cmykFill || undefined, spot: sel.spotFill || undefined }; docRef.current.swatches = [...docRef.current.swatches, s]; setSwatches(docRef.current.swatches); scheduleSave() }}
                  onRemove={i => { docRef.current.swatches = docRef.current.swatches.filter((_, j) => j !== i); setSwatches(docRef.current.swatches); scheduleSave() }} />
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">Select an object to edit its fill, stroke, type and position. Shift-click a swatch to apply it as a stroke.</p>
                <Swatches swatches={swatches} onPick={() => flash('Select an object first')} onAdd={() => { }} onRemove={i => { docRef.current.swatches = docRef.current.swatches.filter((_, j) => j !== i); setSwatches(docRef.current.swatches); scheduleSave() }} />
                <div className="text-[11px] text-gray-500 leading-5 border-t pt-3">
                  <p className="font-semibold text-gray-600 mb-1">Shortcuts</p>
                  <p>V select · A direct select · P pen · M rectangle · L ellipse · T type · I eyedropper · H/Space hand · Z zoom · C comment</p>
                  <p>⌘Z / ⌘⇧Z undo/redo · ⌘C ⌘V ⌘D · ⌘G / ⌘⇧G group · ⌘] ⌘[ arrange · arrows nudge (⇧ ×10) · ⌘0 fit · ⌘S save</p>
                </div>
              </div>
            ))}

            {panel === 'layers' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Layers (top → bottom)</span>
                  <button onClick={addLayer} className="text-xs text-[#3B6FE0] hover:underline"><i className="ti ti-plus" /> New layer</button>
                </div>
                {layers.map((l, i) => (
                  <div key={l.id} className={`rounded-lg border ${activeLayerId === l.id ? 'border-[#3B6FE0] bg-blue-50/40' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-1.5 px-2 py-1.5" onClick={() => { docRef.current.activeLayerId = l.id; setActiveLayerId(l.id) }}>
                      <span className="w-1.5 h-5 rounded" style={{ background: l.color }} />
                      <button onClick={e => { e.stopPropagation(); updateLayers(ls => ls.map(x => x.id === l.id ? { ...x, visible: !x.visible } : x)) }} title="Show / hide" className="text-gray-500 hover:text-black"><i className={`ti ${l.visible ? 'ti-eye' : 'ti-eye-off'}`} /></button>
                      <button onClick={e => { e.stopPropagation(); updateLayers(ls => ls.map(x => x.id === l.id ? { ...x, locked: !x.locked } : x)) }} title="Lock / unlock" className="text-gray-500 hover:text-black"><i className={`ti ${l.locked ? 'ti-lock' : 'ti-lock-open'}`} /></button>
                      <input value={l.name} onChange={e => { const v = e.target.value; docRef.current.layers = docRef.current.layers.map(x => x.id === l.id ? { ...x, name: v } : x); syncLayersState() }} onBlur={() => commit()}
                        className="flex-1 min-w-0 text-xs bg-transparent outline-none font-medium" />
                      {l.kind === 'dieline' && <span className="text-[10px] px-1 rounded bg-pink-100 text-pink-700">die</span>}
                      <button disabled={i === 0} onClick={e => { e.stopPropagation(); updateLayers(ls => { const n = ls.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n }) }} className="text-gray-400 hover:text-black disabled:opacity-30"><i className="ti ti-chevron-up" /></button>
                      <button disabled={i === layers.length - 1} onClick={e => { e.stopPropagation(); updateLayers(ls => { const n = ls.slice(); [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n }) }} className="text-gray-400 hover:text-black disabled:opacity-30"><i className="ti ti-chevron-down" /></button>
                      <button onClick={e => {
                        e.stopPropagation()
                        const n = (objectsByLayer[l.id] || []).length
                        if (layers.length <= 1) return flash('A design needs at least one layer')
                        if (n && !confirm(`Delete layer "${l.name}" and its ${n} object(s)?`)) return
                        const fc = fcRef.current!; fc.discardActiveObject(); fc.remove(...(objectsByLayer[l.id] || []))
                        updateLayers(ls => ls.filter(x => x.id !== l.id))
                      }} className="text-gray-400 hover:text-red-600"><i className="ti ti-trash" /></button>
                    </div>
                    {(objectsByLayer[l.id] || []).length > 0 && (
                      <div className="border-t border-gray-100 max-h-72 overflow-y-auto">
                        {(objectsByLayer[l.id] || []).map((o: any) => (
                          <ObjRow key={o.id || o.__key || (o.__key = uid())} o={o} depth={0} locked={l.locked} active={fcRef.current?.getActiveObject()} label={objLabel}
                            onSelect={(t: any) => {
                              if (l.locked) return flash('Unlock the layer to select')
                              const fc = fcRef.current!
                              if (t.group) { enterIsolation(t.group) } else if (isolatedRef.current) { while (isolatedRef.current) exitIsolation() }
                              fc.discardActiveObject(); fc.setActiveObject(t); fc.requestRenderAll(); refreshSel()
                            }} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-gray-400">The dieline layer is exported as a spot-colour overprint layer; you can leave it out of printer files from the Final Files tab.</p>
              </div>
            )}

            {panel === 'proof' && (
              <ProofPanel sb={sb} info={proof} onChange={updateProof} onPickCustomer={pickCustomer} onPickProduct={pickProduct}
                onRefresh={() => loadProofFromErp().then(() => flash('Proof refreshed from the ERP'))} onDownload={downloadProofPdf} busy={proofBusy} />
            )}
            {panel === 'comments' && (
              <CommentsPanel comments={comments} draft={draftComment} onSubmitDraft={submitComment} onCancelDraft={() => setDraftComment(null)}
                onReply={reply} onResolve={setResolved} onDelete={deleteComment} onFocus={focusComment} focusId={focusCommentId}
                showResolved={showResolved} setShowResolved={setShowResolved} canDelete
                hint={<>Use the <b>Comment</b> tool (C) — click to drop a pin or drag to mark an area. Printer comments appear here in purple.</>} />
            )}

            {panel === 'import' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-600">Open an existing <b>Illustrator (.ai)</b>, PDF, EPS, PS or SVG file and keep working on it here, or place a <b>PNG / JPG</b>.</p>
                <div className="space-y-1.5 text-xs">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Put it on</p>
                  <label className="flex items-center gap-2"><input type="radio" checked={importTarget === 'active'} onChange={() => setImportTarget('active')} /> The active layer — <b>editable artwork</b></label>
                  <label className="flex items-center gap-2"><input type="radio" checked={importTarget === 'new'} onChange={() => setImportTarget('new')} /> A new layer named after the file</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={importTarget === 'dieline'} onChange={() => setImportTarget('dieline')} /> The <b>Dieline</b> layer (locked, for cut lines)</label>
                  <label className="flex items-start gap-2"><input type="radio" className="mt-0.5" checked={importTarget === 'replace'} onChange={() => { setImportTarget('replace'); setImportText('outline') }} /> <span><b>Replace all artwork</b> with this file — keeps the proof, comments and printer links</span></label>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 pt-2">Text in the file</p>
                  <label className="flex items-center gap-2"><input type="radio" checked={importText === 'outline'} onChange={() => setImportText('outline')} /> <span><b>Exact lettering</b> — text converted to outlines (recommended)</span></label>
                  <label className="flex items-center gap-2"><input type="radio" checked={importText === 'live'} onChange={() => setImportText('live')} /> <span>Editable text — fonts may be <b>substituted</b></span></label>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 pt-2">Options</p>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={importUngroup} onChange={e => setImportUngroup(e.target.checked)} /> Ungroup — every shape and text can be selected on its own</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={fitArtboard} onChange={e => setFitArtboard(e.target.checked)} /> Resize artboard to the file&apos;s page</label>
                </div>
                {docSource ? (
                  <div className="text-[11px] bg-emerald-50 border border-emerald-200 rounded p-2 text-emerald-800">
                    <i className="ti ti-shield-check" /> Original stored unaltered: <b className="break-all">{docSource.name}</b> ({docSource.size > 1e6 ? (docSource.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(docSource.size / 1e3)) + ' KB'}) · SHA-256 {docSource.sha256.slice(0, 12)}… Printers download this exact file.
                  </div>
                ) : (
                  <div className="text-[11px] bg-amber-50 border border-amber-200 rounded p-2 text-amber-800">
                    <i className="ti ti-alert-triangle" /> No original file is stored for this design. Use <b>Replace all artwork</b> with the original .ai / .pdf so printers get the exact file.
                  </div>
                )}
                <button disabled={!!importing} onClick={() => fileRef.current?.click()} className="w-full py-2 rounded-lg bg-[#3B6FE0] text-white text-sm font-medium disabled:opacity-60">
                  {importing ? <><i className="ti ti-loader-2 animate-spin" /> {importing}</> : <><i className="ti ti-upload" /> Choose file…</>}
                </button>
                <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
                {importMsg.length > 0 && <ul className="text-xs space-y-1">{importMsg.map((m, i) => <li key={i} className={i === 0 ? 'text-gray-800' : 'text-amber-700'}>{i === 0 ? '✓ ' : '⚠ '}{m}</li>)}</ul>}
                <p className="text-[11px] text-gray-400">Files are converted locally in your browser — nothing is uploaded until you save. For .ai files, Illustrator&apos;s default &quot;Create PDF Compatible File&quot; must be on (it almost always is).</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx global>{`
        .pk-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 6px; color: #374151; font-size: 15px; }
        .pk-btn:hover { background: #F3F4F6; color: #111827; }
      `}</style>
    </div>
  )
})

export default Editor

function shapeToD(o: any): string {
  // local centred geometry for simple shapes → path d in the object's own plane
  const w = o.width, h = o.height
  if (o.type === 'rect') {
    const rx = Math.min(o.rx || 0, w / 2), ry = Math.min(o.ry || o.rx || 0, h / 2)
    if (!rx) return `M ${-w / 2} ${-h / 2} H ${w / 2} V ${h / 2} H ${-w / 2} Z`
    return `M ${-w / 2 + rx} ${-h / 2} H ${w / 2 - rx} A ${rx} ${ry} 0 0 1 ${w / 2} ${-h / 2 + ry} V ${h / 2 - ry} A ${rx} ${ry} 0 0 1 ${w / 2 - rx} ${h / 2} H ${-w / 2 + rx} A ${rx} ${ry} 0 0 1 ${-w / 2} ${h / 2 - ry} V ${-h / 2 + ry} A ${rx} ${ry} 0 0 1 ${-w / 2 + rx} ${-h / 2} Z`
  }
  if (o.type === 'ellipse' || o.type === 'circle') {
    const rx = o.rx ?? o.radius, ry = o.ry ?? o.radius
    return `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${-rx} 0 A ${rx} ${ry} 0 1 1 ${rx} 0 Z`
  }
  if (o.type === 'triangle') return `M ${-w / 2} ${h / 2} L 0 ${-h / 2} L ${w / 2} ${h / 2} Z`
  if (o.type === 'polygon' || o.type === 'polyline') {
    const pts = o.points.map((p: any) => `${p.x - o.pathOffset.x} ${p.y - o.pathOffset.y}`)
    return 'M ' + pts.join(' L ') + (o.type === 'polygon' ? ' Z' : '')
  }
  return ''
}

function ObjRow({ o, depth, locked, active, label, onSelect }: { o: any; depth: number; locked: boolean; active: any; label: (o: any) => string; onSelect: (o: any) => void }) {
  const [open, setOpen] = useState(false)
  const kids: any[] = o.type === 'group' ? o.getObjects().slice().reverse() : []
  return (
    <>
      <div className={`w-full text-left pr-2 py-1 text-[11px] flex items-center gap-1.5 hover:bg-gray-50 ${active === o ? 'bg-blue-50 text-[#3B6FE0]' : 'text-gray-600'}`} style={{ paddingLeft: 10 + depth * 12 }}>
        {kids.length ? <button onClick={() => setOpen(v => !v)} className="w-3 text-gray-400 hover:text-black"><i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'}`} /></button> : <span className="w-3" />}
        <button onClick={() => onSelect(o)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left" disabled={locked}>
          <i className={`ti ${o.type === 'image' ? 'ti-photo' : o.type.includes('text') ? 'ti-typography' : o.type === 'group' ? (o.clipPath ? 'ti-crop' : 'ti-folder') : 'ti-vector'} text-gray-400`} />
          <span className="truncate">{o.type.includes('text') && o.text ? `"${String(o.text).slice(0, 24)}"` : label(o)}{kids.length ? ` (${kids.length})` : ''}</span>
        </button>
      </div>
      {open && kids.map((k: any) => <ObjRow key={k.id || k.__key || (k.__key = Math.random().toString(36).slice(2))} o={k} depth={depth + 1} locked={locked} active={active} label={label} onSelect={onSelect} />)}
    </>
  )
}

function NumField({ label, value, onCommit, wide }: { label: string; value: number; onCommit: (v: number) => void; wide?: boolean }) {
  const [v, setV] = useState(String(value ?? ''))
  useEffect(() => { setV(String(value ?? '')) }, [value])
  const commit = () => { const n = parseFloat(v); if (isFinite(n) && n !== value) onCommit(n); else setV(String(value ?? '')) }
  return (
    <label className={`flex items-center gap-1 border border-gray-300 rounded px-1.5 ${wide ? 'w-full' : 'w-[78px]'} shrink-0`}>
      <span className="text-[10px] text-gray-400 font-semibold whitespace-nowrap">{label}</span>
      <input value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } }}
        className="w-full py-1 text-xs outline-none bg-transparent min-w-0" />
    </label>
  )
}

function Swatches({ swatches, onPick, onAdd, onRemove }: { swatches: Swatch[]; onPick: (s: Swatch, stroke: boolean) => void; onAdd: () => void; onRemove: (i: number) => void }) {
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Swatches</span>
        <button onClick={onAdd} className="text-[11px] text-[#3B6FE0] hover:underline" title="Save the selected fill as a swatch">+ Add from fill</button>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {swatches.map((s, i) => (
          <button key={i} onClick={e => onPick(s, e.shiftKey)} onContextMenu={e => { e.preventDefault(); if (confirm(`Remove swatch "${s.name}"?`)) onRemove(i) }}
            title={`${s.name}${s.cmyk ? ` — C${s.cmyk[0]} M${s.cmyk[1]} Y${s.cmyk[2]} K${s.cmyk[3]}` : ''}${s.spot ? ' (spot)' : ''}\nClick = fill · Shift-click = stroke · Right-click = remove`}
            className="relative w-7 h-7 rounded border border-gray-300" style={{ background: s.hex }}>
            {s.spot && <span className="absolute bottom-0 right-0 w-2 h-2 bg-white border border-gray-400 rotate-45 translate-x-0.5 translate-y-0.5" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function Rulers({ vpt, w, h, unit, cursor }: { vpt: number[]; w: number; h: number; unit: DesignDoc['unit']; cursor: { x: number; y: number } | null }) {
  const topRef = useRef<HTMLCanvasElement>(null), leftRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1
    const z = vpt[0] || 1, upt = UNIT_PT[unit]
    // choose a tick step (in units) giving ~ 60px between labels
    const steps = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
    const step = steps.find(s => s * upt * z >= 55) || 1000
    const draw = (cv: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!cv) return
      const len = horizontal ? w : h
      const cw = horizontal ? len : RULER, ch = horizontal ? RULER : len
      cv.width = cw * dpr; cv.height = ch * dpr
      cv.style.width = cw + 'px'; cv.style.height = ch + 'px'
      const ctx = cv.getContext('2d')!; ctx.scale(dpr, dpr)
      ctx.fillStyle = '#F9FAFB'; ctx.fillRect(0, 0, cw, ch)
      ctx.strokeStyle = '#9CA3AF'; ctx.fillStyle = '#6B7280'; ctx.font = '9px sans-serif'; ctx.lineWidth = 1
      const off = horizontal ? vpt[4] : vpt[5]
      const startU = Math.floor((-off / z) / upt / step) * step
      for (let uu = startU; ; uu += step / 5) {
        const px = uu * upt * z + off
        if (px > len) break
        const major = Math.abs(uu / step - Math.round(uu / step)) < 1e-6
        const th = major ? RULER : RULER / 3
        ctx.beginPath()
        if (horizontal) { ctx.moveTo(px + 0.5, RULER); ctx.lineTo(px + 0.5, RULER - th) } else { ctx.moveTo(RULER, px + 0.5); ctx.lineTo(RULER - th, px + 0.5) }
        ctx.stroke()
        if (major) {
          const label = String(+uu.toFixed(2))
          if (horizontal) ctx.fillText(label, px + 2, 9)
          else { ctx.save(); ctx.translate(9, px + 2); ctx.rotate(Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore() }
        }
      }
      if (cursor) {
        const c = (horizontal ? cursor.x : cursor.y) * z + off
        ctx.strokeStyle = '#EF4444'; ctx.beginPath()
        if (horizontal) { ctx.moveTo(c + 0.5, 0); ctx.lineTo(c + 0.5, RULER) } else { ctx.moveTo(0, c + 0.5); ctx.lineTo(RULER, c + 0.5) }
        ctx.stroke()
      }
      ctx.strokeStyle = '#E5E7EB'; ctx.beginPath()
      if (horizontal) { ctx.moveTo(0, RULER - 0.5); ctx.lineTo(len, RULER - 0.5) } else { ctx.moveTo(RULER - 0.5, 0); ctx.lineTo(RULER - 0.5, len) }
      ctx.stroke()
    }
    draw(topRef.current, true); draw(leftRef.current, false)
  }, [vpt, w, h, unit, cursor])
  return (
    <>
      <div className="absolute left-0 top-0 bg-[#F3F4F6] border-r border-b border-gray-200 text-[9px] text-gray-500 grid place-items-center" style={{ width: RULER, height: RULER }}>{unit}</div>
      <canvas ref={topRef} className="absolute top-0" style={{ left: RULER }} />
      <canvas ref={leftRef} className="absolute left-0" style={{ top: RULER }} />
    </>
  )
}
