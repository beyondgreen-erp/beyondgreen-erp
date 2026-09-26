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
  const [showNew, setShowNew] = useState<false | 'blank' | 'file'>(false)

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

  const deleteDesign = async (r: DesignRow) => {
    if (!window.confirm(`Delete "${r.name}" permanently?\n\nThis removes the artwork, versions, final files, comments and printer links. It cannot be undone.`)) return
    // collect every stored file under designs/{id}/ (artwork, assets, versions, final files)
    const paths: string[] = []
    const walk = async (dir: string) => {
      const { data } = await sb.storage.from(BUCKET).list(dir, { limit: 1000 })
      for (const f of data || []) {
        const full = `${dir}/${f.name}`
        if (f.id) paths.push(full); else await walk(full)
      }
    }
    await walk(`designs/${r.id}`)
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100))
    const { error } = await sb.from('packaging_designs').delete().eq('id', r.id)
    if (error) { window.alert('Could not delete: ' + error.message); return }
    setRows(rs => rs.filter(x => x.id !== r.id))
  }

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
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowNew('file')} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50">
            <i className="ti ti-file-upload" /> Open AI / PDF file
          </button>
          <button onClick={() => setShowNew('blank')} className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: '#3B6FE0' }}>
            <i className="ti ti-plus" /> New design
          </button>
        </div>
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
                  <button title="Delete design" onClick={e => { e.preventDefault(); e.stopPropagation(); deleteDesign(r) }}
                    className="text-gray-300 hover:text-red-600 -mr-1 px-1"><i className="ti ti-trash" /></button>
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
      {showNew && <NewDesignModal startWithFile={showNew === 'file'} onClose={() => setShowNew(false)} onCreated={id => router.push(`/packaging/${id}?import=1`)} />}
    </div>
  )
}

