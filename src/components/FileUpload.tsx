'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadFile, downloadFile, formatFileSize, fileIcon } from '@/lib/fileHelpers'

interface FileAttachment {
  id: string
  record_type: string
  record_id: string
  file_name: string
  file_size: number
  file_type: string
  storage_path: string
  uploaded_by: string
  created_at: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Props {
  supabase: any
  recordType: string
  recordId: string
  currentUserEmail: string
  accept?: string
  maxSizeMB?: number
  multiple?: boolean
}

interface UploadItem {
  file: File
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

function FileTypeIcon({ type, name }: { type: string; name: string }) {
  const kind = fileIcon(type, name)
  if (kind === 'image') {
    return (
      <svg className="w-5 h-5 text-sky-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )
  }
  if (kind === 'pdf') {
    return (
      <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  }
  if (kind === 'spreadsheet') {
    return (
      <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 6h18M3 14h18M3 18h18M8 6v12M16 6v12" />
      </svg>
    )
  }
  if (kind === 'word') {
    return (
      <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  }
  return (
    <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  )
}

export default function FileUpload({
  supabase,
  recordType,
  recordId,
  currentUserEmail,
  accept,
  maxSizeMB = 50,
  multiple = true,
}: Props) {
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function loadAttachments() {
    const { data } = await supabase
      .from('file_attachments')
      .select('*')
      .eq('record_type', recordType)
      .eq('record_id', recordId)
      .order('created_at', { ascending: false })
    if (data) setAttachments(data as FileAttachment[])
  }

  useEffect(() => {
    loadAttachments()
  }, [recordId]) // eslint-disable-line

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    const toUpload: UploadItem[] = fileArr.map((f) => ({
      file: f,
      progress: 0,
      status: 'uploading',
    }))
    setUploads((prev) => [...prev, ...toUpload])

    await Promise.all(
      fileArr.map(async (file, idx) => {
        if (file.size > maxSizeMB * 1024 * 1024) {
          setUploads((prev) => {
            const n = [...prev]
            const i = n.findIndex((u) => u.file === toUpload[idx].file)
            if (i >= 0) n[i] = { ...n[i], status: 'error', error: `File exceeds ${maxSizeMB}MB limit` }
            return n
          })
          return
        }

        setUploads((prev) => {
          const n = [...prev]
          const i = n.findIndex((u) => u.file === toUpload[idx].file)
          if (i >= 0) n[i] = { ...n[i], progress: 50 }
          return n
        })

        const result = await uploadFile(supabase, file, recordType, recordId, currentUserEmail)

        setUploads((prev) => {
          const n = [...prev]
          const i = n.findIndex((u) => u.file === toUpload[idx].file)
          if (i >= 0) {
            n[i] = result.success
              ? { ...n[i], progress: 100, status: 'done' }
              : { ...n[i], status: 'error', error: result.error }
          }
          return n
        })
      })
    )

    await loadAttachments()
    setTimeout(() => setUploads((prev) => prev.filter((u) => u.status !== 'done')), 2000)
  }, [supabase, recordType, recordId, currentUserEmail, maxSizeMB]) // eslint-disable-line

  async function handleDownload(att: FileAttachment) {
    setDownloading(att.id)
    await downloadFile(supabase, att.storage_path, att.file_name)
    setDownloading(null)
  }

  async function handleDelete(att: FileAttachment) {
    if (!confirm(`Delete "${att.file_name}"?`)) return
    setDeleting(att.id)
    await supabase.storage.from('erp-files').remove([att.storage_path])
    await supabase.from('file_attachments').delete().eq('id', att.id)
    setDeleting(null)
    loadAttachments()
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Files</p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg px-4 py-5 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-emerald-500 bg-emerald-500/10'
            : 'border-gray-700 hover:border-gray-600 bg-gray-800/30'
        }`}
      >
        <svg className="w-6 h-6 mx-auto mb-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-xs text-gray-400">Drop files here or <span className="text-emerald-400">click to browse</span></p>
        <p className="text-xs text-gray-600 mt-1">Max {maxSizeMB}MB per file</p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={multiple}
          accept={accept}
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u, i) => (
            <div key={i} className="bg-gray-800 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-300 truncate max-w-[200px]">{u.file.name}</span>
                {u.status === 'done' && (
                  <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {u.status === 'error' && (
                  <span className="text-xs text-red-400 shrink-0">{u.error}</span>
                )}
              </div>
              {u.status === 'uploading' && (
                <div className="w-full bg-gray-700 rounded-full h-1">
                  <div
                    className="bg-emerald-500 h-1 rounded-full transition-all"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Uploaded files list */}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-2.5 bg-gray-800/60 rounded-lg px-3 py-2.5 group">
              <FileTypeIcon type={att.file_type} name={att.file_name} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white font-medium truncate">{att.file_name}</p>
                <p className="text-xs text-gray-600">
                  {formatFileSize(att.file_size)} · {new Date(att.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleDownload(att)}
                  disabled={downloading === att.id}
                  title="Download"
                  className="p-1.5 text-gray-500 hover:text-emerald-400 transition-colors rounded disabled:opacity-50"
                >
                  {downloading === att.id ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  )}
                </button>
                <button
                  onClick={() => handleDelete(att)}
                  disabled={deleting === att.id}
                  title="Delete"
                  className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded disabled:opacity-50"
                >
                  {deleting === att.id ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {attachments.length === 0 && uploads.length === 0 && (
        <p className="text-xs text-gray-600 italic">No files attached yet.</p>
      )}
    </div>
  )
}
