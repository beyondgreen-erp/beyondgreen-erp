'use client'
import { useEffect, useRef, useState } from 'react'
import { uploadFile } from '@/lib/fileHelpers'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Props { sb: any; userEmail: string; onDone: () => void }
type Status = 'queued' | 'uploading' | 'analyzing' | 'done' | 'error'
interface Item { id: number; name: string; status: Status; error?: string }

// Drop files anywhere on the page (or click the button); AI names, summarizes, and categorizes each one.
export default function QuickUpload({ sb, userEmail, onDone }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)
  const dragDepth = useRef(0)
  const processRef = useRef<(files: File[]) => void>(() => {})

  function setStatus(id: number, status: Status, error?: string) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, status, error } : it)))
  }

  async function processFiles(files: File[]) {
    if (!files.length) return
    const newItems: Item[] = files.map(f => ({ id: ++idRef.current, name: f.name, status: 'queued' as Status }))
    setItems(prev => [...prev, ...newItems])
    setBusy(true)
    for (let k = 0; k < files.length; k++) {
      const id = newItems[k].id
      const file = files[k]
      try {
        setStatus(id, 'uploading')
        const baseTitle = file.name.replace(/\.[^.]+$/, '')
        const { data: doc, error } = await sb.from('documents')
          .insert({ title: baseTitle, category: 'Other', status: 'Active', is_active: true })
          .select('id').single()
        if (error || !doc) throw new Error(error?.message || 'Could not create record')
        const up = await uploadFile(sb, file, 'documents', doc.id, userEmail)
        if (!up.success) throw new Error(up.error || 'Upload failed')
        setStatus(id, 'analyzing')
        const res = await fetch('/api/documents/process', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: doc.id, autotitle: true }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || 'AI analysis failed')
        setStatus(id, 'done')
        onDone()
      } catch (e) {
        setStatus(id, 'error', (e as Error).message)
      }
    }
    setBusy(false)
    onDone()
    setTimeout(() => setItems(prev => prev.filter(it => it.status !== 'done')), 5000)
  }
  processRef.current = processFiles

  // Page-wide drag & drop
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files')
    const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragOver(true) }
    const onOver = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault() }
    const onLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false) }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault(); dragDepth.current = 0; setDragOver(false)
      const files = Array.from(e.dataTransfer?.files || [])
      if (files.length) processRef.current(files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

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
    <div className="relative inline-block">
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        title="Drop files anywhere on this page, or click — AI names, summarizes, and categorizes each one"
        className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-60">
        <i className={`ti ${busy ? 'ti-loader-2 animate-spin' : 'ti-bolt'}`} /> Quick Upload
      </button>
      <input ref={inputRef} type="file" multiple className="hidden"
        onChange={e => { if (e.target.files?.length) processFiles(Array.from(e.target.files)); e.target.value = '' }} />

      {/* Full-page drop overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-[100] bg-violet-600/15 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="bg-white border-2 border-dashed border-violet-500 rounded-2xl px-10 py-8 shadow-2xl text-center">
            <i className="ti ti-bolt text-violet-600 text-4xl" />
            <p className="text-lg font-semibold text-[#1A1D2E] mt-2">Drop to upload</p>
            <p className="text-sm text-gray-500 mt-0.5">AI will name, summarize &amp; categorize each file</p>
          </div>
        </div>
      )}

      {/* Progress panel */}
      {items.length > 0 && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-[#E4E6EE] rounded-xl shadow-xl z-40 p-3 space-y-1 max-h-80 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-500 px-1 pb-1 flex items-center gap-1.5"><i className="ti ti-bolt text-violet-500" /> Quick Upload</p>
          {items.map(it => (
            <div key={it.id} className="flex items-center gap-2 text-xs px-1 py-1">
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