function NewDesignModal({ onClose, onCreated, startWithFile }: { onClose: () => void; onCreated: (id: string) => void; startWithFile?: boolean }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [cust, setCust] = useState<any | null>(null)
  const [prod, setProd] = useState<any | null>(null)
  const [f, setF] = useState({ name: '', sku: '', product_type: PRODUCT_TYPES[0], w: '8.5', h: '11', unit: 'in' as 'in' | 'mm' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [textMode, setTextMode] = useState<'live' | 'outline'>('live')
  const pickFile = (f: File | null) => {
    setFile(f)
    if (f && !f.name.match(/\.(ai|pdf|eps|ps|svg)$/i)) { setErr('Choose an .ai, .pdf, .eps, .ps or .svg file'); setFile(null); return }
    setErr('')
    if (f && !f.name) return
    if (f) setF(prev => ({ ...prev, name: prev.name || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }))
  }
  const create = async () => {
    if (startWithFile && !file) { setErr('Choose the file to open'); return }
    if (!f.name.trim()) { setErr('Give the design a name'); return }
    const w = parseFloat(f.w), h = parseFloat(f.h)
    if (!(w > 0 && h > 0)) { setErr('Enter an artboard size'); return }
    setBusy(true); setErr('')
    const { data: { user } } = await sb.auth.getUser()
    const wPt = w * UNIT_PT[f.unit], hPt = h * UNIT_PT[f.unit]
    const { data, error } = await sb.from('packaging_designs').insert({
      name: f.name.trim(), customer_id: cust?.id || null, customer_name: cust?.company_name || null, sku: prod?.sku || f.sku.trim() || null, product_id: prod?.id || null,
      product_type: f.product_type, width_pt: wPt, height_pt: hPt, unit: f.unit, created_by: user?.email, updated_by: user?.email,
    }).select().single()
    if (error || !data) { setErr(error?.message || 'Could not create'); setBusy(false); return }
    const doc = newDoc(wPt, hPt, f.unit)
    const path = `designs/${data.id}/current.json`
    const up = await sb.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(doc)], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '0' })
    if (up.error) { setErr(up.error.message); setBusy(false); return }
    await sb.from('packaging_designs').update({ doc_path: path }).eq('id', data.id)
    // hand the file to the editor, which opens it as editable artwork and sizes the artboard to it
    if (file) (window as any).__pkgPendingImport = { designId: data.id, file, text: textMode }
    onCreated(data.id)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center"><h2 className="text-lg font-bold">{startWithFile ? 'Open an existing file' : 'New packaging design'}</h2><button onClick={onClose} className="ml-auto text-gray-400 hover:text-black"><i className="ti ti-x" /></button></div>
        {startWithFile && (
          <div className="space-y-2">
            <label className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-xl p-5 cursor-pointer text-center ${file ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-gray-400'}`}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] || null) }}>
              <i className={`ti ${file ? 'ti-file-check text-emerald-600' : 'ti-file-upload text-gray-400'} text-3xl`} />
              <span className="text-sm font-medium text-gray-700">{file ? file.name : 'Drop an .ai file here or click to choose'}</span>
              <span className="text-xs text-gray-500">{file ? `${(file.size / 1e6).toFixed(1)} MB — opens as editable artwork` : 'Also accepts PDF, EPS, PS and SVG'}</span>
              <input type="file" accept=".ai,.pdf,.eps,.ps,.svg" className="hidden" onChange={e => pickFile(e.target.files?.[0] || null)} />
            </label>
            <div className="flex gap-4 text-xs text-gray-600">
              <label className="flex items-center gap-1.5"><input type="radio" checked={textMode === 'live'} onChange={() => setTextMode('live')} /> Keep text editable</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={textMode === 'outline'} onChange={() => setTextMode('outline')} /> Convert text to outlines (exact look)</label>
            </div>
          </div>
        )}
        <label className="block text-sm"><span className="text-gray-600">Design name *</span>
          <input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. 6in Fork Retail Carton — v1" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <ErpPicker sb={sb} kind="customer" label="Customer / Lead" value={cust} onPick={setCust} />
          <ErpPicker sb={sb} kind="product" label="SKU / product" value={prod} onPick={r => { setProd(r); if (r) setF(p => ({ ...p, sku: r.sku })) }} freeText={f.sku} onFreeText={v => { setProd(null); setF(p => ({ ...p, sku: v })) }} />
        </div>
        <label className="block text-sm"><span className="text-gray-600">Packaging type</span>
          <select value={f.product_type} onChange={e => setF({ ...f, product_type: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2">
            {PRODUCT_TYPES.map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
        {!startWithFile && <div>
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
        </div>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button disabled={busy} onClick={create} className="px-4 py-2 rounded-lg text-sm text-white font-semibold disabled:opacity-60" style={{ background: '#3B6FE0' }}>{busy ? 'Creating…' : startWithFile ? 'Open in editor' : 'Create & open editor'}</button>
        </div>
      </div>
    </div>
  )
}

/** Search-as-you-type picker for ERP customers / leads and products (15k+ rows, so never preloaded). */
function ErpPicker({ sb, kind, label, value, onPick, freeText, onFreeText }: {
  sb: any; kind: 'customer' | 'product'; label: string; value: any | null; onPick: (r: any | null) => void; freeText?: string; onFreeText?: (v: string) => void
}) {
  const [q, setQ] = useState(''), [rows, setRows] = useState<any[]>([]), [open, setOpen] = useState(false)
  useEffect(() => {
    const s = q.trim(); if (s.length < 2) { setRows([]); return }
    const t = setTimeout(async () => {
      const like = `%${s.replace(/[%,()]/g, ' ')}%`
      const { data } = kind === 'customer'
        ? await sb.from('customers').select('id, company_name, contact_name, customer_status, city, state').or(`company_name.ilike.${like},contact_name.ilike.${like}`).not('is_merged', 'is', true).order('company_name').limit(12)
        : await sb.from('products').select('id, sku, product_name, product_size').or(`sku.ilike.${like},product_name.ilike.${like}`).order('sku').limit(12)
      setRows(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [sb, kind, q])
  const shown = value ? (kind === 'customer' ? value.company_name : `${value.sku} — ${value.product_name || ''}`) : null
  return (
    <div className="block text-sm relative"><span className="text-gray-600">{label}</span>
      {shown ? (
        <div className="mt-1 flex items-center gap-1 border border-emerald-300 bg-emerald-50 rounded-lg px-2 py-2 text-sm">
          <span className="truncate flex-1">{shown}</span>
          {kind === 'customer' && value.customer_status && <span className="text-[10px] px-1.5 rounded bg-white text-gray-600">{value.customer_status}</span>}
          <button type="button" onClick={() => onPick(null)} className="text-gray-400 hover:text-red-500"><i className="ti ti-x" /></button>
        </div>
      ) : (
        <input value={kind === 'product' && onFreeText ? (q || freeText || '') : q} onChange={e => { setQ(e.target.value); setOpen(true); onFreeText?.(e.target.value) }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={kind === 'customer' ? 'Search customers & leads…' : 'Search SKU / product…'} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
      )}
      {open && !value && rows.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {rows.map(r => (
            <button type="button" key={r.id} onMouseDown={() => { onPick(r); setQ(''); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs">
              {kind === 'customer'
                ? <><span className="font-medium">{r.company_name}</span> <span className="text-gray-400">{[r.customer_status, r.city].filter(Boolean).join(' · ')}</span></>
                : <><span className="font-mono font-medium">{r.sku}</span> <span className="text-gray-500">{r.product_name}</span></>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
