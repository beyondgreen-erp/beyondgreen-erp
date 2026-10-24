/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Document repository helpers shared by the Documents board, the Customers board and the
 * Certifications board.
 *
 * Linking rule (set by category):
 *   Customer Document → must link a customer      → filed in  Customer Documents › {customer}
 *   Certificate       → must link a certification → filed in  Certifications & Compliance › Certificates › {certification}
 * Any document can also be linked to a customer / certification by hand; it then shows on that
 * record on its own board.
 */
import { uploadFile } from '@/lib/fileHelpers'

export interface Folder { id: string; name: string; parent_id: string | null; sort_order: number; icon: string | null; system_key: string | null }

export const LINK_BY_CATEGORY: Record<string, 'customer' | 'certification'> = {
  'Customer Document': 'customer',
  Certificate: 'certification',
}
export const linkKindFor = (category: string) => LINK_BY_CATEGORY[category] || null

/** Folder path used when a document is linked, so linked documents file themselves. */
export function autoFolderPath(kind: 'customer' | 'certification', name: string): string[] {
  return kind === 'customer' ? ['Customer Documents', name] : ['Certifications & Compliance', 'Certificates', name]
}

export async function ensureFolder(sb: any, path: string[]): Promise<string | null> {
  const { data, error } = await sb.rpc('doc_folder_ensure', { p_path: path })
  if (error) throw new Error(error.message)
  return (data as string) || null
}

/** Full path names of a folder, root first. */
export function folderPath(folders: Folder[], id: string | null | undefined): Folder[] {
  const byId = new Map(folders.map(f => [f.id, f]))
  const out: Folder[] = []
  let cur = id ? byId.get(id) : undefined
  let guard = 0
  while (cur && guard++ < 20) { out.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined }
  return out
}
export const folderLabel = (folders: Folder[], id: string | null | undefined) => folderPath(folders, id).map(f => f.name).join(' › ') || 'No folder'

/** Folders in tree order with their depth — for <select> menus. */
export function folderOptions(folders: Folder[]): { id: string; label: string; depth: number }[] {
  const kids = new Map<string | null, Folder[]>()
  for (const f of folders) { const k = f.parent_id; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(f) }
  for (const arr of Array.from(kids.values())) arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const out: { id: string; label: string; depth: number }[] = []
  const walk = (pid: string | null, d: number) => { for (const f of kids.get(pid) || []) { out.push({ id: f.id, label: f.name, depth: d }); walk(f.id, d + 1) } }
  walk(null, 0)
  return out
}

export interface UploadOpts {
  category: string
  folderId: string | null
  customerId?: string | null
  certificationId?: string | null
  vendorId?: string | null
  userEmail: string
  onStatus?: (index: number, status: 'uploading' | 'analyzing' | 'done' | 'error', error?: string) => void
}

/** Creates one document per file, attaches the file, then asks the AI to summarise it. */
export async function uploadDocuments(sb: any, files: File[], o: UploadOpts): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    try {
      o.onStatus?.(i, 'uploading')
      const { data: doc, error } = await sb.from('documents').insert({
        title: file.name.replace(/\.[^.]+$/, ''), category: o.category || 'Other', status: 'Active', is_active: true,
        folder_id: o.folderId, customer_id: o.customerId || null, certification_id: o.certificationId || null, vendor_id: o.vendorId || null,
        owner: o.userEmail || null,
      }).select('id').single()
      if (error || !doc) throw new Error(error?.message || 'Could not create the document')
      const up = await uploadFile(sb, file, 'documents', doc.id, o.userEmail)
      if (!up.success) throw new Error(up.error || 'Upload failed')
      ids.push(doc.id)
      o.onStatus?.(i, 'analyzing')
      // AI summary in the background of this step; a failure here does not lose the file
      await fetch('/api/documents/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: doc.id, autotitle: false }) }).catch(() => null)
      o.onStatus?.(i, 'done')
    } catch (e) {
      o.onStatus?.(i, 'error', (e as Error).message)
    }
  }
  return ids
}
