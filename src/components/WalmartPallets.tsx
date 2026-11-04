'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Walmart pallet building.
 *
 * Every Walmart PO is planned into pallets automatically (DB: walmart_pallet_replan) from the
 * pallet arrangement on each SKU (products.pallet_ti_hi / cases_per_pallet / case_size):
 * a full pallet per SKU when the quantity reaches the arrangement total, and the leftovers
 * ("floor") of the PO on mixed pallets. Cube (cubic feet, what Walmart asks for) is a 48x40 CHEP pallet (6" base) to load height.
 *
 * Each pallet moves: Planned → Confirm build (staged) → Released → Claimed → Wrapped & labeled
 * → Built (photo). Built pallets add their SRPs to the PO lines; when every pallet of a PO is
 * built the PO moves to Ready for Shipment.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'

export interface BPallet {
  id: string; order_id: string; pallet_no: number; kind: string; status: string; srps: number
  height_in: number | null; cbm: number | null; cube_ft?: number | null; weight_lb: number | null
  staged_by: string | null; staged_at: string | null; released_by: string | null; released_at: string | null
  claimed_by: string | null; claimed_at: string | null; wrapped_by: string | null; wrapped_at: string | null
  built_by: string | null; built_at: string | null; photo_url: string | null; note: string | null
}
export interface BItem { id: string; pallet_id: string; order_id: string; seq: number; sku: string; srps: number; per_layer: number | null; ti: number | null; hi: number | null; full_layers: number | null; partial: number | null; layer_h: number | null }
interface Dims { big: number; mid: number; small: number }

const num = (v: any) => Number(v) || 0
const fmtN = (v: any, dp = 0) => num(v).toLocaleString('en-US', { maximumFractionDigits: dp })
const who = (e?: string | null) => (e || '').split('@')[0]
const when = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export const SKU_META: Record<string, { short: string; color: string }> = {
  '22GVS24': { short: 'Spoon 24', color: '#3B82F6' }, '22GVF24': { short: 'Fork 24', color: '#F59E0B' },
  '22GVA24': { short: 'Assorted 24', color: '#10B981' }, '22GVA48': { short: 'Assorted 48', color: '#8B5CF6' },
  '22GVK48': { short: 'Knife 48', color: '#EF4444' }, '22GVS48': { short: 'Spoon 48', color: '#0EA5E9' },
  '22GVF48': { short: 'Fork 48', color: '#F97316' },
}
export const skuShort = (s: string) => SKU_META[s]?.short || s
const skuColor = (s: string) => SKU_META[s]?.color || '#64748B'

export const STEPS = [
  { key: 'planned', label: 'Planned', action: 'Confirm build', step: 'stage', color: '#9699a6' },
  { key: 'staged', label: 'Staged', action: 'Release', step: 'release', color: '#579bfc' },
  { key: 'released', label: 'Released', action: 'Claim', step: 'claim', color: '#a25ddc' },
  { key: 'claimed', label: 'Claimed', action: 'Wrapped & labeled', step: 'wrap', color: '#fdab3d' },
  { key: 'wrapped', label: 'Wrapped & labeled', action: 'Confirm built + photo', step: 'built', color: '#ff7575' },
  { key: 'built', label: 'Built', action: '', step: '', color: '#00c875' },
] as const
export const stepIdx = (s: string) => Math.max(0, STEPS.findIndex(x => x.key === s))

// ── data ─────────────────────────────────────────────────────────────────────
export function usePalletData(sb: any, orderIds?: string[] | null) {
  const [pallets, setPallets] = useState<BPallet[]>([])
  const [items, setItems] = useState<BItem[]>([])
  const [dims, setDims] = useState<Record<string, Dims>>({})
  const key = orderIds ? orderIds.join(',') : '*'
  const load = useCallback(async () => {
    let q = sb.from('walmart_build_pallets').select('*').order('pallet_no')
    if (orderIds) { if (!orderIds.length) { setPallets([]); setItems([]); return } q = q.in('order_id', orderIds) }
    const { data: p } = await q
    const ps = (p as BPallet[]) || []
    setPallets(ps)
    if (ps.length) {
      const ids = Array.from(new Set(ps.map(x => x.order_id)))
      const all: BItem[] = []
      for (let i = 0; i < ids.length; i += 80) {
        const { data: it } = await sb.from('walmart_build_pallet_items').select('*').in('order_id', ids.slice(i, i + 80)).order('seq')
        all.push(...((it as BItem[]) || []))
      }
      setItems(all)
    } else setItems([])
  }, [sb, key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  useEffect(() => {
    sb.from('products').select('sku,case_size').ilike('sku', '22GV%').then(({ data }: any) => {
      const m: Record<string, Dims> = {}
      for (const r of (data || []) as any[]) {
        const d = String(r.case_size || '').split(/[xX×]/).map(s => parseFloat(s)).filter(n => n > 0)
        if (d.length === 3) { const s = [...d].sort((a, b) => b - a); m[String(r.sku).toUpperCase()] = { big: s[0], mid: s[1], small: s[2] } }
      }
      setDims(m)
    })
  }, [sb])
  useEffect(() => {
    const ch = sb.channel('wm-pallets-' + Math.random().toString(36).slice(2))
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 500) }
    for (const tb of ['walmart_build_pallets', 'walmart_build_pallet_items']) ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump)
    ch.subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load])
  return { pallets, items, dims, reload: load }
}

