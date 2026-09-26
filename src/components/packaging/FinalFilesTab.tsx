'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { BUCKET, safeFileName, type DesignRow } from '@/lib/packaging/doc'
import { FORMATS, DEFAULT_EXPORT, exportDesign, exportProofSheet, zipFiles, downloadBlob, type ExportFormat, type ExportOptions } from '@/lib/packaging/exporters'
import type { EditorHandle } from './Editor'

interface FileRow { id: string; design_id: string; version_id: string | null; format: string; file_name: string; file_path: string; size_bytes: number | null; options: any; created_by: string | null; created_at: string }

const fmtSize = (n?: number | null) => !n ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`

export default function FinalFilesTab({ design, editor, user, onDesign }: {
  design: DesignRow; editor: React.RefObject<EditorHandle>; user: { email: string; name: string }; onDesign: (p: Partial<DesignRow>) => Promise<void>
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [formats, setFormats] = useState<ExportFormat[]>(['ai', 'eps', 'pdf', 'png'])
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT)
  const [label, setLabel] = useState('')
  const [markFinal, setMarkFinal] = useState(true)
  const [withProof, setWithProof] = useState(true)
  const [withOriginal, setWithOriginal] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data } = await sb.from('packaging_design_files').select('*').eq('design_id', design.id).order('created_at', { ascending: false })
    setFiles((data || []) as FileRow[])
  }, [sb, design.id])
  useEffect(() => { load() }, [load])

  const toggle = (f: ExportFormat) => setFormats(s => s.includes(f) ? s.filter(x => x !== f) : [...s, f])
  const base = safeFileName(`${design.name}${design.sku ? '_' + design.sku : ''}`)

  async function build(): Promise<{ name: string; blob: Blob; fmt: string }[]> {
    const ed = editor.current, canvas = ed?.getCanvas()
    if (!ed || !canvas) throw new Error('Open the Design tab once so the editor can load.')
    const doc = ed.getExportDoc()
    const out: { name: string; blob: Blob; fmt: string }[] = []
    const warn = new Set<string>()
    for (const fmt of FORMATS.map(f => f.key).filter(k => formats.includes(k))) {
      setBusy(`Rendering ${fmt.toUpperCase()}…`)
      const r = await exportDesign(canvas, doc, fmt, opts)
      r.warnings.forEach(w => warn.add(w))
      out.push({ name: `${base}.${fmt}`, blob: r.blob, fmt })
    }
    const src = withOriginal ? (ed.getDoc() as any)?.source : null
    if (src?.path) {
      setBusy('Adding the original file (unaltered)…')
      const { data: blob, error } = await sb.storage.from(BUCKET).download(src.path)
      if (error || !blob) throw new Error('Could not read the stored original file')
      out.push({ name: src.name, blob, fmt: 'original' })
    }
    const info = withProof ? ed.getProofInfo() : null
    if (info) {
      setBusy('Building approval proof sheet…')
      const r = await exportProofSheet(canvas, doc, info, opts)
      r.warnings.forEach(w => warn.add(w))
      out.push({ name: `${base}_PROOF${info.proofNo ? '_' + info.proofNo : ''}.pdf`, blob: r.blob, fmt: 'proof' })
    }
    setWarnings(Array.from(warn))
    return out
  }

  const download = async () => {
    if (!formats.length && !withProof) return
    setMsg(''); setWarnings([])
    try {
      const out = await build()
      if (out.length === 1) downloadBlob(out[0].blob, out[0].name)
      else { setBusy('Zipping…'); downloadBlob(await zipFiles(out), `${base}.zip`) }
    } catch (e: any) { setMsg('Error: ' + (e?.message || String(e))) } finally { setBusy(null) }
  }

  const saveFinal = async () => {
    if (!formats.length && !withProof) return
    setMsg(''); setWarnings([])
    try {
      setBusy('Saving working file…')
      await editor.current?.saveNow()
      const doc = editor.current?.getDoc()
      if (!doc) throw new Error('Editor not ready')
      // snapshot a version so the final files can always be traced back to their source
      setBusy('Creating version…')
      const { data: last } = await sb.from('packaging_design_versions').select('version_no').eq('design_id', design.id).order('version_no', { ascending: false }).limit(1)
      const n = ((last?.[0] as any)?.version_no || 0) + 1
      const vPath = `designs/${design.id}/versions/${n}.json`
      await sb.storage.from(BUCKET).upload(vPath, new Blob([JSON.stringify(doc)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
      const { data: ver, error: vErr } = await sb.from('packaging_design_versions').insert({ design_id: design.id, version_no: n, label: `Final${label ? ' — ' + label : ''}`, doc_path: vPath, thumb_path: design.thumb_path, created_by: user.email }).select().single()
      if (vErr) throw vErr
      const out = await build()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      for (const f of out) {
        setBusy(`Uploading ${f.name}…`)
        const name = f.fmt === 'proof' ? `${base}_v${n}_APPROVAL_PROOF.pdf` : f.fmt === 'original' ? `ORIGINAL_${safeFileName(f.name)}` : `${base}_v${n}.${f.fmt}`
        const path = `designs/${design.id}/final/${stamp}/${name}`
        const up = await sb.storage.from(BUCKET).upload(path, f.blob, { upsert: true, contentType: f.blob.type || 'application/octet-stream' })
        if (up.error) throw up.error
        await sb.from('packaging_design_files').insert({ design_id: design.id, version_id: (ver as any).id, format: f.fmt, file_name: name, file_path: path, size_bytes: f.blob.size, options: { ...opts, label }, created_by: user.email })
      }
      if (markFinal) await onDesign({ status: 'Final' })
      setLabel(''); setMsg(`Saved ${out.length} final file${out.length > 1 ? 's' : ''} as version ${n}. Printers with an active share link can download them.`)
      load()
    } catch (e: any) { setMsg('Error: ' + (e?.message || String(e))) } finally { setBusy(null) }
  }

  const dl = async (f: FileRow) => {
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(f.file_path, 300, { download: f.file_name })
    if (data?.signedUrl) window.location.href = data.signedUrl
  }
  const dlSet = async (list: FileRow[]) => {
    setBusy('Zipping…')
    try {
      const blobs = await Promise.all(list.map(async f => ({ name: f.file_name, blob: (await sb.storage.from(BUCKET).download(f.file_path)).data! })))
      downloadBlob(await zipFiles(blobs.filter(b => b.blob)), `${base}_final.zip`)
    } finally { setBusy(null) }
  }
  const del = async (f: FileRow) => {
    if (!confirm(`Delete ${f.file_name}? Printers will no longer be able to download it.`)) return
    await sb.storage.from(BUCKET).remove([f.file_path])
    await sb.from('packaging_design_files').delete().eq('id', f.id)
    load()
  }

  // group by export batch (version)
  const sets = files.reduce((m: Record<string, FileRow[]>, f) => { const k = f.version_id || f.created_at.slice(0, 16); (m[k] ||= []).push(f); return m }, {})

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6FA]">
      <div className="max-w-5xl mx-auto p-6 grid lg:grid-cols-[1fr_380px] gap-6">
        <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Export final files</h2>
            <p className="text-sm text-gray-500">Vector formats keep every path editable, convert text to outlines and carry CMYK &amp; spot colours. All formats open in CorelDRAW (File ▸ Import) and Adobe Illustrator.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {FORMATS.map(f => (
              <label key={f.key} className={`flex gap-3 p-3 rounded-xl border cursor-pointer ${formats.includes(f.key) ? 'border-[#3B6FE0] bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="checkbox" checked={formats.includes(f.key)} onChange={() => toggle(f.key)} className="mt-1" />
                <div><p className="font-semibold text-sm">.{f.key.toUpperCase()}</p><p className="text-xs text-gray-500">{f.desc}</p></div>
              </label>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={opts.includeDieline} onChange={e => setOpts({ ...opts, includeDieline: e.target.checked })} /> Include dieline layer</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opts.convertToCmyk} onChange={e => setOpts({ ...opts, convertToCmyk: e.target.checked })} /> Convert RGB colours to CMYK</label>
            <label className="flex items-center gap-2">Raster resolution
              <select value={opts.dpi} onChange={e => setOpts({ ...opts, dpi: Number(e.target.value) })} className="border border-gray-300 rounded px-2 py-1">
                {[72, 150, 300, 600].map(d => <option key={d} value={d}>{d} dpi</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">JPG quality
              <select value={opts.jpgQuality} onChange={e => setOpts({ ...opts, jpgQuality: Number(e.target.value) })} className="border border-gray-300 rounded px-2 py-1">
                {[0.8, 0.9, 0.92, 1].map(d => <option key={d} value={d}>{Math.round(d * 100)}%</option>)}
              </select>
            </label>
          </div>
          <div className="border-t pt-4 space-y-3">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Note for this final set (optional) — e.g. Approved by customer 9/25" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={withOriginal} onChange={e => setWithOriginal(e.target.checked)} /> Include the <b>original uploaded file</b>, byte-for-byte unaltered (recommended for production)</label>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={withProof} onChange={e => setWithProof(e.target.checked)} /> Include the official <b>approval proof sheet</b> (PDF with customer, SKU, inks &amp; sign-off)</label>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={markFinal} onChange={e => setMarkFinal(e.target.checked)} /> Set design status to <b>Final</b></label>
            <div className="flex flex-wrap gap-2">
              <button disabled={!!busy || !formats.length} onClick={saveFinal} className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: '#2ABF06' }}>
                <i className="ti ti-circle-check" /> Save as confirmed final files
              </button>
              <button disabled={!!busy || (!formats.length && !withProof)} onClick={download} className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                <i className="ti ti-download" /> Just download{formats.length + (withProof ? 1 : 0) > 1 ? ' (.zip)' : ''}
              </button>
            </div>
            {busy && <p className="text-sm text-gray-600"><i className="ti ti-loader-2 animate-spin" /> {busy}</p>}
            {msg && <p className={`text-sm ${msg.startsWith('Error') ? 'text-red-600' : 'text-emerald-700'}`}>{msg}</p>}
            {warnings.length > 0 && <ul className="text-xs text-amber-700 space-y-0.5">{warnings.map(w => <li key={w}>⚠ {w}</li>)}</ul>}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-bold text-gray-900">Confirmed final files</h3>
          {!files.length && <p className="text-sm text-gray-500 bg-white rounded-xl border border-dashed border-gray-300 p-4">No final files yet. Saved files are kept here and offered to printers on the share page.</p>}
          {Object.entries(sets).map(([k, list]) => (
            <div key={k} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 flex items-center text-xs text-gray-600">
                <span className="font-medium">{new Date(list[0].created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="ml-2 truncate">{list[0].options?.label || ''}</span>
                <button onClick={() => dlSet(list)} className="ml-auto text-[#3B6FE0] hover:underline whitespace-nowrap"><i className="ti ti-file-zip" /> All</button>
              </div>
              {list.map(f => (
                <div key={f.id} className="px-3 py-2 flex items-center gap-2 text-sm border-t border-gray-100">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-900 text-white uppercase">{f.format}</span>
                  <span className="truncate flex-1" title={f.file_name}>{f.file_name}</span>
                  <span className="text-[11px] text-gray-400">{fmtSize(f.size_bytes)}</span>
                  <button onClick={() => dl(f)} title="Download" className="text-gray-500 hover:text-black"><i className="ti ti-download" /></button>
                  <button onClick={() => del(f)} title="Delete" className="text-gray-400 hover:text-red-600"><i className="ti ti-trash" /></button>
                </div>
              ))}
            </div>
          ))}
          <div className="text-[11px] text-gray-500 bg-white rounded-xl border border-gray-200 p-3 space-y-1">
            <p className="font-semibold text-gray-700">CorelDRAW tips</p>
            <p>• Use File ▸ Import (not Open) for .AI, .EPS and .PDF. Choose &quot;Curves&quot; if asked about text — text is already outlined.</p>
            <p>• The dieline arrives as a separate spot colour (&quot;Dieline&quot;) set to overprint.</p>
            <p>• PDF/AI keep layers; EPS/PS flatten layers into one.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
