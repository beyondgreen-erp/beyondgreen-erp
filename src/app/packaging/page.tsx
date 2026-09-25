'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { BUCKET, PRODUCT_TYPES, STATUSES, STATUS_COLORS, UNIT_PT, newDoc, type DesignRow } from '@/lib/packaging/doc'

const PRESETS: { label: string; w: number; h: number; unit: 'in' | 'mm' }[] = [
  { label: 'Letter 8.5 × 11 in', w: 8.5, h: 11, unit: 'in' },
  { label: 'Tabloid 11 × 17 in', w: 11, h: 17, unit: 'in' },
  { label: '12 × 12 in', w: 12, h: 12, unit: 'in' },
  { label: '24 × 18 in (carton sheet)', w: 24, h: 18, unit: 'in' },
  { label: 'A4 210 × 297 mm', w: 210, h: 297, unit: 'mm' },
  { label: 'A3 297 × 420 mm', w: 297, h: 420, unit: 'mm' },
]

export default function PackagingDesignsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [rows, setRows] = useState<DesignRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [counts, setCounts] = useState<Record<string, { open: number; links: number }>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('Active')
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    const { data } = await sb.from('packaging_designs').select('*').order('updated_at', { ascending: false })
    const list = (data || []) as DesignRow[]
    setRows(list); setLoading(false)
    const paths = list.filter(r => r.thumb_path).map(r => r.thumb_path!)
    if (paths.length) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600)
      const m: Record<string, string> = {}
      ;(signed || []).forEach((s: any) => { const r = list.find(x => x.thumb_path === s.path); if (r && s.signedUrl) m[r.id] = s.signedUrl + `&v=${encodeURIComponent(r.updated_at)}` })
      setThumbs(m)
    }
    const ids = list.map(r => r.id)
    if (ids.length) {
      const [{ data: cm }, { data: ln }] = await Promise.all([
        sb.from('packaging_comments').select('design_id').in('design_id', ids).is('parent_id', null).eq('status', 'open'),
        sb.from('packaging_share_links').select('design_id').in('design_id', ids).is('revoked_at', null),
      ])
      const c: Record<string, { open: number; links: number }> = {}
      ;(cm || []).forEach((x: any) => { (c[x.design_id] ||= { open: 0, links: 0 }).open++ })
      ;(ln || []).forEach((x: any) => { (c[x.design_id] ||= { open: 0, links: 0 }).links++ })
      setCounts(c)
    }
  }, [sb])
  useEffect(() => { load() }, [load])

  const filtered = rows.filter(r => {
    if (status === 'Active' && r.status === 'Archived') return false
    if (status !== 'Active' && status !== 'All' && r.status !== status) return false
    const s = q.trim().toLowerCase()
    return !s || [r.name, r.customer_name, r.sku, r.product_type].some(v => (v || '').toLowerCase().includes(s))
  })

  return (
    <div className="py-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Packaging Design</h1>
          <p className="text-sm text-gray-500">Upload dielines, edit artwork, export print-ready files and share proofs with printers.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="ml-auto px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: '#3B6FE0' }}>
          <i className="ti ti-plus" /> New design
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <i className="ti ti-search absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, customer, SKU…" className="pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg w-72 bg-white" />
        </div>
        {['Active', ...STATUSES, 'All'].map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${status === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>{s}</button>
        ))}
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : !filtered.length ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
          <i className="ti ti-box-model-2 text-4xl text-gray-300" />
          <p className="mt-2 text-gray-600 font-medium">{rows.length ? 'No designs match these filters.' : 'No packaging designs yet.'}</p>
          {!rows.length && <p className="text-sm text-gray-500">Create one and import a dieline (AI, PDF, EPS, PS or SVG) to get started.</p>}
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {filtered.map(r => (
            <Link key={r.id} href={`/packaging/${r.id}`} className="group bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-gray-300 transition">
              <div className="aspect-[4/3] bg-gray-100 grid place-items-center overflow-hidden">
                {thumbs[r.id] ? <img src={thumbs[r.id]} alt="" className="max-w-full max-h-full object-contain p-3 group-hover:scale-[1.02] transition" /> : <i className="ti ti-box-model-2 text-4xl text-gray-300" />}
              </div>
              <div className="p-3 space-y-1">
                <div className="flex items-start gap-2">
                  <p className="font-semibold text-gray-900 leading-tight flex-1 min-w-0 truncate">{r.name}</p>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[r.status] || ''}`}>{r.status}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{[r.customer_name, r.sku, r.product_type].filter(Boolean).join(' · ') || '—'}</p>
                <div className="flex items-center gap-3 text-[11px] text-gray-400 pt-1">
                  <span>{+(r.width_pt / UNIT_PT[r.unit]).toFixed(2)} × {+(r.height_pt / UNIT_PT[r.unit]).toFixed(2)} {r.unit}</span>
                  {counts[r.id]?.open ? <span className="text-amber-600"><i className="ti ti-message-circle" /> {counts[r.id].open}</span> : null}
                  {counts[r.id]?.links ? <span className="text-violet-600"><i className="ti ti-link" /> {counts[r.id].links}</span> : null}
                  <span className="ml-auto">{new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {showNew && <NewDesignModal onClose={() => setShowNew(false)} onCreated={id => router.push(`/packaging/${id}?import=1`)} />}
    </div>
  )
}

function NewDesignModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [customers, setCustomers] = useState<{ id: string; company_name: string }[]>([])
  const [f, setF] = useState({ name: '', customer_id: '', sku: '', product_type: PRODUCT_TYPES[0], w: '8.5', h: '11', unit: 'in' as 'in' | 'mm' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    sb.from('customers').select('id, company_name').order('company_name').limit(2000).then(({ data }) => setCustomers((data || []) as any))
  }, [sb])
  const create = async () => {
    if (!f.name.trim()) { setErr('Give the design a name'); return }
    const w = parseFloat(f.w), h = parseFloat(f.h)
    if (!(w > 0 && h > 0)) { setErr('Enter an artboard size'); return }
    setBusy(true); setErr('')
    const { data: { user } } = await sb.auth.getUser()
    const cust = customers.find(c => c.id === f.customer_id)
    const wPt = w * UNIT_PT[f.unit], hPt = h * UNIT_PT[f.unit]
    const { data, error } = await sb.from('packaging_designs').insert({
      name: f.name.trim(), customer_id: cust?.id || null, customer_name: cust?.company_name || null, sku: f.sku.trim() || null,
      product_type: f.product_type, width_pt: wPt, height_pt: hPt, unit: f.unit, created_by: user?.email, updated_by: user?.email,
    }).select().single()
    if (error || !data) { setErr(error?.message || 'Could not create'); setBusy(false); return }
    const doc = newDoc(wPt, hPt, f.unit)
    const path = `designs/${data.id}/current.json`
    const up = await sb.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(doc)], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '0' })
    if (up.error) { setErr(up.error.message); setBusy(false); return }
    await sb.from('packaging_designs').update({ doc_path: path }).eq('id', data.id)
    onCreated(data.id)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center"><h2 className="text-lg font-bold">New packaging design</h2><button onClick={onClose} className="ml-auto text-gray-400 hover:text-black"><i className="ti ti-x" /></button></div>
        <label className="block text-sm"><span className="text-gray-600">Design name *</span>
          <input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. 6in Fork Retail Carton — v1" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm"><span className="text-gray-600">Customer</span>
            <select value={f.customer_id} onChange={e => setF({ ...f, customer_id: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2">
              <option value="">— beyondGREEN / none —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </label>
          <label className="block text-sm"><span className="text-gray-600">SKU / item #</span>
            <input value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
          </label>
        </div>
        <label className="block text-sm"><span className="text-gray-600">Packaging type</span>
          <select value={f.product_type} onChange={e => setF({ ...f, product_type: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2">
            {PRODUCT_TYPES.map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
        <div>
          <span className="text-sm text-gray-600">Artboard size <span className="text-gray-400">(auto-resizes to your dieline on import)</span></span>
          <div className="mt-1 flex gap-2">
            <input value={f.w} onChange={e => setF({ ...f, w: e.target.value })} className="w-24 border border-gray-300 rounded-lg px-3 py-2" />
            <span className="self-center text-gray-400">×</span>
            <input value={f.h} onChange={e => setF({ ...f, h: e.target.value })} className="w-24 border border-gray-300 rounded-lg px-3 py-2" />
            <select value={f.unit} onChange={e => setF({ ...f, unit: e.target.value as any })} className="border border-gray-300 rounded-lg px-2"><option value="in">in</option><option value="mm">mm</option></select>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map(p => <button key={p.label} onClick={() => setF({ ...f, w: String(p.w), h: String(p.h), unit: p.unit })} className="text-[11px] px-2 py-1 rounded-full border border-gray-200 hover:border-gray-400 text-gray-600">{p.label}</button>)}
          </div>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button disabled={busy} onClick={create} className="px-4 py-2 rounded-lg text-sm text-white font-semibold disabled:opacity-60" style={{ background: '#3B6FE0' }}>{busy ? 'Creating…' : 'Create & open editor'}</button>
        </div>
      </div>
    </div>
  )
}