// ── step actions (with photo upload for "built") ─────────────────────────────
export function usePalletActions(sb: any, onDone: (msg: string) => void) {
  const [busy, setBusy] = useState('')
  const step = useCallback(async (p: BPallet, stepKey: string, po: string, photo?: File | null) => {
    setBusy(p.id)
    try {
      let url: string | null = null
      if (stepKey === 'built') {
        if (!photo) { onDone('⚠ Take a photo of the built pallet first.'); return }
        const ext = (photo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        const path = `walmart-pallets/${p.order_id}/${p.pallet_no}-${Date.now()}.${ext}`
        const up = await sb.storage.from('erp-images').upload(path, photo, { upsert: false, contentType: photo.type || 'image/jpeg' })
        if (up.error) { onDone('⚠ Photo upload failed: ' + up.error.message); return }
        url = sb.storage.from('erp-images').getPublicUrl(path).data.publicUrl
      }
      const { data, error } = await sb.rpc('walmart_pallet_step', { p_pallet: p.id, p_step: stepKey, p_photo: url, p_note: null })
      if (error) { onDone('⚠ ' + error.message); return }
      const label = STEPS.find(s => s.key === (data as any)?.status)?.label || (data as any)?.status
      onDone(`✓ PO ${po} · pallet #${p.pallet_no} → ${label}.`)
    } finally { setBusy('') }
  }, [sb, onDone])
  const undo = useCallback(async (p: BPallet, po: string) => {
    const reason = window.prompt(`Step pallet #${p.pallet_no} of PO ${po} back one step?\n\nWhy?`, 'Pressed by mistake')
    if (!reason) return
    setBusy(p.id)
    const { error } = await sb.rpc('walmart_pallet_undo', { p_pallet: p.id, p_reason: reason })
    setBusy('')
    onDone(error ? '⚠ ' + error.message : `↩ Pallet #${p.pallet_no} of PO ${po} moved back one step.`)
  }, [sb, onDone])
  return { busy, step, undo }
}

// ── schematic ────────────────────────────────────────────────────────────────
const PW = 48, PD = 40
/** best orientation of a ti × hi layer on a 48 × 40 pallet */
export function layerGrid(ti: number, hi: number, d?: Dims) {
  const big = d?.big || 12, mid = d?.mid || 7
  const opts = [
    { cols: ti, rows: hi, cw: mid, ch: big }, { cols: ti, rows: hi, cw: big, ch: mid },
    { cols: hi, rows: ti, cw: mid, ch: big }, { cols: hi, rows: ti, cw: big, ch: mid },
  ].map(o => ({ ...o, over: Math.max(0, o.cols * o.cw - PW) + Math.max(0, o.rows * o.ch - PD), fill: (o.cols * o.cw * o.rows * o.ch) }))
  opts.sort((a, b) => a.over - b.over || b.fill - a.fill)
  return opts[0]
}

function LayerSvg({ it, d, filled, size = 150 }: { it: BItem; d?: Dims; filled?: number; size?: number }) {
  const g = layerGrid(num(it.ti) || 1, num(it.hi) || 1, d)
  const s = size / PW
  const total = g.cols * g.rows
  const ox = (PW - g.cols * g.cw) / 2, oy = (PD - g.rows * g.ch) / 2
  const color = skuColor(it.sku)
  return (
    <svg width={size} height={PD * s + 2} viewBox={`-1 -1 ${PW + 2} ${PD + 2}`} className="block">
      <rect x={0} y={0} width={PW} height={PD} fill="#F3E7D3" stroke="#C9A877" strokeWidth={0.6} />
      {Array.from({ length: total }).map((_, i) => {
        const c = i % g.cols, r = Math.floor(i / g.cols)
        const on = filled == null || i < filled
        return <rect key={i} x={ox + c * g.cw + 0.25} y={oy + r * g.ch + 0.25} width={g.cw - 0.5} height={g.ch - 0.5} rx={0.6}
          fill={on ? color : '#ffffff'} fillOpacity={on ? 0.85 : 0.6} stroke={on ? '#1f2937' : '#cbd5e1'} strokeWidth={0.25} strokeDasharray={on ? undefined : '1 1'} />
      })}
    </svg>
  )
}

/** Side view (stack) + one top view per block, with the build instructions written out */
export function PalletSchematic({ pallet, items, dims }: { pallet: BPallet; items: BItem[]; dims: Record<string, Dims> }) {
  const its = [...items].sort((a, b) => a.seq - b.seq)
  const H = 54, scale = 3.2
  let y = 0
  const blocks = its.map(it => {
    const layers = num(it.full_layers) + (num(it.partial) > 0 ? 1 : 0)
    const h = layers * num(it.layer_h || 4)
    const b = { it, y0: y, h, layers }
    y += h
    return b
  })
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="shrink-0">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Side view</p>
        <svg width={PW * scale * 0.9} height={H * scale + 14} viewBox={`-2 -2 ${PW + 4} ${H + 10}`}>
          <rect x={0} y={H - 6} width={PW} height={6} fill="#8B6A3E" />
          {[4, 20, 36].map(x => <rect key={x} x={x} y={H - 6} width={8} height={6} fill="#6b4f2b" />)}
          {blocks.map((b, i) => {
            const top = H - 6 - (b.y0 + b.h)
            return (
              <g key={i}>
                {Array.from({ length: b.layers }).map((_, k) => {
                  const partialTop = k === b.layers - 1 && num(b.it.partial) > 0
                  const per = num(b.it.per_layer) || 1
                  const w = partialTop ? Math.max(6, PW * (num(b.it.partial) / per)) : PW
                  const ly = H - 6 - b.y0 - (k + 1) * num(b.it.layer_h || 4)
                  return <rect key={k} x={0} y={ly} width={w} height={num(b.it.layer_h || 4)} fill={skuColor(b.it.sku)} fillOpacity={partialTop ? 0.45 : 0.85} stroke="#fff" strokeWidth={0.3} />
                })}
                <text x={PW / 2} y={top + b.h / 2 + 1.4} textAnchor="middle" fontSize={3.4} fontWeight={700} fill="#fff">{skuShort(b.it.sku)}</text>
              </g>)
          })}
          <text x={PW + 1} y={H - 6 - y} fontSize={3} fill="#475569">{fmtN(y + 6, 1)}&quot;</text>
          <line x1={0} x2={PW} y1={H - 6 - 44} y2={H - 6 - 44} stroke="#ef4444" strokeWidth={0.25} strokeDasharray="1 1" />
        </svg>
        <p className="text-[10px] text-gray-400">48&quot; × 40&quot; CHEP · {fmtN(num(pallet.height_in) + 6, 1)}&quot; tall · {fmtN(pallet.cube_ft, 1)} cu ft cube · {fmtN(pallet.weight_lb)} lb</p>
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-400">Build order — bottom to top</p>
        {its.map((it, i) => {
          const d = dims[it.sku]
          const per = num(it.per_layer)
          return (
            <div key={it.id} className="flex gap-3 items-start">
              <div className="shrink-0 space-y-1">
                <LayerSvg it={it} d={d} size={120} />
                {num(it.partial) > 0 && <LayerSvg it={it} d={d} filled={num(it.partial)} size={120} />}
              </div>
              <div className="text-[12px] text-[#1A1D2E]">
                <p className="font-bold"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: skuColor(it.sku) }} />{i + 1}. {skuShort(it.sku)} <span className="font-mono text-[10px] text-gray-400">{it.sku}</span></p>
                <p><b>{fmtN(it.srps)} SRPs</b>{per ? <> · {num(it.ti)} × {num(it.hi)} = {per} per layer</> : null}</p>
                {per > 0 && <p>{num(it.full_layers) > 0 ? `${num(it.full_layers)} full layer${num(it.full_layers) === 1 ? '' : 's'}` : ''}{num(it.full_layers) > 0 && num(it.partial) > 0 ? ' + ' : ''}{num(it.partial) > 0 ? `${num(it.partial)} SRPs on a top layer (shaded cells, start from a corner)` : ''}</p>}
                {d && <p className="text-[10px] text-gray-400">SRP {d.big}&quot; × {d.mid}&quot; · {d.small}&quot; per layer</p>}
              </div>
            </div>)
        })}
        <p className="text-[10px] text-gray-400">One PO per pallet — do not mix POs. Do not double stack. Wrap, then put the label on two sides.</p>
      </div>
    </div>
  )
}

