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
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded ml-1 text-white" style={{ background: s.color }}>{s.label}</span></p>
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
  const doc = new jsPDF({ unit: 'in', format: 'letter' })
  const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  pallets.forEach((p, idx) => {
    if (idx) doc.addPage()
    const its = items.filter(i => i.pallet_id === p.id).sort((a, b) => a.seq - b.seq)
    doc.setFillColor(18, 122, 74); doc.rect(0.45, 0.4, 7.6, 0.5, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
    doc.text(`PALLET BUILD SHEET  ·  PO ${po.po_number || ''}  ·  Pallet ${p.pallet_no} of ${pallets.length}`, 0.6, 0.73)
    doc.setTextColor(0, 0, 0); doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text(`${p.kind === 'full' ? 'FULL pallet' : 'FLOOR pallet (mixed)'}  ·  ${fmtN(p.srps)} SRPs  ·  ${fmtN(num(p.height_in) + 6, 1)}" tall  ·  ${fmtN(p.cube_ft, 1)} cu ft cube  ·  ${fmtN(p.weight_lb)} lb${po.ship_due_date ? '  ·  Ship ' + po.ship_due_date : ''}`, 0.5, 1.15)
    // side view
    const sx = 0.6, base = 6.2, s = 0.085
    doc.setFillColor(139, 106, 62); doc.rect(sx, base, PW * s, 6 * s, 'F')
    let y0 = 0
    its.forEach(it => {
      const layers = num(it.full_layers) + (num(it.partial) > 0 ? 1 : 0)
      for (let k = 0; k < layers; k++) {
        const partial = k === layers - 1 && num(it.partial) > 0
        const w = partial ? Math.max(0.5, PW * num(it.partial) / (num(it.per_layer) || 1)) : PW
        const lh = num(it.layer_h || 4)
        doc.setFillColor(...hex(skuColor(it.sku))); doc.setDrawColor(255, 255, 255)
        doc.rect(sx, base - (y0 + (k + 1) * lh) * s, w * s, lh * s, 'FD')
      }
      const h = layers * num(it.layer_h || 4)
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.text(skuShort(it.sku), sx + PW * s / 2, base - (y0 + h / 2) * s + 0.04, { align: 'center' })
      y0 += h
    })
    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text('SIDE VIEW (48" face)', sx, base + 0.75)
    // per block: top view + instructions
    let ty = 1.45
    its.forEach((it, i) => {
      const g = layerGrid(num(it.ti) || 1, num(it.hi) || 1, dims[it.sku])
      const ts = 0.045, tx = 5.0
      const drawLayer = (yy: number, filled?: number) => {
        doc.setFillColor(243, 231, 211); doc.rect(tx, yy, PW * ts, PD * ts, 'F')
        const ox = (PW - g.cols * g.cw) / 2, oy = (PD - g.rows * g.ch) / 2
        for (let c = 0; c < g.cols * g.rows; c++) {
          const on = filled == null || c < filled
          doc.setFillColor(...(on ? hex(skuColor(it.sku)) : [255, 255, 255] as [number, number, number])); doc.setDrawColor(40, 40, 40)
          doc.rect(tx + (ox + (c % g.cols) * g.cw) * ts, yy + (oy + Math.floor(c / g.cols) * g.ch) * ts, g.cw * ts, g.ch * ts, 'FD')
        }
      }
      if (ty > 9.2) { doc.addPage(); ty = 0.6 }
      drawLayer(ty)
      if (num(it.partial) > 0) drawLayer(ty + PD * ts + 0.1, num(it.partial))
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text(`${i + 1}. ${skuShort(it.sku)} (${it.sku})`, 3.0, ty + 0.15)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      const lines = [`${fmtN(it.srps)} SRPs`, it.per_layer ? `${num(it.ti)} x ${num(it.hi)} = ${num(it.per_layer)} per layer` : '',
        num(it.full_layers) ? `${num(it.full_layers)} full layer(s)` : '', num(it.partial) ? `+ ${num(it.partial)} on top layer (shaded)` : '']
      lines.filter(Boolean).forEach((t, k) => doc.text(t, 3.0, ty + 0.35 + k * 0.17))
      ty += (num(it.partial) > 0 ? 2 : 1) * (PD * ts + 0.1) + 0.25
    })
    doc.setFontSize(8); doc.setTextColor(100, 100, 100)
    doc.text('Build bottom to top in the order shown. One PO per pallet. Do not double stack. Wrap, label two sides, photo, then press Confirm built.', 0.5, 10.5)
    doc.text('Staged ____  Released ____  Claimed ____  Wrapped ____  Built ____', 0.5, 10.7)
    doc.setTextColor(0, 0, 0)
  })
  return doc
}

