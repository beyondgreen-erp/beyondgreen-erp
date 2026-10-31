'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import PortalShell, { api, usePortal, GREEN, INK, cardCls, inputCls, labelCls, btnCls, btnGhostCls, fmtDate, Pill, Empty, FileDrop } from '@/components/portal/PortalShell'

const TYPES = ['Private label (your brand on our products)', 'Custom product or new mold', 'Custom printing (cups, bags, wrappers, kits)', 'Contract injection molding', 'Film extrusion and bag conversion', 'Kitting, wrapping and packing', 'Stock products, high volume', 'Other']
const CERTS = ['BPI commercial compost', 'Home compostable', 'USDA BioPreferred', 'Food contact (FDA)', 'PFAS-free statement', 'Made in USA', 'State labeling (CA, WA, CO)', 'Not sure yet']

function NewProject({ onDone, onCancel }: { onDone: (n: string, wantCall: boolean, id: string) => void; onCancel: () => void }) {
  const { customer } = usePortal()
  const [f, setF] = useState<any>({ name: '', type: '', description: '', first_qty: '', annual_qty: '', target_price: '', target_date: '', certifications: [] as string[], packaging: '', ship_to: customer?.shipping_address || '', want_call: true })
  const [products, setProducts] = useState<any[]>([{ description: '', quantity: '', unit: 'pcs' }])
  const [files, setFiles] = useState<{ path: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))
  const toggleCert = (c: string) => set('certifications', f.certifications.includes(c) ? f.certifications.filter((x: string) => x !== c) : [...f.certifications, c])

  async function submit() {
    setErr('')
    if (!f.name.trim()) { setErr('Give your project a name.'); return }
    if (f.description.trim().length < 10) { setErr('Tell us a little about the project.'); return }
    setBusy(true)
    try {
      const { ok, data } = await api('project-create', { ...f, products: products.filter(p => p.description.trim()).map(p => ({ ...p, quantity: Number(String(p.quantity).replace(/[^0-9.]/g, '')) || 0 })), files })
      if (!ok) { setErr(data.error || 'Could not submit.'); return }
      onDone(data.number, f.want_call, data.id)
    } finally { setBusy(false) }
  }

  return (
    <div className={`${cardCls} p-4 sm:p-5 space-y-5`}>
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold" style={{ color: INK }}>Start a project</h2><button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">Close</button></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2"><span className={labelCls}>Project name *</span><input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Branded cutlery kits for 40 stores" /></label>
        <label className="block sm:col-span-2"><span className={labelCls}>What kind of project?</span><select className={inputCls} value={f.type} onChange={e => set('type', e.target.value)}><option value="">Choose one</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className={labelCls}>Describe what you need *</span><textarea rows={5} className={inputCls} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Products, sizes, colors, how it is used today, what you want to change, anything we should know." /></label>
      </div>

      <section>
        <p className={labelCls}>Items and quantities (optional)</p>
        <div className="space-y-2">
          {products.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input className={inputCls} placeholder="Item (e.g. 6.5 in fork, black, wrapped)" value={p.description} onChange={e => setProducts(ps => ps.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <input className={`${inputCls} !w-28`} inputMode="numeric" placeholder="Qty" value={p.quantity} onChange={e => setProducts(ps => ps.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
              <select className={`${inputCls} !w-24`} value={p.unit} onChange={e => setProducts(ps => ps.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}><option>pcs</option><option>cases</option><option>packs</option><option>rolls</option><option>lbs</option></select>
              {products.length > 1 && <button onClick={() => setProducts(ps => ps.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 px-1">×</button>}
            </div>
          ))}
          <button onClick={() => setProducts(ps => [...ps, { description: '', quantity: '', unit: 'pcs' }])} className="text-xs font-semibold" style={{ color: GREEN }}>+ Add item</button>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block"><span className={labelCls}>First order quantity</span><input className={inputCls} value={f.first_qty} onChange={e => set('first_qty', e.target.value)} placeholder="e.g. 500,000 pcs" /></label>
        <label className="block"><span className={labelCls}>Annual volume</span><input className={inputCls} value={f.annual_qty} onChange={e => set('annual_qty', e.target.value)} placeholder="e.g. 6 million pcs" /></label>
        <label className="block"><span className={labelCls}>Target price (optional)</span><input className={inputCls} value={f.target_price} onChange={e => set('target_price', e.target.value)} placeholder="e.g. $0.025 per piece" /></label>
        <label className="block"><span className={labelCls}>Target launch date</span><input type="date" className={inputCls} value={f.target_date} onChange={e => set('target_date', e.target.value)} /></label>
      </div>

      <section>
        <p className={labelCls}>Certifications you need</p>
        <div className="flex flex-wrap gap-2">{CERTS.map(c => { const on = f.certifications.includes(c); return <button key={c} type="button" onClick={() => toggleCert(c)} className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${on ? 'text-white border-transparent' : 'text-gray-600 border-[#E4E6EE] bg-white'}`} style={on ? { background: GREEN } : {}}>{c}</button> })}</div>
      </section>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2"><span className={labelCls}>Packaging and printing</span><textarea rows={2} className={inputCls} value={f.packaging} onChange={e => set('packaging', e.target.value)} placeholder="Case pack, retail packaging, logo or print colors, labels, UPCs…" /></label>
        <label className="block sm:col-span-2"><span className={labelCls}>Ship to</span><textarea rows={2} className={inputCls} value={f.ship_to} onChange={e => set('ship_to', e.target.value)} /></label>
      </div>

      <section>
        <p className={labelCls}>Files (artwork, drawings, specs, photos of samples)</p>
        <FileDrop kind="project" onUploaded={fl => setFiles(fs => [...fs, fl])} />
        {files.length > 0 && <ul className="mt-2 text-sm space-y-1">{files.map((fl, i) => <li key={fl.path}>📎 {fl.name} <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} className="ml-1 text-xs text-gray-400 hover:text-red-500">remove</button></li>)}</ul>}
      </section>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.want_call} onChange={e => set('want_call', e.target.checked)} className="w-4 h-4 accent-[#037f4c]" /> Book a kickoff call with our team after submitting</label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className={btnGhostCls}>Cancel</button>
        <button onClick={submit} disabled={busy} className={btnCls} style={{ background: GREEN }}>{busy ? 'Submitting…' : 'Submit project'}</button>
      </div>
    </div>
  )
}

function ProjectsBody() {
  const [list, setList] = useState<any[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')
  const load = useCallback(async () => { const { data } = await api('projects'); setList(data.projects || []) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (new URLSearchParams(window.location.search).get('new') === '1') setCreating(true) }, [])

  return (
    <div className="space-y-4">
      {toast && <div className="rounded-xl bg-[#E4F7EE] border border-[#BFE6D0] text-[#0F5132] px-4 py-3 text-sm">{toast}</div>}
      {creating
        ? <NewProject onCancel={() => setCreating(false)} onDone={(n, wantCall, id) => { setCreating(false); if (wantCall) { window.location.href = `/portal/book?project=${id}&topic=${encodeURIComponent('Project kickoff ' + n)}` } else { setToast(`Project ${n} received. Our team will follow up shortly.`); load() } }} />
        : <div className="flex justify-end -mt-2"><button onClick={() => setCreating(true)} className={btnCls} style={{ background: GREEN }}>+ Start a project</button></div>}

      {list === null ? <Empty>Loading…</Empty> : list.length === 0 ? (
        <Empty>No projects yet. Start one for private label, custom printing, a new product, or contract manufacturing and we will take it from there.</Empty>
      ) : list.map(p => (
        <div key={p.id} className={`${cardCls} p-4`}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold" style={{ color: INK }}>{p.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{p.number} · opened {fmtDate(p.created)}{p.updated && p.updated !== p.created ? ` · updated ${fmtDate(p.updated)}` : ''}</p>
            </div>
            <Pill tone={p.stage.tone}>{p.stage.label}</Pill>
          </div>
          <details className="mt-2">
            <summary className="text-xs font-semibold cursor-pointer" style={{ color: GREEN }}>Details{p.files.length ? ` and ${p.files.length} file${p.files.length === 1 ? '' : 's'}` : ''}</summary>
            {p.details && <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-600 font-sans leading-relaxed">{p.details}</pre>}
            {p.files.length > 0 && <ul className="mt-2 text-sm space-y-1">{p.files.map((f: any, i: number) => <li key={i}>{f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: GREEN }}>📎 {f.name}</a> : <span>📎 {f.name}</span>}</li>)}</ul>}
          </details>
          <div className="flex flex-wrap gap-2 mt-3">
            {p.quotes.length > 0 && <Link href="/portal/quotes" className={btnCls} style={{ background: GREEN }}>View quote{p.quotes.length > 1 ? 's' : ''}</Link>}
            <Link href={`/portal/book?project=${p.id}&topic=${encodeURIComponent('Project: ' + p.name)}`} className={btnGhostCls}>Book a call</Link>
            <Link href="/portal#team" className={btnGhostCls}>Message the team</Link>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ProjectsPage() {
  return <PortalShell title="Projects" subtitle="Send us project details and files, then track review, quotes and approval."><ProjectsBody /></PortalShell>
}