// ── one pallet row with its next action ──────────────────────────────────────
export function PalletRow({ p, items, dims, po, canEdit, busy, onStep, onUndo, showPo }: {
  p: BPallet; items: BItem[]; dims: Record<string, Dims>; po: string; canEdit: boolean; busy: boolean
  onStep: (p: BPallet, step: string, photo?: File | null) => void; onUndo: (p: BPallet) => void; showPo?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const i = stepIdx(p.status), s = STEPS[i]
  const last = [p.built_at && `built by ${who(p.built_by)} ${when(p.built_at)}`, p.wrapped_at && `wrapped ${who(p.wrapped_by)}`, p.claimed_at && `claimed ${who(p.claimed_by)}`, p.released_at && `released ${who(p.released_by)}`, p.staged_at && `staged ${who(p.staged_by)} ${when(p.staged_at)}`].filter(Boolean)[0]
  return (
    <div className="rounded-xl border border-[#ECEEF3] bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderLeft: `4px solid ${s.color}` }}>
        <button onClick={() => setOpen(o => !o)} className="text-left flex-1 min-w-[180px]" data-ro-ok>
          <p className="text-sm font-bold text-[#1A1D2E]">{showPo ? `PO ${po} · ` : ''}Pallet #{p.pallet_no} <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ml-1 ${p.kind === 'full' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.kind === 'full' ? 'FULL' : 'FLOOR · mixed'}</span>
            {(canEdit || p.status !== 'planned') && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded ml-1 text-white" style={{ background: s.color }}>{s.label}</span>}</p>
          <p className="text-[11px] text-gray-500">{items.map(it => `${fmtN(it.srps)} ${skuShort(it.sku)}`).join(' + ')} · {fmtN(p.srps)} SRPs · {fmtN(p.cube_ft, 1)} cu ft{last ? ' · ' + last : ''} · <span className="text-[#0071ce] underline">{open ? 'hide' : 'show'} build drawing</span></p>
        </button>
        {p.photo_url && <a href={p.photo_url} target="_blank" rel="noreferrer" data-ro-ok><img src={p.photo_url} alt="Built pallet" className="w-10 h-10 rounded-lg object-cover border border-[#E4E6EE]" /></a>}
        {canEdit && s.step === 'built' && (
          <label className={`h-9 px-3 rounded-lg border text-xs font-semibold flex items-center cursor-pointer ${photo ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-[#E4E6EE] text-gray-600'}`}>
            📷 {photo ? 'Photo ready' : 'Take photo'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => setPhoto(e.target.files?.[0] || null)} />
          </label>)}
        {canEdit && s.step && <button disabled={busy || (s.step === 'built' && !photo)} onClick={() => { if (s.step === 'stage') setOpen(true); onStep(p, s.step, photo) }}
          className="h-9 px-3 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ background: STEPS[Math.min(i + 1, STEPS.length - 1)].color }}>{busy ? '…' : s.step === 'built' ? 'Submit — built' : s.action}</button>}
        {canEdit && i > 0 && <button disabled={busy} onClick={() => onUndo(p)} className="h-9 px-2 text-[11px] text-gray-400 hover:text-red-600" title="Step back one">↩</button>}
      </div>
      {open && <div className="px-3 py-3 border-t border-[#F0F2F6] bg-[#FBFCFE]"><PalletSchematic pallet={p} items={items} dims={dims} /></div>}
    </div>
  )
}

// ── build sheet PDF (one page per pallet) ─────────────────────────────────────
export function buildSheetPdf(po: { po_number: string | null; name?: string | null; ship_due_date?: string | null }, pallets: BPallet[], items: BItem[], dims: Record<string, Dims>) {
  void dims
  const doc = new jsPDF({ unit: 'in', format: 'letter' })
  doc.setLineWidth(0.01)
  const M = 0.45, PG = 8.5, CW = (PG - 2 * M - 0.16) / 2, CH = 1.7
  const its = (pid: string) => items.filter(i => i.pallet_id === pid).sort((a, b) => num(a.seq) - num(b.seq))
  const head = () => {
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.text('PALLET BUILD SHEET   ' + (po.po_number || ''), M, 0.55)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80)
    doc.text((po.name || '') + (po.ship_due_date ? '    Ship ' + po.ship_due_date : ''), M, 0.74)
    const tS = pallets.reduce((a, p) => a + num(p.srps), 0)
    const tW = pallets.reduce((a, p) => a + num(p.weight_lb), 0)
    doc.text(pallets.length + ' pallets     ' + fmtN(tS) + ' SRPs     ' + fmtN(tW) + ' lb', M, 0.9)
    doc.setDrawColor(150, 150, 150); doc.line(M, 1.0, PG - M, 1.0)
  }
  const card = (p: BPallet, x: number, y: number) => {
    const li = its(p.id)
    const a = li[0]
    const ti = a ? num(a.ti) : 0
    const hi = a ? num(a.hi) : 0
    const lay = li.reduce((s, i) => s + Math.ceil(num(i.srps) / (num(i.per_layer) || 1)), 0)
    doc.setDrawColor(190, 190, 190); doc.rect(x, y, CW, CH)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0)
    doc.text('PALLET ' + p.pallet_no, x + 0.09, y + 0.22)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110, 110, 110)
    doc.text(String(p.kind || '').toUpperCase(), x + 0.95, y + 0.22)
    const mixed = li.length > 1
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(0, 0, 0)
    doc.text(mixed ? 'MIXED' : ti + ' x ' + hi + ' x ' + lay, x + 0.09, y + 0.62)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120)
    doc.text(mixed ? 'Ti x Hi x layers per SKU below' : 'Ti x Hi x layers', x + 0.09, y + 0.76)
    const show = li.length > 5 ? li.slice(0, 4) : li
    doc.setFontSize(7); doc.setTextColor(30, 30, 30)
    show.forEach((it, k) => {
      const L = Math.ceil(num(it.srps) / (num(it.per_layer) || 1))
      doc.text(fmtN(it.srps) + '  ' + skuShort(it.sku) + '    ' + (mixed ? num(it.ti) + ' x ' + num(it.hi) + ' x ' + L + '    ' : '') + fmtN(it.per_layer) + ' per layer', x + 0.09, y + 0.93 + k * 0.125)
    })
    if (li.length > 5) { doc.text('+ ' + (li.length - 4) + ' more - see Pallet Plan', x + 0.09, y + 0.93 + 4 * 0.125) }
    doc.setFontSize(6.5); doc.setTextColor(90, 90, 90)
    doc.text(fmtN(p.srps) + ' SRPs    ' + fmtN(p.height_in, 1) + ' in    ' + fmtN(p.cube_ft, 1) + ' cu ft    ' + fmtN(p.weight_lb) + ' lb', x + 0.09, y + CH - 0.1)
    const dw = 1.08, dh = 0.9, dx = x + CW - dw - 0.12, dy = y + 0.3
    doc.setDrawColor(130, 130, 130); doc.rect(dx, dy, dw, dh)
    if (ti > 0 && hi > 0) {
      const cw = dw / ti, ch = dh / hi
      doc.setDrawColor(165, 165, 165)
      for (let c = 0; c < ti; c++) for (let r = 0; r < hi; r++) doc.rect(dx + c * cw, dy + r * ch, cw, ch)
    }
    doc.setFontSize(5.5); doc.setTextColor(130, 130, 130)
    doc.text('one layer of ' + (a ? skuShort(a.sku) : '') + ', from above', dx, dy + dh + 0.1)
  }
  let i = 0, pg = 0
  while (i < pallets.length) {
    if (pg > 0) doc.addPage()
    head()
    for (let k = 0; k < 10 && i < pallets.length; k++, i++) {
      card(pallets[i], M + (k % 2) * (CW + 0.16), 1.15 + Math.floor(k / 2) * (CH + 0.08))
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120)
    doc.text('Ti x Hi = cases across x cases deep in one layer.  Layers = how many of those layers are stacked.  Pallet is 48 x 40 in, 6 in deck, 50 lb tare.', M, 10.45)
    pg++
  }
  return doc
}

