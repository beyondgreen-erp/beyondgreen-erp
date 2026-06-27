'use client'
import { useRef, useState } from 'react'
import { uploadFile } from '@/lib/fileHelpers'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Props { sb: any; userEmail: string; onDone: () => void }
type Status = 'queued' | 'uploading' | 'analyzing' | 'done' | 'error'
interface Item { name: string; status: Status; error?: string }

// Drop or pick files; AI names, summarizes, and categorizes each one automatically.
export default function QuickUpload({ sb, userEmail, onDone }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function setStatus(i: number, status: Status, error?: string) {
    setItems(prev => prev.map((it, idx) => (idx === i ? { ...it, status, error } : it)))
  }

  async function processFiles(files: File[]) {
    if (!files.length) return
    const start = items.length
    setItems(prev => [...prev, ...files.map(f => ({ name: f.name, status: 'queued' as Status }))])
    setBusy(true)
    for (let k = 0; k < files.length; k++) {
      const i = start + k
      const file = files[k]
      try {
        setStatus(i, 'uploading')
        const baseTitle = file.name.replace(/\.[^.]+$/, '')
        const { data: doc, error } = await sb.from('documents')
          .insert({ title: baseTitle, category: 'Other', status: 'Active', is_active: true })
          .select('id').single()
        if (error || !doc) throw new Error(error?.message || 'Could not create record')
        const up = await uploadFile(sb, file, 'documents', doc.id, userEmail)
        if (!up.success) throw new Error(up.error || 'Upload failed')
        setStatus(i, 'analyzing')
        const res = await fetch('/api/documents/process', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: doc.id, autotitle: true }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || 'AI analysis failed')
        setStatus(i, 'done')
        onDone()
      } catch (e) {
        setStatus(i, 'error', (e as Error).message)
      }
    }
    setBusy(false)
    onDone()
    setTimeout(() => setItems(prev => prev.filter(it => it.status !== 'done')), 5000)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false)
    if (e.dataTransfer.files?.length) processFiles(Array.from(e.dataTransfer.files))
  }

  const SC: Record<Status, string> = {
    queued: 'text-gray-400', uploading: 'text-sky-500', analyzing: 'text-violet-600', done: 'text-emerald-500', error: 'text-red-500',
  }
  const ICON: Record<Status, string> = {
    queued: 'ti-clock', uploading: 'ti-cloud-upload', analyzing: 'ti-sparkles', done: 'ti-circle-check', error: 'ti-alert-circle',
  }
  const LABEL: Record<Status, string> = {
    queued: 'Queued', uploading: 'Uploading…', analyzing: 'AI analyzing…', done: 'Done', error: 'Failed',
  }
  const spin = (s: Status) => (s === 'uploading' || s === 'analyzing') ? ' animate-pulse' : ''

  return (
    <div className="relative"
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}>
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        title="Drop files here or click — AI names, summarizes, and categorizes each one"
        className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors text-white ${drag ? 'bg-violet-500 ring-2 ring-violet-300' : 'bg-violet-600 hover:bg-violet-500'} disabled:opacity-60`}>
        <i className={`ti ${busy ? 'ti-loader-2 animate-spin' : 'ti-bolt'}`} /> Quick Upload
      </button>
      <input ref={inputRef} type="file" multiple className="hidden"
        onChange={e => { if (e.target.files?.length) processFiles(Array.from(e.target.files)); e.target.value = '' }} />

      {drag && (
        <div className="absolute inset-x-0 -bottom-1 translate-y-full mt-1 text-center text-xs text-violet-600 z-10">Drop to upload — AI does the rest</div>
      )}

      {items.length > 0 && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-[#E4E6EE] rounded-xl shadow-xl z-40 p-3 space-y-1 max-h-80 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-500 px-1 pb-1 flex items-center gap-1.5"><i className="ti ti-bolt text-violet-500" /> Quick Upload</p>
          {items.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs px-1 py-1">
              <i className={`ti ${ICON[it.status]} ${SC[it.status]}${spin(it.status)}`} />
              <span className="flex-1 truncate text-[#1A1D2E]">{it.name}</span>
              <span className={`${SC[it.status]} shrink-0`}>{it.status === 'error' ? (it.error || 'Failed') : LABEL[it.status]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
