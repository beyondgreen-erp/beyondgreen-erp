'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Upload one or more files into the document repository.
 * The category decides the link: "Customer Document" asks for a customer, "Certificate" asks for a
 * certification. Linked uploads file themselves into that customer's / certification's folder and
 * show up on the Customers / Certifications board automatically.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, autoFolderPath, ensureFolder, folderOptions, linkKindFor, uploadDocuments } from '@/lib/docRepo'

interface Opt { id: string; name: string }
interface Props {
  sb: any; userEmail: string
  folders: Folder[]; categories: string[]
  customers?: Opt[]; certifications?: Opt[]
  initialFiles?: File[]
  defaults?: { folderId?: string | null; category?: string; customerId?: string | null; certificationId?: string | null }
  lockLink?: boolean          // opened from a customer / certification record: keep that link
  onClose: () => void
  onDone: (ids: string[]) => void
}
type St = 'queued' | 'uploading' | 'analyzing' | 'done' | 'error'

export default function DocUploadDialog({ sb, userEmail, folders, categories, customers = [], certifications = [], initialFiles = [], defaults = {}, lockLink, onClose, onDone }: Props) {
  const [files, setFiles] = useState<File[]>(initialFiles)
  const [status, setStatus] = useState<{ s: St; e?: string }[]>(initialFiles.map(() => ({ s: 'queued' })))
  const [category, setCategory] = useState(defaults.category || 'Other')
  const [folderId, setFolderId] = useState<string>(defaults.folderId || '')
  const [customerId, setCustomerId] = useState(defaults.customerId || '')
  const [certId, setCertId] = useState(defaults.certificationId || '')
  const [autoFile, setAutoFile] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const kind = linkKindFor(category)
  const opts = useMemo(() => folderOptions(folders), [folders])
  const cName = customers.find(c => c.id === customerId)?.name || ''
  const ceName = certifications.find(c => c.id === certId)?.name || ''
  const linkName = kind === 'customer' ? cName : kind === 'certification' ? ceName : ''
  const autoPath = kind && linkName ? autoFolderPath(kind, linkName).join(' › ') : ''

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [busy, onClose])

  function add(list: FileList | File[] | null) {
    const arr = Array.from(list || [])
    if (!arr.length) return
    setFiles(f => [...f, ...arr]); setStatus(s => [...s, ...arr.map(() => ({ s: 'queued' as St }))])
  }
  function remove(i: number) { setFiles(f => f.filter((_, k) => k !== i)); setStatus(s => s.filter((_, k) => k !== i)) }

  async function go() {
    setErr('')
    if (!files.length) { setErr('Add at least one file.'); return }
    if (kind === 'customer' && !customerId) { setErr('“Customer Document” needs a customer — pick one so it shows on the Customers board.'); return }
    if (kind === 'certification' && !certId) { setErr('“Certificate” needs a certification — pick one so it shows on the Certifications board.'); return }
    setBusy(true)
    try {
      let fid: string | null = folderId || null
      if (kind && linkName && autoFile) fid = await ensureFolder(sb, autoFolderPath(kind, linkName))
      if (!fid) fid = folders.find(f => f.system_key === 'unsorted')?.id || null
      const ids = await uploadDocuments(sb, files, {
        category, folderId: fid, userEmail,
        customerId: customerId || null, certificationId: certId || null,
        onStatus: (i, s, e) => setStatus(prev => prev.map((x, k) => (k === i ? { s, e } : x))),
      })
      setBusy(false)
      onDone(ids)
    } catch (e) { setBusy(false); setErr((e as Error).message) }
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500'
  const done = status.length > 0 && status.every(x => x.s === 'done' || x.s === 'error')
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}
        onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files) }}>
        <div className="px-6 py-4 border-b border-[#E4E6EE] flex items-center justify-between">
          <h3 className="font-semibold text-[#1A1D2E] flex items-center gap-2"><i className="ti ti-cloud-upload text-violet-500" />Upload documents</h3>
          <button onClick={onClose} disabled={busy} className="p-1 rounded-lg hover:bg-[#F5F6FA] text-gray-400"><i className="ti ti-x" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div onClick={() => input.current?.click()} className={`rounded-xl border-2 border-dashed px-4 py-5 text-center cursor-pointer ${drag ? 'border-violet-500 bg-violet-50' : 'border-[#E4E6EE] hover:border-violet-300'}`}>
            <i className="ti ti-files text-2xl text-violet-400" />
            <p className="text-sm text-gray-600 mt-1">Drop files here or <span className="text-violet-600 font-semibold">browse</span></p>
            <input ref={input} type="file" multiple className="hidden" onChange={e => { add(e.target.files); e.target.value = '' }} />
          </div>
          {files.length > 0 && <div className="rounded-xl border border-[#ECEEF3] divide-y divide-[#F0F1F5]">
            {files.map((f, i) => { const st = status[i] || { s: 'queued' }; return (
              <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <i className="ti ti-file text-gray-400" /><span className="flex-1 truncate">{f.name}</span>
                <span className={`text-[11px] font-semibold ${st.s === 'done' ? 'text-emerald-600' : st.s === 'error' ? 'text-red-600' : 'text-gray-400'}`}>{st.s === 'queued' ? `${Math.max(1, Math.round(f.size / 1024))} KB` : st.s === 'uploading' ? 'Uploading…' : st.s === 'analyzing' ? 'AI reading…' : st.s === 'done' ? '✓ Saved' : st.e || 'Failed'}</span>
                {!busy && st.s === 'queued' && <button onClick={() => remove(i)} className="text-gray-300 hover:text-red-500"><i className="ti ti-x" /></button>}
              </div>) })}
          </div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} disabled={busy || lockLink} className={inp}>{categories.map(c => <option key={c}>{c}</option>)}</select></div>
            {kind === 'customer' && <div><label className="block text-xs text-gray-500 mb-1">Customer <span className="text-red-500">*</span></label>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} disabled={busy || lockLink} className={inp}><option value="">— Pick a customer —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
            {kind === 'certification' && <div><label className="block text-xs text-gray-500 mb-1">Certification <span className="text-red-500">*</span></label>
              <select value={certId} onChange={e => setCertId(e.target.value)} disabled={busy || lockLink} className={inp}><option value="">— Pick a certification —</option>{certifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          </div>
          {kind && <p className="text-[12px] rounded-lg bg-violet-50 border border-violet-100 text-violet-800 px-3 py-2">
            <i className="ti ti-link mr-1" />Linked to {kind === 'customer' ? 'the customer — it will also show on the Customers board' : 'the certification — it will also show on the Certifications board'}.</p>}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Folder</label>
            {kind && linkName && <label className="flex items-center gap-2 text-xs text-gray-600 mb-1.5"><input type="checkbox" checked={autoFile} onChange={e => setAutoFile(e.target.checked)} disabled={busy} />File it in <b>{autoPath}</b> (created if needed)</label>}
            {!(kind && linkName && autoFile) && <select value={folderId} onChange={e => setFolderId(e.target.value)} disabled={busy} className={inp}>
              <option value="">Unsorted</option>
              {opts.map(o => <option key={o.id} value={o.id}>{'  '.repeat(o.depth * 2)}{o.depth ? '└ ' : ''}{o.label}</option>)}
            </select>}
          </div>
          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-[#E4E6EE] flex gap-3">
          <button onClick={onClose} disabled={busy} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-600">{done ? 'Close' : 'Cancel'}</button>
          {!done && <button onClick={go} disabled={busy || !files.length} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">{busy ? 'Uploading…' : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}</button>}
        </div>
      </div>
    </div>
  )
}