export function planPdf(po: { po_number: string | null; name?: string | null; ship_due_date?: string | null }, pallets: BPallet[], items: BItem[]) {
  const doc = new jsPDF({ unit: 'in', format: 'letter' })
  doc.setLineWidth(0.01)
  const M = 0.5, R = 8.0
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(0, 0, 0)
  doc.text('PALLET PLAN & CUBE   ' + (po.po_number || ''), M, 0.6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80)
  doc.text((po.name || '') + (po.ship_due_date ? '    Ship ' + po.ship_due_date : ''), M, 0.8)
  const cols = [M, M + 0.65, M + 1.55, M + 4.3, M + 5.45, M + 6.15, M + 6.9]
  const hdr = ['PALLET', 'TYPE', 'CONTENTS', 'Ti x Hi x L', 'HT IN', 'CU FT', 'LB']
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0, 0, 0)
  hdr.forEach((h, k) => doc.text(h, cols[k], 1.18))
  doc.setDrawColor(150, 150, 150); doc.line(M, 1.25, R, 1.25)
  doc.setFont('helvetica', 'normal')
  let y = 1.45
  pallets.forEach(p => {
    const li = items.filter(i => i.pallet_id === p.id).sort((a, b) => num(a.seq) - num(b.seq))
    const a = li[0]
    const lay = li.reduce((s, i) => s + Math.ceil(num(i.srps) / (num(i.per_layer) || 1)), 0)
    const cont = li.map(i => fmtN(i.srps) + ' ' + skuShort(i.sku)).join(' + ')
    doc.setTextColor(0, 0, 0)
    doc.text(String(p.pallet_no), cols[0], y)
    doc.setTextColor(90, 90, 90)
    doc.text(String(p.kind || '').toUpperCase(), cols[1], y)
    doc.setTextColor(0, 0, 0)
    doc.text(cont.slice(0, 52), cols[2], y)
    doc.setFont('helvetica', 'bold')
    doc.text(a ? num(a.ti) + ' x ' + num(a.hi) + ' x ' + lay : '', cols[3], y)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtN(p.height_in, 1), cols[4], y)
    doc.text(fmtN(p.cube_ft, 1), cols[5], y)
    doc.text(fmtN(p.weight_lb), cols[6], y)
    y += 0.2
  })
  doc.setDrawColor(150, 150, 150); doc.line(M, y - 0.13, R, y - 0.13)
  doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0)
  doc.text('TOTAL', cols[0], y + 0.05)
  doc.text(pallets.length + ' pallets    ' + fmtN(pallets.reduce((s, p) => s + num(p.srps), 0)) + ' SRPs', cols[2], y + 0.05)
  doc.text(fmtN(pallets.reduce((s, p) => s + num(p.cube_ft), 0), 1), cols[5], y + 0.05)
  doc.text(fmtN(pallets.reduce((s, p) => s + num(p.weight_lb), 0)), cols[6], y + 0.05)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120)
  doc.text('Ti x Hi x L = cases across x cases deep x layers high.  Cube and weight include a 48 x 40 in pallet, 6 in deck, 50 lb tare.', M, y + 0.35)
  return doc
}