// ── order detail panel ────────────────────────────────────────────────────────
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
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0f7a4a] mr-auto">🏗 Pallet plan &amp; build</p>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#CFE6D8]">{fmtN(cube, 1)} cu ft cube</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#CFE6D8]">{pallets.length} pallets ({full} full · {pallets.length - full} floor)</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#CFE6D8]">{fmtN(wt)} lb</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: built === pallets.length && pallets.length ? '#00c875' : '#579bfc' }}>{built}/{pallets.length} built</span>
        {pallets.length > 0 && <button onClick={() => buildSheetPdf(order, pallets, items, dims).save(`Pallet-Build-${po || 'PO'}.pdf`)} className="text-xs px-2.5 py-1 rounded-lg bg-white border border-[#CFE6D8] text-[#0f7a4a] font-semibold" data-ro-ok>🖨 Build sheets</button>}
        {canEdit && <button onClick={replan} className="text-xs px-2.5 py-1 rounded-lg bg-white border border-[#E4E6EE] text-gray-600" title="Re-plan from the order lines">↻ Re-plan</button>}
      </div>
      {order.plan_stale && <p className="text-[12px] rounded-lg bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 mb-2">⚠ The order lines changed after pallets were started, so this plan no longer matches the PO. Step the started pallets back (↩) and press Re-plan.</p>}
      {msg && <p className={`text-[12px] rounded-lg px-3 py-2 mb-2 ${msg.startsWith('⚠') ? 'bg-amber-50 border border-amber-300 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>{msg}</p>}
      {pallets.length === 0 ? <p className="text-sm text-gray-500">No pallets yet — add the SKU lines and the plan builds itself.</p> : (
        <div className="space-y-1.5">
          {pallets.map(p => <PalletRow key={p.id} p={p} items={items.filter(i => i.pallet_id === p.id)} dims={dims} po={po} canEdit={canEdit} busy={busy === p.id}
            onStep={(pp, s, ph) => step(pp, s, po, ph)} onUndo={pp => undo(pp, po)} />)}
        </div>)}
      <p className="text-[10px] text-gray-500 mt-2">Full pallet = the SKU&apos;s pallet arrangement (S24 312 · F24 260 · A24 234 · A48 165 · K48 260 · S48 120 · F48 120). Anything less is floor and goes on a mixed pallet for this PO. Cube is in cubic feet (the figure Walmart asks for): 48×40 CHEP pallet, 6&quot; base, 65 lb, to the top of the load.</p>
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
// One race track. Each open PO is a runner placed at its stage; it moves along the
// segment as more of its pallets clear that stage. Colors = work order.
const TL = ['PO in', 'Planned', 'Staged', 'Released', 'Claimed', 'Wrap & label', 'Built', 'Ready to ship'] as const
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
  const { pallets } = usePalletData(sb, ids)

  const wos = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) { const l = links.find(x => x.walmart_order_id === o.id); m.set(l?.work_order_id || 'none', l?.work_orders?.wo_code || 'No work order') }
    return Array.from(m.entries()).sort((a, b) => (a[0] === 'none' ? 1 : 0) - (b[0] === 'none' ? 1 : 0) || a[1].localeCompare(b[1])).map(([id, code], i) => ({ id, code, color: id === 'none' ? '#9699a6' : WO_COLORS[i % WO_COLORS.length] }))
  }, [orders, links])

  // runner position: stage = slowest pallet; progress inside the segment = share of pallets already past it
  const runners = useMemo(() => {
    const out = orders.map(o => {
      const ps = pallets.filter(p => p.order_id === o.id)
      const built = ps.filter(p => p.status === 'built').length
      let st = 0, frac = 0
      if (['Ready for Shipment', 'Prepped & Ready for Dispatch'].includes(o.group_name)) st = 7
      else if (ps.length) {
        const idx = ps.map(p => 1 + stepIdx(p.status))
        st = Math.min(...idx)
        frac = idx.filter(x => x > st).length / ps.length
      }
      const l = links.find(x => x.walmart_order_id === o.id)
      const wo = wos.find(w => w.id === (l?.work_order_id || 'none'))
      const counts = STEPS.map(s => ps.filter(p => p.status === s.key).length)
      return { o, st, frac, built, total: ps.length, wo, counts, x: st >= 7 ? 100 : ((st + frac * 0.85) / 7) * 100 }
    }).filter(r => !woFilter || r.wo?.id === woFilter)
    // runners waiting at the same stage line up behind each other in a small pack (furthest along in front)
    const out2: any[] = []
    for (let st = 0; st < TL.length; st++) {
      const here = out.filter(r => r.st === st).sort((a, b) => b.frac - a.frac || String(a.o.ship_due_date || '9999').localeCompare(String(b.o.ship_due_date || '9999')))
      here.forEach((r, k) => out2.push({ ...r, col: k % PER_ROW, lane: Math.floor(k / PER_ROW) }))
    }
    return out2
  }, [orders, pallets, links, wos, woFilter])
  const lanes = Math.max(1, ...runners.map((r: any) => r.lane + 1))
  const above = Math.ceil(lanes / 2)
  const ROW = 24, TRACK = 10
  const topOf = (lane: number) => lane % 2 === 0 ? (above - 1 - lane / 2) * ROW : above * ROW + TRACK + 8 + ((lane - 1) / 2) * ROW
  const leftOf = (r: any) => r.st >= TL.length - 1 ? `calc(100% - ${r.col * DOT + DOT + 2}px)` : `calc(${(r.st / 7) * 100}% + ${r.col * DOT + 8}px)`
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
            const x = (i / 7) * 100
            return (
              <div key={t} className="absolute" style={{ left: `${x}%`, top: 0, bottom: 0 }}>
                <div className="absolute w-px bg-[#E4E6EE]" style={{ top: 0, bottom: 22, left: 0 }} />
                <div className="absolute w-3 h-3 rounded-full bg-white border-2 border-[#9aa3b5]" style={{ top: above * ROW + 4 + TRACK / 2 - 6, left: -6 }} />
                <div className="absolute whitespace-nowrap text-[10px] font-bold uppercase tracking-wide text-gray-500" style={{ bottom: 0, left: 0, transform: i === 0 ? 'none' : i === 7 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
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
              <p className="mt-1">Stage: <b>{TL[hov.st]}</b> · {hov.built}/{hov.total} pallets built</p>
              {hov.total > 0 && <p className="opacity-80">{STEPS.map((s, i) => hov.counts[i] ? `${hov.counts[i]} ${s.label.toLowerCase()}` : '').filter(Boolean).join(' · ')}</p>}
              <p className="opacity-60 mt-1">Click to open</p>
            </div>)}
        </div>
        {runners.length === 0 && <p className="px-4 pb-4 text-sm text-gray-400">No open Walmart POs.</p>}
        <p className="px-4 pb-3 text-[10px] text-gray-400">Each dot is a PO (last 2 digits), colored by work order. It sits at the stage of its slowest pallet; POs further along stand at the front of the pack. Hover for detail, click to open, tap a work order to show only its POs.</p>
      </div>}
    </div>
  )
}
