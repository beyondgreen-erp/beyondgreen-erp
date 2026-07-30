'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Zone { id: string; code: string; area: string; area_label: string; color: string; x: number; y: number; w: number; h: number; is_staging: boolean }

const OUTLINES: { x: number; y: number; w: number; h: number; dash?: boolean }[] = [
  { x: 74, y: 70, w: 180, h: 360 },
  { x: 70, y: 450, w: 672, h: 392 },
  { x: 452, y: 878, w: 296, h: 592, dash: true },
]
const HEADINGS: [string, number, number][] = [
  ['UPSTAIRS', 164, 64], ['STAGING (override)', 389, 70], ['ADMIN OFFICE', 625, 108], ['FIRST FLOOR · 1202 E Wakeham Ave', 430, 464],
  ['PARKING LOT', 360, 868], ['TENT 1', 600, 886], ['CONTAINERS', 600, 1020], ['TENT 2', 316, 1114],
]

export default function ZonePicker({ productId, productName, currentUserEmail, onClose, onCancel, onChange, stepLabel, capturePhoto, photoRequired, onPhoto }: {
  productId: string; productName?: string; currentUserEmail?: string; onClose: () => void; onCancel?: () => void; onChange?: (count: number) => void; stepLabel?: string
  capturePhoto?: boolean; photoRequired?: boolean; onPhoto?: (url: string) => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [zones, setZones] = useState<Zone[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [upBusy, setUpBusy] = useState(false)

  useEffect(() => { (async () => {
    const [{ data: z }, { data: pz }] = await Promise.all([
      sb.from('storage_zones').select('*').eq('active', true).order('sort'),
      sb.from('product_zones').select('zone_id').eq('product_id', productId),
    ])
    setZones((z as Zone[]) || [])
    setSel(new Set(((pz as any[]) || []).map(r => r.zone_id)))
    setLoading(false)
  })() }, [sb, productId])

  async function toggle(z: Zone) {
    if (busy) return
    setBusy(true)
    const has = sel.has(z.id)
    setSel(prev => { const n = new Set(prev); if (has) n.delete(z.id); else n.add(z.id); onChange?.(n.size); return n })
    try {
      if (has) await sb.from('product_zones').delete().eq('product_id', productId).eq('zone_id', z.id)
      else await sb.from('product_zones').insert({ product_id: productId, zone_id: z.id, created_by: currentUserEmail || null })
    } catch {
      setSel(prev => { const n = new Set(prev); if (has) n.add(z.id); else n.delete(z.id); onChange?.(n.size); return n })
    } finally { setBusy(false) }
  }

  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setUpBusy(true)
    try {
      const path = `receiving/${productId}/${Date.now()}.jpg`
      const { error } = await sb.storage.from('erp-images').upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })
      if (error) throw error
      const { data } = sb.storage.from('erp-images').getPublicUrl(path)
      setPhotos(p => [...p, data.publicUrl]); onPhoto?.(data.publicUrl)
    } catch (err: any) { alert('Photo upload failed: ' + (err?.message || err)) }
    finally { setUpBusy(false); e.target.value = '' }
  }

  const areas = Array.from(new Map(zones.map(z => [z.area, { label: z.area_label, color: z.color }])).entries())
  const selected = zones.filter(z => sel.has(z.id))
  const doneBlocked = (photoRequired && photos.length === 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-3" style={{ background: 'rgba(15,20,36,0.6)' }} onClick={onCancel || onClose}>
      <div className="relative w-full max-w-[560px] my-4 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 flex items-center justify-between gap-2 sticky top-0 z-10" style={{ background: '#0F1424', color: '#fff' }}>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">📍 Storage zone{productName ? ` · ${productName}` : ''}</p>
            <p className="text-[11px]" style={{ color: '#8A9FC0' }}>{stepLabel || 'Tap zones where this item is stored — pick as many as needed.'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onCancel && (
              <button onClick={onCancel} className="text-sm font-semibold px-3 py-2 rounded-lg" style={{ background: '#1A2035', color: '#8A9FC0', border: '1px solid #2A3350' }}>Cancel</button>
            )}
            <button onClick={onClose} disabled={doneBlocked} className="text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40" style={{ background: '#059669', color: '#fff' }}>Done</button>
          </div>
        </div>

        <div className="px-3 py-2 flex flex-wrap gap-2 text-[10px]" style={{ borderBottom: '1px solid #EEF0F4' }}>
          {areas.map(([k, a]) => (
            <span key={k} className="inline-flex items-center gap-1"><span style={{ width: 10, height: 10, borderRadius: 2, background: a.color, display: 'inline-block' }} />{a.label}</span>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading map…</div>
        ) : (
          <div style={{ maxHeight: '48vh', overflowY: 'auto', background: '#F7F8FA' }}>
            <svg viewBox="0 0 820 1500" preserveAspectRatio="xMidYMin meet" style={{ width: '100%', height: 'auto', display: 'block' }}>
              {OUTLINES.map((o, i) => (
                <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} rx={6} fill="none" stroke={o.dash ? '#E4E6EE' : '#2A3350'} strokeWidth={o.dash ? 1 : 1.5} strokeDasharray={o.dash ? '5 5' : undefined} />
              ))}
              {HEADINGS.map(([t, x, y], i) => (
                <text key={i} x={x} y={y} textAnchor="middle" fontSize={t.length > 18 ? 9 : 11} fontWeight={700} fill="#4D6080">{t}</text>
              ))}
              {zones.map(z => {
                const on = sel.has(z.id)
                return (
                  <g key={z.id} style={{ cursor: 'pointer' }} onClick={() => toggle(z)}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={5} fill={z.color} fillOpacity={on ? 0.92 : 0.18} stroke={z.color} strokeWidth={on ? 2.5 : 1} />
                    <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 4} textAnchor="middle" fontSize={z.w < 66 ? 8.5 : 11} fontWeight={700} fill={on ? '#fff' : z.color}>{z.code}</text>
                  </g>
                )
              })}
            </svg>
          </div>
        )}

        {capturePhoto && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid #EEF0F4', background: photos.length ? '#ECFDF5' : '#FFF7ED' }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold" style={{ color: photos.length ? '#047857' : '#B45309' }}>
                📷 Photo of item received {photoRequired && photos.length === 0 && <span style={{ color: '#DC2626' }}>· required</span>}
              </p>
              <label className="text-xs font-bold px-3 py-2 rounded-lg cursor-pointer" style={{ background: '#3B6FE0', color: '#fff' }}>
                {upBusy ? 'Uploading…' : photos.length ? 'Add another' : 'Take photo'}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapture} />
              </label>
            </div>
            {photos.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {photos.map((u, i) => (<img key={i} src={u} alt="" className="w-14 h-14 object-cover rounded-lg border" style={{ borderColor: '#D1FAE5' }} />))}
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-3" style={{ borderTop: '1px solid #EEF0F4' }}>
          {selected.length === 0 ? (
            <p className="text-xs font-bold" style={{ color: '#3B6FE0' }}>◆ No zone assigned yet — this item will flash blue until you pick one.</p>
          ) : (
            <p className="text-xs" style={{ color: '#374151' }}><b>Assigned ({selected.length}):</b> {selected.map(z => z.code).join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