export function WalmartPalletPlan({ sb, order, canEdit, onChanged }: {
  sb: any; order: { id: string; po_number: string | null; name?: string | null; ship_due_date?: string | null; cbm?: number | null; plan_pallets?: number | null; plan_weight?: number | null; plan_stale?: boolean | null; group_name?: string | null }
  canEdit: boolean; onChanged?: () => void
}) {
  const ids = useMemo(() => [order.id], [order.id])
  const { pallets, items, dims, reload } = usePalletData(sb, ids)
  const [msg, setMsg] = useState('')
  const done = useCallback((m: string) => { setMsg(m); reload(); onChanged?.() }, [reload, onChanged])
  const { busy, step, undo } = usePalletActions(sb, done)
  const po = order.po_number || ''
  const built = pallets.filter(p => p.status === 'built').length
  const cube = pallets.reduce((t, p) => t + num(p.cube_ft), 0), wt = pallets.reduce((t, p) => t + num(p.weight_lb), 0)
  const full = pallets.filter(p => p.kind === 'full').length
  async function replan() {
    if (!window.confirm('Rebuild the pallet plan from the current lines? Only allowed while no pallet has been started.')) return
    const { data, error } = await sb.rpc('walmart_pallet_replan', { p_order: order.id, p_force: false })
    done(error ? '⚠ ' + error.message : (data as any)?.ok ? '✓ Pallet plan rebuilt.' : '⚠ Pallets are already in progress — undo them first to re-plan.')
  }
  return (
    <div className="border border-[#D6E9DD] bg-[#F6FBF8] rounded-lg p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0f7a4a] mr-auto">🏗 Pallet plan &amp; cube</p>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#CFE6D8]">{fmtN(cube, 1)} cu ft cube</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#CFE6D8]">{pallets.length} pallets ({full} full · {pallets.length - full} floor)</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#CFE6D8]">{fmtN(wt)} lb</span>
        {pallets.length > 0 && <button onClick={() => planPdf(order, pallets, items).save(`Pallet-Plan-${po || 'PO'}.pdf`)} className="text-xs px-2.5 py-1 rounded-lg bg-white border border-[#E4E6EE] text-gray-600" title="Print this plan">Print plan</button>}
            {pallets.length > 0 && <button onClick={() => buildSheetPdf(order, pallets, items, dims).save(`Pallet-Build-${po || 'PO'}.pdf`)} className="text-xs px-2.5 py-1 rounded-lg bg-white border border-[#CFE6D8] text-[#0f7a4a] font-semibold" data-ro-ok>🖨 Build sheets</button>}
        {canEdit && <button onClick={replan} className="text-xs px-2.5 py-1 rounded-lg bg-white border border-[#E4E6EE] text-gray-600" title="Re-plan from the order lines">↻ Re-plan</button>}
      </div>
      {order.plan_stale && <p className="text-[12px] rounded-lg bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 mb-2">⚠ The order lines changed after pallets were started, so this plan no longer matches the PO. Step the started pallets back (↩) and press Re-plan.</p>}
      {msg && <p className={`text-[12px] rounded-lg px-3 py-2 mb-2 ${msg.startsWith('⚠') ? 'bg-amber-50 border border-amber-300 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>{msg}</p>}
      {pallets.length === 0 ? <p className="text-sm text-gray-500">No pallets yet — add the SKU lines and the plan builds itself.</p> : (
        <div className="space-y-1.5">
          {pallets.map(p => <PalletRow key={p.id} p={p} items={items.filter(i => i.pallet_id === p.id)} dims={dims} po={po} canEdit={false} busy={busy === p.id}
            onStep={(pp, s, ph) => step(pp, s, po, ph)} onUndo={pp => undo(pp, po)} />)}
        </div>)}
      <p className="text-[10px] text-gray-500 mt-2">Full pallet = the SKU&apos;s pallet arrangement (S24 312 · F24 260 · A24 260 · A48 195 · K48 260 · S48 156 · F48 156). Anything less is floor and goes on a mixed pallet for this PO. Cube is in cubic feet (the figure Walmart asks for): 48×40 CHEP pallet, 6&quot; base, 50 lb, to the top of the load.</p>
    </div>
  )
}

// ── production floor queue (Build tab) ────────────────────────────────────────
export function WalmartPalletQueue({ sb, canEdit }: { sb: any; canEdit: boolean }) {
  const [orders, setOrders] = useState<any[]>([])
  const loadOrders = useCallback(async () => {
    const { data } = await sb.from('walmart_board_orders').select('id,po_number,name,ship_due_date,group_name,load_number,plan_stale').in('group_name', ['Walmart Orders', 'Building Order', 'Ready for Shipment']).eq('archived', false)
    setOrders((data as any[]) || [])
  }, [sb])
  useEffect(() => { loadOrders() }, [loadOrders])
  const ids = useMemo(() => orders.map(o => o.id), [orders])
  const { pallets, items, dims, reload } = usePalletData(sb, ids)
  const [msg, setMsg] = useState('')
  const [lane, setLane] = useState<string>('staged')
  const done = useCallback((m: string) => { setMsg(m); reload(); loadOrders() }, [reload, loadOrders])
  const { busy, step, undo } = usePalletActions(sb, done)
  const byOrder = useMemo(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders])
  const today = new Date().toISOString().slice(0, 10)
  const lanes = STEPS.map(s => ({ ...s, list: pallets.filter(p => p.status === s.key && (s.key !== 'built' || (p.built_at || '').slice(0, 10) === today)) }))
  const cur = lanes.find(l => l.key === lane) || lanes[1]
  const sorted = [...cur.list].sort((a, b) => String(byOrder[a.order_id]?.ship_due_date || '9999').localeCompare(String(byOrder[b.order_id]?.ship_due_date || '9999')) || a.pallet_no - b.pallet_no)
  const hint: Record<string, string> = {
    planned: 'Open a pallet to see its drawing, then press Confirm build to put it in the build queue.',
    staged: 'In the queue. Release a pallet once its SRPs are made — release only works for staged pallets.',
    released: 'Build team: claim a released pallet when you start it.',
    claimed: 'Wrap it and put the labels on, then press Wrapped & labeled.',
    wrapped: 'Take a photo of the finished pallet and press Submit — built. The PO lines update and, when every pallet is built, the PO moves to Ready for Shipment.',
    built: 'Built today.',
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[#EEF0F4]">
        {lanes.map(l => <button key={l.key} onClick={() => setLane(l.key)} data-ro-ok className={`h-10 px-3 rounded-lg text-[13px] font-semibold ${lane === l.key ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>
          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: l.color }} />{l.key === 'built' ? 'Built today' : l.label} <span className="text-gray-400">({l.list.length})</span></button>)}
      </div>
      <p className="text-[12px] rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[#0f7a5a] px-3 py-2">{hint[cur.key]}</p>
      {msg && <p className={`text-sm rounded-xl px-4 py-3 ${msg.startsWith('⚠') ? 'bg-amber-50 border border-amber-300 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>{msg}</p>}
      {sorted.length === 0 && <div className="bg-white rounded-xl border border-[#ECEEF3] p-6 text-center text-sm text-gray-500">Nothing here.</div>}
      <div className="space-y-1.5">
        {sorted.map(p => { const o = byOrder[p.order_id]; return (
          <div key={p.id}>
            <p className="text-[10px] text-gray-400 ml-1">{o?.name || ''}{o?.ship_due_date ? ' · ship ' + o.ship_due_date : ''}{o?.load_number ? ' · load ' + o.load_number : ''}</p>
            <PalletRow p={p} items={items.filter(i => i.pallet_id === p.id)} dims={dims} po={o?.po_number || ''} showPo canEdit={canEdit} busy={busy === p.id}
              onStep={(pp, s, ph) => step(pp, s, o?.po_number || '', ph)} onUndo={pp => undo(pp, o?.po_number || '')} />
          </div>) })}
      </div>
    </div>
  )
}

// ── process timeline (top of the Walmart Sales Order board) ───────────────────
// One race track. Each open PO is a runner placed at its stage (production release → build team
// claim → ready), moving along the segment as more of its SRPs clear that stage. Colors = work order.
const TL = ['PO in', 'SRPs released', 'Claimed · building', 'Ready to ship'] as const
const LAST = TL.length - 1
const PER_ROW = 5, DOT = 19
const WO_COLORS = ['#0071ce', '#e2445c', '#00a85a', '#a25ddc', '#fdab3d', '#0ea5e9', '#f97316', '#64748b']
export function WalmartProcessTimeline({ sb, onOpen }: { sb: any; onOpen?: (orderId: string) => void }) {
  const [orders, setOrders] = useState<any[]>([])
  const [links, setLinks] = useState<{ walmart_order_id: string; work_order_id: string; work_orders: { wo_code: string | null } | null }[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [woFilter, setWoFilter] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const load = useCallback(async () => {
    const [{ data: o }, { data: l }] = await Promise.all([
      sb.from('walmart_board_orders').select('id,po_number,name,ship_due_date,group_name').not('group_name', 'in', '("Shipped","Cancelled")').eq('archived', false),
      sb.from('walmart_wo_orders').select('walmart_order_id,work_order_id,work_orders(wo_code)'),
    ])
    setOrders((o as any[]) || []); setLinks((l as any[]) || [])
  }, [sb])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = sb.channel('wm-tl-' + Math.random().toString(36).slice(2)); let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 600) }
    for (const tb of ['walmart_board_orders', 'walmart_wo_orders']) ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump)
    ch.subscribe(); return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load])
  const ids = useMemo(() => orders.map(o => o.id), [orders])
  const [rels, setRels] = useState<{ walmart_order_id: string; qty: number; status: string }[]>([])
  const [lines, setLines] = useState<{ order_id: string; qty: number | null; completed_qty: number | null }[]>([])
  const loadQty = useCallback(async () => {
    if (!ids.length) { setRels([]); setLines([]); return }
    const r: any[] = [], l: any[] = []
    for (let i = 0; i < ids.length; i += 80) {
      const part = ids.slice(i, i + 80)
      const [{ data: a }, { data: b }] = await Promise.all([
        sb.from('walmart_releases').select('walmart_order_id,qty,status').in('walmart_order_id', part).in('status', ['Released', 'Claimed']),
        sb.from('walmart_board_lines').select('order_id,qty,completed_qty').in('order_id', part),
      ])
      r.push(...((a as any[]) || [])); l.push(...((b as any[]) || []))
    }
    setRels(r); setLines(l)
  }, [sb, ids])
  useEffect(() => { loadQty() }, [loadQty])
  useEffect(() => {
    const ch = sb.channel('wm-tlq-' + Math.random().toString(36).slice(2)); let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(loadQty, 600) }
    for (const tb of ['walmart_releases', 'walmart_board_lines']) ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump)
    ch.subscribe(); return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, loadQty])

  const wos = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) { const l = links.find(x => x.walmart_order_id === o.id); m.set(l?.work_order_id || 'none', l?.work_orders?.wo_code || 'No work order') }
    return Array.from(m.entries()).sort((a, b) => (a[0] === 'none' ? 1 : 0) - (b[0] === 'none' ? 1 : 0) || a[1].localeCompare(b[1])).map(([id, code], i) => ({ id, code, color: id === 'none' ? '#9699a6' : WO_COLORS[i % WO_COLORS.length] }))
  }, [orders, links])

  // runner position from the order's SRPs: released by production → claimed by the build team → ready
  const runners = useMemo(() => {
    const out = orders.map(o => {
      const ordered = lines.filter(x => x.order_id === o.id).reduce((t, x) => t + num(x.qty), 0)
      const rr = rels.filter(x => x.walmart_order_id === o.id)
      const released = rr.reduce((t, x) => t + num(x.qty), 0)
      const claimed = rr.filter(x => x.status === 'Claimed').reduce((t, x) => t + num(x.qty), 0)
      let st = 0, frac = 0
      if (['Ready for Shipment', 'Prepped & Ready for Dispatch'].includes(o.group_name)) st = LAST
      else if (claimed > 0 || o.group_name === 'Building Order') { st = 2; frac = ordered ? Math.min(1, claimed / ordered) : 0 }
      else if (released > 0) { st = 1; frac = ordered ? Math.min(1, released / ordered) : 0 }
      const l = links.find(x => x.walmart_order_id === o.id)
      const wo = wos.find(w => w.id === (l?.work_order_id || 'none'))
      return { o, st, frac, ordered, released, claimed, wo }
    }).filter(r => !woFilter || r.wo?.id === woFilter)
    // runners waiting at the same stage line up behind each other in a small pack (furthest along in front)
    const out2: any[] = []
    for (let st = 0; st < TL.length; st++) {
      const here = out.filter(r => r.st === st).sort((a, b) => b.frac - a.frac || String(a.o.ship_due_date || '9999').localeCompare(String(b.o.ship_due_date || '9999')))
      here.forEach((r, k) => out2.push({ ...r, col: k % PER_ROW, lane: Math.floor(k / PER_ROW) }))
    }
    return out2
  }, [orders, rels, lines, links, wos, woFilter])
  const lanes = Math.max(1, ...runners.map((r: any) => r.lane + 1))
  const above = Math.ceil(lanes / 2)
  const ROW = 24, TRACK = 10
  const topOf = (lane: number) => lane % 2 === 0 ? (above - 1 - lane / 2) * ROW : above * ROW + TRACK + 8 + ((lane - 1) / 2) * ROW
  const leftOf = (r: any) => r.st >= LAST ? `calc(100% - ${r.col * DOT + DOT + 2}px)` : `calc(${(r.st / LAST) * 100}% + ${r.col * DOT + 8}px)`
  const height = above * ROW + TRACK + 8 + Math.floor(lanes / 2) * ROW + 26
  const atStage = TL.map((_, i) => runners.filter((r: any) => r.st === i).length)
  const hov = runners.find(r => r.o.id === hover)

  return (
    <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[#F0F2F6]">
        <span className="font-bold text-sm text-[#1A1D2E] mr-auto">Process timeline <span className="text-gray-400 font-normal text-xs">— every open PO on one track</span></span>
        {!collapsed && <>
          <button onClick={() => setWoFilter(null)} data-ro-ok className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${!woFilter ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'border-[#E4E6EE] text-gray-600'}`}>All ({orders.length})</button>
          {wos.map(w => <button key={w.id} onClick={() => setWoFilter(f => f === w.id ? null : w.id)} data-ro-ok className="text-[11px] font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1.5"
            style={{ borderColor: woFilter === w.id ? w.color : '#E4E6EE', background: woFilter === w.id ? w.color + '18' : '#fff', color: '#3A4A6B' }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: w.color }} />{w.code}</button>)}
        </>}
        <button onClick={() => setCollapsed(c => !c)} className="text-xs text-gray-400 ml-2" data-ro-ok>{collapsed ? 'Show ▾' : 'Hide ▴'}</button>
      </div>
      {!collapsed && <div className="overflow-x-auto">
        <div className="relative min-w-[900px] mx-6 my-4" style={{ height }}>
          {/* track */}
          <div className="absolute left-0 right-0 rounded-full" style={{ top: above * ROW + 4, height: TRACK, background: 'linear-gradient(90deg,#e5e7eb,#d1fae5)' }} />
          {TL.map((t, i) => {
            const x = (i / LAST) * 100
            return (
              <div key={t} className="absolute" style={{ left: `${x}%`, top: 0, bottom: 0 }}>
                <div className="absolute w-px bg-[#E4E6EE]" style={{ top: 0, bottom: 22, left: 0 }} />
                <div className="absolute w-3 h-3 rounded-full bg-white border-2 border-[#9aa3b5]" style={{ top: above * ROW + 4 + TRACK / 2 - 6, left: -6 }} />
                <div className="absolute whitespace-nowrap text-[10px] font-bold uppercase tracking-wide text-gray-500" style={{ bottom: 0, left: 0, transform: i === 0 ? 'none' : i === LAST ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                  {t}{atStage[i] ? <span className="ml-1 text-[#1A1D2E]">{atStage[i]}</span> : null}</div>
              </div>)
          })}
          {/* runners */}
          {runners.map((r: any) => {
            const top = topOf(r.lane)
            const isH = hover === r.o.id
            return (
              <button key={r.o.id} onMouseEnter={() => setHover(r.o.id)} onMouseLeave={() => setHover(h => h === r.o.id ? null : h)} onClick={() => onOpen?.(r.o.id)} data-ro-ok
                className={`absolute rounded-full text-[8px] font-bold text-white shadow-sm flex items-center justify-center transition-transform ${isH ? 'scale-125 z-20' : 'z-10'}`}
                style={{ left: leftOf(r), top, width: DOT - 3, height: DOT - 3, background: r.wo?.color || '#999', outline: isH ? '2px solid #1A1D2E' : '1.5px solid #fff' }}
                title={`PO ${r.o.po_number}`} aria-label={`PO ${r.o.po_number}`}>
                {String(r.o.po_number || '').slice(-2)}
              </button>)
          })}
          {hov && (
            <div className="absolute z-30 bg-[#1A1D2E] text-white rounded-lg shadow-xl px-3 py-2 text-[11px] pointer-events-none" style={{ left: `min(${leftOf(hov)}, calc(100% - 230px))`, top: topOf(hov.lane) + 24, width: 220 }}>
              <p className="font-bold text-[12px]">PO {hov.o.po_number}</p>
              <p className="opacity-80">{hov.wo?.code}{hov.o.ship_due_date ? ' · ship ' + hov.o.ship_due_date : ''}</p>
              <p className="mt-1">Stage: <b>{TL[hov.st]}</b></p>
              <p className="opacity-80">{fmtN(hov.released)} of {fmtN(hov.ordered)} SRPs released · {fmtN(hov.claimed)} claimed</p>
              <p className="opacity-60 mt-1">Click to open</p>
            </div>)}
        </div>
        {runners.length === 0 && <p className="px-4 pb-4 text-sm text-gray-400">No open Walmart POs.</p>}
        <p className="px-4 pb-3 text-[10px] text-gray-400">Each dot is a PO (last 2 digits), colored by work order. It moves from released (production) to claimed (build team) to ready; POs with more SRPs through a stage stand at the front of the pack. Hover for detail, click to open, tap a work order to show only its POs.</p>
      </div>}
    </div>
  )
}
