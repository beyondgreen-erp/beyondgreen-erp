'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Documents from the repository that are linked to this customer / certification.
 * Same records as on the Documents board — upload here and it lands in the repository too
 * (in this record's folder), so it can be found from either side.
 */
import { useCallback, useEffect, useState } from 'react'
import { getFileUrl, downloadFile } from '@/lib/fileHelpers'
import { Folder, folderLabel } from '@/lib/docRepo'
import DocUploadDialog from '@/components/DocUploadDialog'
import DocThumb, { loadThumbs } from '@/components/DocThumb'

interface Props { sb: any; kind: 'customer' | 'certification'; recordId: string; recordName: string; userEmail: string }
interface D { id: string; title: string; category: string; status: string; folder_id: string | null; updated_at: string | null; created_at: string }

export default function LinkedDocuments({ sb, kind, recordId, recordName, userEmail }: Props) {
  const [docs, setDocs] = useState<D[]>([])
  const [files, setFiles] = useState<Record<string, { path: string; name: string }>>({})
  const [folders, setFolders] = useState<Folder[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [upload, setUpload] = useState(false)
  const [thumbs, setThumbs] = useState<Record<string, { src: string; url: string }>>({})
  const col = kind === 'customer' ? 'customer_id' : 'certification_id'

  const load = useCallback(async () => {
    setLoading(true)
    const [dR, fR, cR] = await Promise.all([
      sb.from('documents').select('id,title,category,status,folder_id,updated_at,created_at').eq(col, recordId).eq('is_active', true).order('title'),
      sb.from('document_folders').select('id,name,parent_id,sort_order,icon,system_key'),
      sb.from('document_categories').select('name,sort_order').order('sort_order'),
    ])
    const list = (dR.data as D[]) || []
    setDocs(list); setFolders((fR.data as Folder[]) || []); setCats(((cR.data as any[]) || []).map(c => c.name))
    if (list.length) {
      const { data } = await sb.from('file_attachments').select('record_id,storage_path,file_name,created_at').eq('record_type', 'documents').in('record_id', list.map(d => d.id)).order('created_at', { ascending: false })
      const m: Record<string, { path: string; name: string }> = {}
      for (const a of (data as any[]) || []) if (!m[a.record_id]) m[a.record_id] = { path: a.storage_path, name: a.file_name }
      setFiles(m)
      loadThumbs(sb, list.map(d => d.id)).then(setThumbs).catch(() => {})
    } else setFiles({})
    setLoading(false)
  }, [sb, col, recordId])
  useEffect(() => { load() }, [load])

  async function view(d: D) { const f = files[d.id]; if (!f) return; const url = await getFileUrl(sb, f.path); if (url) window.open(url, '_blank') }
  async function dl(d: D) { const f = files[d.id]; if (f) await downloadFile(sb, f.path, f.name) }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 tracking-widest uppercase flex items-center gap-1.5"><i className="ti ti-folder text-violet-500" />Documents ({docs.length})</p>
        <div className="flex items-center gap-2">
          <a href={`/bizdev/documents?${kind}=${recordId}`} className="text-xs text-violet-600 font-semibold hover:underline">Open in Documents</a>
          <button onClick={() => setUpload(true)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500"><i className="ti ti-upload mr-1" />Upload</button>
        </div>
      </div>
      {loading ? <p className="text-xs text-gray-400">Loading…</p> : docs.length === 0 ? (
        <p className="text-xs text-gray-400 rounded-lg border border-dashed border-[#E4E6EE] px-3 py-4 text-center">No documents linked yet. Upload here, or link one from the Documents board.</p>
      ) : (
        <div className="rounded-lg border border-[#E4E6EE] divide-y divide-[#F0F1F5]">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <button onClick={() => view(d)} className="w-14 h-11 shrink-0 rounded-md border border-[#E4E6EE] overflow-hidden"><DocThumb sb={sb} docId={d.id} file={files[d.id] || null} saved={thumbs[d.id]} /></button>
              <div className="flex-1 min-w-0">
                <a href={`/bizdev/documents?item=${d.id}`} className="block truncate font-medium text-[#1A1D2E] hover:text-violet-600">{d.title}</a>
                <p className="text-[11px] text-gray-400 truncate">{d.category} · {folderLabel(folders, d.folder_id)}</p>
              </div>
              <button onClick={() => view(d)} disabled={!files[d.id]} title="View" className="p-1 text-gray-400 hover:text-violet-600 disabled:opacity-30"><i className="ti ti-eye" /></button>
              <button onClick={() => dl(d)} disabled={!files[d.id]} title="Download" className="p-1 text-gray-400 hover:text-violet-600 disabled:opacity-30"><i className="ti ti-download" /></button>
            </div>
          ))}
        </div>
      )}
      {upload && <DocUploadDialog sb={sb} userEmail={userEmail} folders={folders} categories={cats.length ? cats : ['Customer Document', 'Certificate', 'Other']}
        customers={kind === 'customer' ? [{ id: recordId, name: recordName }] : []}
        certifications={kind === 'certification' ? [{ id: recordId, name: recordName }] : []}
        defaults={kind === 'customer' ? { category: 'Customer Document', customerId: recordId } : { category: 'Certificate', certificationId: recordId }}
        lockLink onClose={() => setUpload(false)} onDone={() => { setUpload(false); load() }} />}
    </div>
  )
}
