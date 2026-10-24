'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Documents & Knowledge — folder-based repository.
 *  · Left: folder tree (create / rename / delete sub-folders, drop documents onto a folder to move them).
 *  · Right: the open folder — its sub-folders, then its documents as a clean list.
 *  · Upload: pick a category; "Customer Document" links a customer, "Certificate" links a certification.
 *    Linked documents file themselves into that customer's / certification's folder and also show on
 *    the Customers / Certifications board.
 */
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { getFileUrl, downloadFile } from '@/lib/fileHelpers'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import Comments from '@/components/Comments'
import KnowledgeCenter from '@/components/KnowledgeCenter'
import DocAI from '@/components/DocAI'
import ItemHistory from '@/components/ItemHistory'
import DocUploadDialog from '@/components/DocUploadDialog'
import { Folder, autoFolderPath, ensureFolder, folderLabel, folderOptions, folderPath, linkKindFor } from '@/lib/docRepo'

interface Opt { id: string; company_name?: string; cert_name?: string | null; order_number?: string | null }
interface Doc { id: string; title: string; category: string; version: string | null; effective_date: string | null; review_date: string | null; status: string; owner: string | null; customer_id: string | null; vendor_id: string | null; order_id: string | null; certification_id: string | null; source_file_path: string | null; notes: string | null; is_active: boolean; ai_summary: string | null; folder_id: string | null; updated_at: string | null; created_at: string; ai_processed_at: string | null }
interface AccessRow { id: number; actor_email: string | null; action: string; record_id: string | null; document_title: string | null; file_name: string | null; created_at: string }
const DEFAULT_CATS = ['Contract', 'Spec Sheet', 'Certificate', 'SDS', 'Quality Record', 'Drawing', 'Policy', 'Customer Document', 'Other']
const STATUSES = ['Active', 'Under Review', 'Archived']
const AC: Record<string, { cls: string; icon: string; label: string }> = { upload: { cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20', icon: 'ti-cloud-upload', label: 'Upload' }, view: { cls: 'bg-sky-500/15 text-sky-600 border-sky-500/20', icon: 'ti-eye', label: 'View' }, download: { cls: 'bg-violet-500/15 text-violet-600 border-violet-500/20', icon: 'ti-download', label: 'Download' }, delete: { cls: 'bg-red-500/15 text-red-600 border-red-500/20', icon: 'ti-trash', label: 'Delete' } }
const empty = { title: '', category: 'Other', version: '', effective_date: '', review_date: '', status: 'Active', owner: '', customer_id: '', vendor_id: '', order_id: '', certification_id: '', notes: '', folder_id: '' }
type F = typeof empty
const ALL = '__all', UNFILED = '__unfiled'
function dbErr(e: { code?: string; message: string; hint?: string }) { return [e.message, e.code && `(${e.code})`, e.hint && `Hint: ${e.hint}`].filter(Boolean).join(' — ') }
function isDueForReview(review: string | null, status: string) { return review && status !== 'Archived' && new Date(review + 'T00:00:00') <= new Date(new Date().toDateString()) }

export default function DocumentsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Doc[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [customers, setCustomers] = useState<Opt[]>([])
  const [vendors, setVendors] = useState<Opt[]>([])
  const [orders, setOrders] = useState<Opt[]>([])
  const [certs, setCerts] = useState<Opt[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [fileMap, setFileMap] = useState<Record<string, { path: string; name: string }>>({})
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  // navigation
  const [cur, setCur] = useState<string>(ALL)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [linkFilter, setLinkFilter] = useState<{ kind: 'customer' | 'certification'; id: string } | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'board' | 'history'>('board')
  // dialogs
  const [upload, setUpload] = useState<File[] | null>(null)
  const [folderDlg, setFolderDlg] = useState<{ mode: 'new' | 'rename'; parentId: string | null; id?: string; name: string } | null>(null)
  const [folderErr, setFolderErr] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [dropHint, setDropHint] = useState<string | null>(null)
  const [pageDrag, setPageDrag] = useState(false)
  // edit modal
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Doc | null>(null)
  const [form, setForm] = useState<F>(empty)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const tagRef = useRef<TagInputHandle>(null)
  // history
  const [hist, setHist] = useState<AccessRow[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [histFilter, setHistFilter] = useState<'all' | 'upload' | 'view' | 'download'>('all')
  const [histSearch, setHistSearch] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: docs }, { data: fl }, { data: c }, { data: v }, { data: o }, { data: ce }, { data: atts }, { data: dc }] = await Promise.all([
      sb.from('documents').select('id,title,category,version,effective_date,review_date,status,owner,customer_id,vendor_id,order_id,certification_id,source_file_path,notes,is_active,ai_summary,folder_id,updated_at,created_at,ai_processed_at').order('title', { ascending: true }),
      sb.from('document_folders').select('id,name,parent_id,sort_order,icon,system_key'),
      sb.from('customers').select('id,company_name').eq('is_active', true).eq('board', 'customer').order('company_name').limit(2000),
      sb.from('vendors').select('id,company_name').eq('is_active', true).order('company_name'),
      sb.from('sales_orders').select('id,order_number').order('created_at', { ascending: false }).limit(800),
      sb.from('certifications').select('id,cert_name').eq('is_active', true).order('cert_name'),
      sb.from('file_attachments').select('record_id,storage_path,file_name,created_at').eq('record_type', 'documents').order('created_at', { ascending: false }),
      sb.from('document_categories').select('name,sort_order').order('sort_order').order('name'),
    ])
    setRows((docs as Doc[]) || []); setFolders((fl as Folder[]) || [])
    setCustomers((c as Opt[]) || []); setVendors((v as Opt[]) || []); setOrders((o as Opt[]) || []); setCerts((ce as Opt[]) || [])
    setCats(((dc as any[]) || []).map(x => x.name))
    const fm: Record<string, { path: string; name: string }> = {}
    for (const a of (atts as any[]) || []) if (!fm[a.record_id]) fm[a.record_id] = { path: a.storage_path, name: a.file_name }
    setFileMap(fm); setLoading(false)
  }
  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
    const q = new URLSearchParams(window.location.search)
    const cu = q.get('customer'), ct = q.get('certification')
    if (cu) setLinkFilter({ kind: 'customer', id: cu }); else if (ct) setLinkFilter({ kind: 'certification', id: ct })
  }, []) // eslint-disable-line

  const catNames = useMemo(() => { const s = cats.length ? cats : DEFAULT_CATS; return s.includes('Customer Document') ? s : [...s, 'Customer Document'] }, [cats])
  const cmap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c.company_name || ''])), [customers])
  const cemap = useMemo(() => Object.fromEntries(certs.map(c => [c.id, c.cert_name || 'Certification'])), [certs])
  const vmap = useMemo(() => Object.fromEntries(vendors.map(c => [c.id, c.company_name || ''])), [vendors])

  // ── folder tree
  const kids = useMemo(() => {
    const m = new Map<string | null, Folder[]>()
    for (const f of folders) { const k = f.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(f) }
    for (const arr of Array.from(m.values())) arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    return m
  }, [folders])
  const visible = useMemo(() => rows.filter(r => (archived ? !r.is_active : r.is_active)), [rows, archived])
  const counts = useMemo(() => {
    const direct: Record<string, number> = {}
    for (const r of visible) if (r.folder_id) direct[r.folder_id] = (direct[r.folder_id] || 0) + 1
    const total: Record<string, number> = {}
    const walk = (id: string): number => { let n = direct[id] || 0; for (const k of kids.get(id) || []) n += walk(k.id); total[id] = n; return n }
    for (const f of kids.get(null) || []) walk(f.id)
    return total
  }, [visible, kids])
  const descendants = useMemo(() => {
    if (cur === ALL || cur === UNFILED) return new Set<string>()
    const s = new Set<string>([cur]); const st = [cur]
    while (st.length) { const id = st.pop()!; for (const k of kids.get(id) || []) { s.add(k.id); st.push(k.id) } }
    return s
  }, [cur, kids])
  const unfiled = visible.filter(r => !r.folder_id || !folders.some(f => f.id === r.folder_id)).length

  // ── documents shown on the right
  const q = search.trim().toLowerCase()
  const shown = useMemo(() => {
    let list = visible
    if (linkFilter) list = list.filter(r => (linkFilter.kind === 'customer' ? r.customer_id : r.certification_id) === linkFilter.id)
    else if (q) list = list   // search runs across every folder
    else if (cur === UNFILED) list = list.filter(r => !r.folder_id || !folders.some(f => f.id === r.folder_id))
    else if (cur !== ALL) list = list.filter(r => r.folder_id === cur)
    if (q) list = list.filter(r => [r.title, r.category, r.status, r.owner, r.version, r.ai_summary, r.customer_id && cmap[r.customer_id], r.certification_id && cemap[r.certification_id], r.vendor_id && vmap[r.vendor_id], folderLabel(folders, r.folder_id), fileMap[r.id]?.name].join(' ').toLowerCase().includes(q))
    return list
  }, [visible, linkFilter, q, cur, folders, cmap, cemap, vmap, fileMap])
  const subFolders = !q && !linkFilter && cur !== UNFILED ? (kids.get(cur === ALL ? null : cur) || []) : []
  const listRows = cur === ALL && !q && !linkFilter ? [] : shown
  const curFolder = folders.find(f => f.id === cur) || null
  const crumbs = folderPath(folders, curFolder?.id)

  // ── files
  function resolveFile(r: Doc) { const fa = fileMap[r.id]; if (fa) return fa; if (r.source_file_path) return { path: r.source_file_path, name: r.source_file_path.split('/').pop() || 'file' }; return null }
  function fileIcon(r: Doc) {
    const f = resolveFile(r); const ext = (f?.name || '').split('.').pop()?.toLowerCase() || ''
    if (ext === 'pdf') return { icon: 'ti-file-type-pdf', color: '#DC2626' }
    if (['doc', 'docx'].includes(ext)) return { icon: 'ti-file-type-doc', color: '#2563EB' }
    if (['xls', 'xlsx', 'csv'].includes(ext)) return { icon: 'ti-file-type-xls', color: '#16A34A' }
    if (['ppt', 'pptx'].includes(ext)) return { icon: 'ti-file-type-ppt', color: '#EA580C' }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'eps', 'ai'].includes(ext)) return { icon: 'ti-photo', color: '#7C3AED' }
    if (['zip', 'rar', '7z'].includes(ext)) return { icon: 'ti-file-zip', color: '#CA8A04' }
    if (!f) return { icon: 'ti-file-description', color: '#C4C7D0' }
    return { icon: 'ti-file', color: '#6B7280' }
  }
  function logAccess(action: 'view' | 'download', r: Doc) { const f = resolveFile(r); sb.from('file_access_log').insert({ actor_email: userEmail || null, action, record_type: 'documents', record_id: r.id, document_title: r.title, file_name: f?.name || null, storage_path: f?.path || null }).then(() => {}, () => {}) }
  async function viewFile(r: Doc) { const f = resolveFile(r); if (!f) { alert('No file attached to this document.'); return } const url = await getFileUrl(sb, f.path); if (url) { window.open(url, '_blank'); logAccess('view', r) } else alert('Could not open the file.') }
  async function downloadDoc(r: Doc) { const f = resolveFile(r); if (!f) { alert('No file attached to this document.'); return } await downloadFile(sb, f.path, f.name); logAccess('download', r) }

  // ── moving
  async function moveDocs(ids: string[], folderId: string | null) {
    if (!ids.length) return
    const { error } = await sb.from('documents').update({ folder_id: folderId, updated_at: new Date().toISOString() }).in('id', ids)
    if (error) { alert('Move failed: ' + error.message); return }
    setRows(rs => rs.map(r => (ids.includes(r.id) ? { ...r, folder_id: folderId } : r))); setSel(new Set()); setMoveTo('')
  }
  function onDropOnFolder(e: React.DragEvent, folderId: string | null) {
    e.preventDefault(); setDropHint(null)
    const raw = e.dataTransfer.getData('text/x-doc-ids')
    if (raw) { moveDocs(JSON.parse(raw) as string[], folderId); return }
    if (e.dataTransfer.files?.length) { setCur(folderId || UNFILED); setUpload(Array.from(e.dataTransfer.files)) }
  }

  // ── folders
  async function saveFolder() {
    if (!folderDlg) return
    const name = folderDlg.name.trim()
    if (!name) { setFolderErr('Give the folder a name.'); return }
    setFolderErr('')
    const { error } = folderDlg.mode === 'new'
      ? await sb.from('document_folders').insert({ name, parent_id: folderDlg.parentId, created_by: userEmail || null })
      : await sb.from('document_folders').update({ name }).eq('id', folderDlg.id)
    if (error) { setFolderErr(error.code === '23505' ? 'A folder with that name already exists here.' : error.message); return }
    if (folderDlg.parentId) setExpanded(s => new Set(s).add(folderDlg.parentId!))
    setFolderDlg(null); load()
  }
  async function deleteFolder(f: Folder) {
    const n = counts[f.id] || 0
    if (f.system_key) { alert('This folder is used by the Customers / Certifications links and cannot be deleted.'); return }
    if (n > 0 || (kids.get(f.id) || []).length) { alert('Move or delete what is inside this folder first.'); return }
    if (!confirm(`Delete the empty folder "${f.name}"?`)) return
    const { error } = await sb.from('document_folders').delete().eq('id', f.id)
    if (error) { alert(error.message); return }
    setCur(f.parent_id || ALL); load()
  }

  // ── page-wide drop of files → upload into the open folder
  useEffect(() => {
    const has = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files')
    let depth = 0
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth++; setPageDrag(true) }
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault() }
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setPageDrag(false) }
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth = 0; setPageDrag(false); if (e.defaultPrevented && (e.target as HTMLElement)?.closest?.('[data-folder-drop]')) return; const fl = Array.from(e.dataTransfer?.files || []); if (fl.length) setUpload(prev => prev || fl) }
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop) }
  }, [])

  // ── edit modal
  function openAdd() { setEditing(null); setForm({ ...empty, folder_id: curFolder?.id || '' }); setErr(''); setOpen(true) }
  function openEdit(r: Doc) { setEditing(r); setForm({ title: r.title, category: r.category, version: r.version ?? '', effective_date: r.effective_date ?? '', review_date: r.review_date ?? '', status: r.status, owner: r.owner ?? '', customer_id: r.customer_id ?? '', vendor_id: r.vendor_id ?? '', order_id: r.order_id ?? '', certification_id: r.certification_id ?? '', notes: r.notes ?? '', folder_id: r.folder_id ?? '' }); setErr(''); setOpen(true) }
  function close() { setOpen(false); setTimeout(() => { setEditing(null); setForm(empty) }, 250) }
  useItemDeepLink(rows, (r: Doc) => { setCur(r.folder_id || UNFILED); openEdit(r) })
  const formKind = linkKindFor(form.category)

  async function save() {
    if (!form.title.trim()) { setErr('Document title is required.'); return }
    if (formKind === 'customer' && !form.customer_id) { setErr('A “Customer Document” must be linked to a customer.'); return }
    if (formKind === 'certification' && !form.certification_id) { setErr('A “Certificate” must be linked to a certification.'); return }
    setErr(''); setSaving(true)
    let folderId: string | null = form.folder_id || null
    try {
      // a newly linked document with no folder (or still in Unsorted) files itself under the link
      const unsortedId = folders.find(f => f.system_key === 'unsorted')?.id
      if ((!folderId || folderId === unsortedId) && formKind) {
        const nm = formKind === 'customer' ? cmap[form.customer_id] : cemap[form.certification_id]
        if (nm) folderId = await ensureFolder(sb, autoFolderPath(formKind, nm))
      }
    } catch { /* keep the chosen folder */ }
    const p = { title: form.title.trim(), category: form.category, version: form.version.trim() || null, effective_date: form.effective_date || null, review_date: form.review_date || null, status: form.status, owner: form.owner.trim() || null, customer_id: form.customer_id || null, vendor_id: form.vendor_id || null, order_id: form.order_id || null, certification_id: form.certification_id || null, notes: form.notes.trim() || null, folder_id: folderId }
    const { error } = editing ? await sb.from('documents').update({ ...p, updated_at: new Date().toISOString() }).eq('id', editing.id) : await sb.from('documents').insert({ ...p, is_active: true })
    if (error) { setErr(dbErr(error)); setSaving(false); return }
    setSaving(false); await tagRef.current?.sendNotifications(); close(); load()
  }
  async function toggleArchive() { if (!editing) return; setBusy(true); await sb.from('documents').update({ is_active: !editing.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id); setBusy(false); close(); load() }
  async function handleDelete() { if (!editing) return; if (!confirm('Permanently delete this document? This cannot be undone.')) return; const { error } = await sb.from('documents').delete().eq('id', editing.id); if (error) { alert('Delete failed: ' + error.message); return } close(); load() }

  // ── history
  async function loadHistory() { setHistLoading(true); const { data } = await sb.from('file_access_log').select('id,actor_email,action,record_id,document_title,file_name,created_at').eq('record_type', 'documents').order('created_at', { ascending: false }).limit(400); setHist((data || []) as AccessRow[]); setHistLoading(false) }
  useEffect(() => { if (view === 'history') loadHistory() }, [view]) // eslint-disable-line
  const histRows = hist.filter(h => { if (histFilter !== 'all' && h.action !== histFilter) return false; if (!histSearch) return true; const s = histSearch.toLowerCase(); return (h.document_title || '').toLowerCase().includes(s) || (h.file_name || '').toLowerCase().includes(s) || (h.actor_email || '').toLowerCase().includes(s) })

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'
  const fOpts = useMemo(() => folderOptions(folders), [folders])
  const FolderSelect = ({ value, onChange, allowNone = true }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) => (
    <select value={value} onChange={e => onChange(e.target.value)} className={inp + ' cursor-pointer'}>
      {allowNone && <option value="">— No folder —</option>}
      {fOpts.map(o => <option key={o.id} value={o.id}>{'  '.repeat(o.depth * 2)}{o.depth ? '└ ' : ''}{o.label}</option>)}
    </select>
  )

  function TreeNode({ f, depth }: { f: Folder; depth: number }) {
    const ch = kids.get(f.id) || []
    const isOpen = expanded.has(f.id) || descendants.has(f.id) && f.id !== cur
    const active = cur === f.id && !q && !linkFilter
    return (
      <div>
        <div data-folder-drop onDragOver={e => { e.preventDefault(); setDropHint(f.id) }} onDragLeave={() => setDropHint(h => (h === f.id ? null : h))} onDrop={e => onDropOnFolder(e, f.id)}
          className={`group flex items-center gap-1 rounded-lg pr-1 text-sm cursor-pointer ${active ? 'bg-violet-600 text-white' : dropHint === f.id ? 'bg-violet-100' : 'hover:bg-[#F3F4F8] text-[#1A1D2E]'}`}
          style={{ paddingLeft: 6 + depth * 14 }} onClick={() => { setCur(f.id); setLinkFilter(null); setSearch(''); setSel(new Set()) }}>
          <button onClick={e => { e.stopPropagation(); setExpanded(s => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n }) }}
            className={`w-4 text-[11px] ${ch.length ? '' : 'invisible'} ${active ? 'text-white/80' : 'text-gray-400'}`}><i className={`ti ti-chevron-${isOpen ? 'down' : 'right'}`} /></button>
          <i className={`ti ${f.icon || (isOpen && ch.length ? 'ti-folder-open' : 'ti-folder')} ${active ? 'text-white' : 'text-amber-500'}`} />
          <span className="flex-1 truncate py-1.5">{f.name}</span>
          <span className={`text-[10px] ${active ? 'text-white/80' : 'text-gray-400'}`}>{counts[f.id] || ''}</span>
        </div>
        {isOpen && ch.map(k => <TreeNode key={k.id} f={k} depth={depth + 1} />)}
      </div>
    )
  }

  const linkName = linkFilter ? (linkFilter.kind === 'customer' ? cmap[linkFilter.id] : cemap[linkFilter.id]) || '…' : ''
  const allSel = listRows.length > 0 && listRows.every(r => sel.has(r.id))

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-700 border-violet-500/30">BUSINESS DEV</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Documents &amp; Knowledge</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${visible.length} ${archived ? 'archived' : 'active'} documents in ${folders.length} folders`}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ImportExportBar table="documents" filename="documents" columns={[
            { header: 'Title', dbKey: 'title', example: 'Quality Manual v3', required: true },
            { header: 'Category', dbKey: 'category', example: 'Quality Record' },
            { header: 'Version', dbKey: 'version', example: '3.0' },
            { header: 'Effective Date', dbKey: 'effective_date', example: '2024-01-01' },
            { header: 'Review Date', dbKey: 'review_date', example: '2025-01-01' },
            { header: 'Status', dbKey: 'status', example: 'Active' },
            { header: 'Owner', dbKey: 'owner', example: 'Quality Team' },
            { header: 'Customer Name', dbKey: 'customer_name', example: '', lookup: { fromTable: 'customers', matchField: 'company_name', storeAs: 'customer_id' } },
            { header: 'Vendor Name', dbKey: 'vendor_name', example: '', lookup: { fromTable: 'vendors', matchField: 'company_name', storeAs: 'vendor_id' } },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={() => { setFolderErr(''); setFolderDlg({ mode: 'new', parentId: curFolder?.id || null, name: '' }) }} className="flex items-center gap-2 bg-white border border-[#E4E6EE] hover:border-violet-500/40 hover:text-violet-600 text-gray-600 text-sm font-medium px-4 py-2.5 rounded-lg"><i className="ti ti-folder-plus" />New folder</button>
          <button onClick={openAdd} className="flex items-center gap-2 bg-white border border-[#E4E6EE] hover:border-violet-500/40 hover:text-violet-600 text-gray-600 text-sm font-medium px-4 py-2.5 rounded-lg"><i className="ti ti-plus" />Add record</button>
          <button onClick={() => setUpload([])} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"><i className="ti ti-cloud-upload" />Upload</button>
        </div>
      </div>
      <KnowledgeCenter />
      <div className="flex items-center gap-1 mb-4 bg-white border border-[#E4E6EE] rounded-lg p-1 w-fit">
        <button onClick={() => setView('board')} className={`flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-md ${view === 'board' ? 'bg-violet-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}><i className="ti ti-folders text-sm" />Folders</button>
        <button onClick={() => setView('history')} className={`flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-md ${view === 'history' ? 'bg-violet-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}><i className="ti ti-history text-sm" />History</button>
      </div>

      {view === 'history' ? (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm"><i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" /><input placeholder="Search by document, file, or user…" value={histSearch} onChange={e => setHistSearch(e.target.value)} className={inp + ' pl-9'} /></div>
            <div className="flex items-center gap-1">{(['all', 'upload', 'view', 'download'] as const).map(f => <button key={f} onClick={() => setHistFilter(f)} className={`text-xs font-medium px-3 py-1.5 rounded-full border ${histFilter === f ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-[#E4E6EE]'}`}>{f === 'all' ? 'All' : AC[f].label + 's'}</button>)}</div>
          </div>
          {histLoading ? <p className="text-sm text-gray-400 py-10 text-center">Loading…</p> : histRows.length === 0 ? <p className="text-sm text-gray-400 py-10 text-center">No file activity yet.</p> :
            <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-hidden divide-y divide-[#F0F1F5] max-h-[65vh] overflow-y-auto">
              {histRows.map(h => { const a = AC[h.action] || AC.view; return <div key={h.id} className="grid grid-cols-1 md:grid-cols-[110px_1fr_1fr_1fr_170px] gap-1 md:gap-3 px-5 py-2.5 text-sm">
                <span><span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${a.cls}`}><i className={`ti ${a.icon} text-[11px]`} />{a.label}</span></span>
                <span className="font-medium truncate">{h.document_title || '—'}</span><span className="text-gray-500 truncate">{h.file_name || '—'}</span><span className="text-gray-500 truncate">{h.actor_email || 'Unknown'}</span>
                <span className="text-gray-400 text-xs">{new Date(h.created_at).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div> })}
            </div>}
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* folder tree */}
          <aside className="lg:w-72 shrink-0 bg-white rounded-xl border border-[#E4E6EE] p-2 lg:sticky lg:top-4 self-start max-h-[80vh] overflow-y-auto">
            <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer ${cur === ALL && !q && !linkFilter ? 'bg-violet-600 text-white' : 'hover:bg-[#F3F4F8]'}`} onClick={() => { setCur(ALL); setLinkFilter(null); setSearch('') }}>
              <i className="ti ti-folders" /><span className="flex-1 font-semibold">All folders</span><span className="text-[10px] opacity-70">{visible.length}</span></div>
            <div className="my-1 border-t border-[#F0F1F5]" />
            {(kids.get(null) || []).map(f => <TreeNode key={f.id} f={f} depth={0} />)}
            {unfiled > 0 && <div data-folder-drop onDragOver={e => { e.preventDefault(); setDropHint(UNFILED) }} onDrop={e => onDropOnFolder(e, null)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer mt-1 ${cur === UNFILED ? 'bg-violet-600 text-white' : 'hover:bg-[#F3F4F8] text-gray-500'}`} onClick={() => { setCur(UNFILED); setLinkFilter(null); setSearch('') }}>
              <i className="ti ti-inbox" /><span className="flex-1">No folder</span><span className="text-[10px]">{unfiled}</span></div>}
            <p className="text-[10px] text-gray-400 px-2 pt-2">Drag documents onto a folder to move them. Drop files anywhere to upload into the open folder.</p>
          </aside>

          {/* folder contents */}
          <section className="flex-1 min-w-0">
            <div className="bg-white rounded-xl border border-[#E4E6EE]">
              <div className="px-4 py-3 border-b border-[#F0F1F5] flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-1 text-sm flex-wrap">
                  {linkFilter ? <span className="font-semibold text-[#1A1D2E]"><i className={`ti ${linkFilter.kind === 'customer' ? 'ti-user' : 'ti-rosette'} text-violet-500 mr-1`} />Linked to {linkName} <button onClick={() => setLinkFilter(null)} className="ml-1 text-xs text-violet-600 font-normal hover:underline">clear</button></span>
                    : q ? <span className="font-semibold text-[#1A1D2E]">Search results across all folders</span>
                    : <>
                      <button onClick={() => setCur(ALL)} className="text-gray-500 hover:text-violet-600">All folders</button>
                      {cur === UNFILED && <><i className="ti ti-chevron-right text-gray-300 text-xs" /><span className="font-semibold">No folder</span></>}
                      {crumbs.map((c, i) => <span key={c.id} className="flex items-center gap-1"><i className="ti ti-chevron-right text-gray-300 text-xs" />{i === crumbs.length - 1 ? <span className="font-semibold text-[#1A1D2E]">{c.name}</span> : <button onClick={() => setCur(c.id)} className="text-gray-500 hover:text-violet-600">{c.name}</button>}</span>)}
                    </>}
                </div>
                {curFolder && !q && !linkFilter && <div className="flex items-center gap-1">
                  <button onClick={() => { setFolderErr(''); setFolderDlg({ mode: 'new', parentId: curFolder.id, name: '' }) }} className="text-xs px-2 py-1 rounded-md border border-[#E4E6EE] text-gray-600 hover:border-violet-400"><i className="ti ti-folder-plus mr-1" />Sub-folder</button>
                  <button onClick={() => { setFolderErr(''); setFolderDlg({ mode: 'rename', parentId: curFolder.parent_id, id: curFolder.id, name: curFolder.name }) }} className="text-xs px-2 py-1 rounded-md border border-[#E4E6EE] text-gray-600 hover:border-violet-400"><i className="ti ti-pencil" /></button>
                  {!curFolder.system_key && <button onClick={() => deleteFolder(curFolder)} className="text-xs px-2 py-1 rounded-md border border-[#E4E6EE] text-gray-400 hover:text-red-600 hover:border-red-300"><i className="ti ti-trash" /></button>}
                </div>}
                <div className="relative w-full sm:w-64"><i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" /><input placeholder="Search every folder…" value={search} onChange={e => setSearch(e.target.value)} className={inp + ' pl-9 py-2'} /></div>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Archived</label>
              </div>

              {sel.size > 0 && <div className="px-4 py-2 bg-violet-50 border-b border-violet-100 flex flex-wrap items-center gap-2 text-sm">
                <b className="text-violet-800">{sel.size} selected</b>
                <span className="text-gray-500">Move to</span>
                <div className="w-64"><FolderSelect value={moveTo} onChange={setMoveTo} allowNone={false} /></div>
                <button disabled={!moveTo} onClick={() => moveDocs(Array.from(sel), moveTo)} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold disabled:opacity-40">Move</button>
                <button onClick={() => setSel(new Set())} className="text-xs text-gray-500 hover:underline">Clear</button>
              </div>}

              {loading ? <p className="text-sm text-gray-400 py-16 text-center">Loading…</p> : <>
                {subFolders.length > 0 && <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 p-4 border-b border-[#F0F1F5]">
                  {subFolders.map(f => (
                    <button key={f.id} data-folder-drop onClick={() => setCur(f.id)} onDragOver={e => { e.preventDefault(); setDropHint(f.id) }} onDragLeave={() => setDropHint(null)} onDrop={e => onDropOnFolder(e, f.id)}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ${dropHint === f.id ? 'border-violet-500 bg-violet-50' : 'border-[#ECEEF3] hover:border-violet-300 hover:bg-[#FAFAFE]'}`}>
                      <i className={`ti ${f.icon || 'ti-folder'} text-2xl text-amber-500`} />
                      <span className="min-w-0"><span className="block text-sm font-semibold text-[#1A1D2E] truncate">{f.name}</span><span className="text-[11px] text-gray-400">{counts[f.id] || 0} document{(counts[f.id] || 0) === 1 ? '' : 's'}</span></span>
                    </button>))}
                </div>}
                {listRows.length === 0 ? (
                  <div className="py-14 text-center text-sm text-gray-400">
                    {q ? 'No documents match.' : linkFilter ? 'Nothing linked yet.' : cur === ALL ? `Open a folder, or search across all ${visible.length} documents.` : subFolders.length ? 'No documents directly in this folder — open a sub-folder above.' : 'This folder is empty. Drop files here or click Upload.'}
                  </div>
                ) : (
                  <div>
                    <div className="hidden md:grid grid-cols-[28px_1fr_140px_200px_110px_84px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-400 font-semibold bg-[#FAFBFD]">
                      <input type="checkbox" checked={allSel} onChange={e => setSel(e.target.checked ? new Set(listRows.map(r => r.id)) : new Set())} />
                      <span>Name</span><span>Category</span><span>{q || linkFilter || cur === ALL ? 'Folder' : 'Linked to'}</span><span>Updated</span><span />
                    </div>
                    <div className="divide-y divide-[#F0F1F5]">
                      {listRows.map(r => {
                        const fi = fileIcon(r), f = resolveFile(r), due = isDueForReview(r.review_date, r.status)
                        return (
                          <div key={r.id} id={'item-' + r.id} draggable onDragStart={e => { const ids = sel.has(r.id) ? Array.from(sel) : [r.id]; e.dataTransfer.setData('text/x-doc-ids', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'move' }}
                            className={`grid grid-cols-[28px_1fr_auto] md:grid-cols-[28px_1fr_140px_200px_110px_84px] gap-3 items-center px-4 py-2 hover:bg-[#FAFAFE] ${sel.has(r.id) ? 'bg-violet-50/60' : ''}`}>
                            <input type="checkbox" checked={sel.has(r.id)} onChange={e => setSel(s => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n })} />
                            <button onClick={() => openEdit(r)} className="flex items-center gap-2.5 min-w-0 text-left">
                              <i className={`ti ${fi.icon} text-xl shrink-0`} style={{ color: fi.color }} />
                              <span className="min-w-0"><span className="block text-sm font-medium text-[#1A1D2E] truncate">{r.title}{r.version ? <span className="ml-1 text-[10px] text-gray-400 font-mono">v{r.version}</span> : null}</span>
                                <span className="block text-[11px] text-gray-400 truncate">{f?.name || 'No file attached'}{r.status !== 'Active' ? ` · ${r.status}` : ''}{due ? ' · review due' : ''}{r.ai_summary ? ` · ${r.ai_summary.slice(0, 80)}` : ''}</span></span>
                            </button>
                            <span className="hidden md:block"><span className="text-[11px] px-2 py-0.5 rounded-full border border-[#E4E6EE] text-gray-600">{r.category}</span></span>
                            <span className="hidden md:block text-[12px] text-gray-500 truncate">
                              {q || linkFilter || cur === ALL ? folderLabel(folders, r.folder_id) : <>
                                {r.customer_id && cmap[r.customer_id] && <span className="mr-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700"><i className="ti ti-user" />{cmap[r.customer_id]}</span>}
                                {r.certification_id && cemap[r.certification_id] && <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><i className="ti ti-rosette" />{cemap[r.certification_id]}</span>}
                                {!r.customer_id && !r.certification_id && <span className="text-gray-300">—</span>}</>}
                            </span>
                            <span className="hidden md:block text-[12px] text-gray-400">{new Date(r.updated_at || r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            <span className="flex items-center gap-0.5 justify-end">
                              <button onClick={() => viewFile(r)} disabled={!f} title="View" className="p-1.5 rounded-md text-gray-400 hover:text-violet-600 disabled:opacity-30"><i className="ti ti-eye" /></button>
                              <button onClick={() => downloadDoc(r)} disabled={!f} title="Download" className="p-1.5 rounded-md text-gray-400 hover:text-violet-600 disabled:opacity-30"><i className="ti ti-download" /></button>
                            </span>
                          </div>)
                      })}
                    </div>
                  </div>
                )}
              </>}
            </div>
          </section>
        </div>
      )}

      {pageDrag && !upload && <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-violet-600/10 border-4 border-dashed border-violet-400">
        <div className="bg-white rounded-2xl shadow-xl px-6 py-4 text-sm font-semibold text-violet-700"><i className="ti ti-cloud-upload mr-2" />Drop to upload into {curFolder ? folderLabel(folders, curFolder.id) : 'the repository'}</div></div>}

      {upload && <DocUploadDialog sb={sb} userEmail={userEmail} folders={folders} categories={catNames} initialFiles={upload}
        customers={customers.map(c => ({ id: c.id, name: c.company_name || '' }))} certifications={certs.map(c => ({ id: c.id, name: c.cert_name || 'Certification' }))}
        defaults={{ folderId: curFolder?.id || null, category: linkFilter?.kind === 'customer' ? 'Customer Document' : linkFilter?.kind === 'certification' ? 'Certificate' : 'Other', customerId: linkFilter?.kind === 'customer' ? linkFilter.id : null, certificationId: linkFilter?.kind === 'certification' ? linkFilter.id : null }}
        onClose={() => setUpload(null)} onDone={() => { setUpload(null); load() }} />}

      {folderDlg && <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => setFolderDlg(null)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <h3 className="font-semibold text-[#1A1D2E] flex items-center gap-2 mb-1"><i className="ti ti-folder-plus text-violet-500" />{folderDlg.mode === 'new' ? 'New folder' : 'Rename folder'}</h3>
          <p className="text-xs text-gray-400 mb-3">{folderDlg.mode === 'new' ? `Inside: ${folderDlg.parentId ? folderLabel(folders, folderDlg.parentId) : 'top level'}` : ''}</p>
          {folderDlg.mode === 'new' && <div className="mb-3"><label className="block text-xs text-gray-500 mb-1">Put it inside</label><FolderSelect value={folderDlg.parentId || ''} onChange={v => setFolderDlg(d => d && { ...d, parentId: v || null })} /></div>}
          <input autoFocus value={folderDlg.name} onChange={e => setFolderDlg(d => d && { ...d, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') saveFolder() }} placeholder="Folder name" className={inp} />
          {folderErr && <p className="text-xs text-red-600 mt-2">{folderErr}</p>}
          <div className="flex gap-3 mt-5"><button onClick={() => setFolderDlg(null)} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button><button onClick={saveFolder} className="flex-1 bg-violet-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">{folderDlg.mode === 'new' ? 'Create' : 'Save'}</button></div>
        </div>
      </div>}

      {/* record window */}
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close} />
      <div onClick={e => e.stopPropagation()} className={`fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] md:w-full md:max-w-[600px] max-h-[90vh] bg-white rounded-2xl border border-[#E4E6EE] flex flex-col shadow-2xl overflow-hidden transition-all duration-200 ${open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E6EE] shrink-0"><div><h2 className="text-[#1A1D2E] font-semibold">{editing ? 'Document' : 'Add document record'}</h2>{editing && <p className="text-[11px] text-gray-400">{folderLabel(folders, editing.folder_id)}</p>}</div><div className="flex items-center gap-2">{editing && <ShareLink id={editing.id} />}<button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]"><i className="ti ti-x" /></button></div></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {editing && resolveFile(editing) && <div className="flex items-center gap-2 bg-[#F9FAFB] border border-[#E4E6EE] rounded-lg px-3 py-2.5">
            <i className="ti ti-file text-violet-500 text-lg" /><span className="flex-1 text-xs truncate">{resolveFile(editing)?.name}</span>
            <button onClick={() => viewFile(editing)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-600"><i className="ti ti-eye mr-1" />View</button>
            <button onClick={() => downloadDoc(editing)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-600"><i className="ti ti-download mr-1" />Download</button></div>}
          <div><label className="block text-xs text-gray-400 mb-1.5">Title <span className="text-red-400">*</span></label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Category</label><select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp + ' cursor-pointer'}>{(catNames.includes(form.category) ? catNames : [...catNames, form.category]).map(s => <option key={s}>{s}</option>)}</select></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Folder</label><FolderSelect value={form.folder_id} onChange={v => setForm(p => ({ ...p, folder_id: v }))} /></div>
          </div>
          {formKind && <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2.5 space-y-2">
            <p className="text-[12px] text-violet-800"><i className="ti ti-link mr-1" />“{form.category}” is linked to a {formKind === 'customer' ? 'customer — it shows on the Customers board' : 'certification — it shows on the Certifications board'}.</p>
            {formKind === 'customer' ? <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={inp}><option value="">— Pick a customer —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
              : <select value={form.certification_id} onChange={e => setForm(p => ({ ...p, certification_id: e.target.value }))} className={inp}><option value="">— Pick a certification —</option>{certs.map(c => <option key={c.id} value={c.id}>{c.cert_name}</option>)}</select>}
          </div>}
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs text-gray-400 mb-1.5">Version</label><input value={form.version} placeholder="1.0" onChange={e => setForm(p => ({ ...p, version: e.target.value }))} className={inp} /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Effective</label><input type="date" value={form.effective_date} onChange={e => setForm(p => ({ ...p, effective_date: e.target.value }))} className={inp} /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Review by</label><input type="date" value={form.review_date} onChange={e => setForm(p => ({ ...p, review_date: e.target.value }))} className={inp} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp + ' cursor-pointer'}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Owner</label><input value={form.owner} onChange={e => setForm(p => ({ ...p, owner: e.target.value }))} className={inp} /></div>
          </div>
          <details className="rounded-lg border border-[#ECEEF3] px-3 py-2" open={!formKind && !!(form.customer_id || form.certification_id || form.vendor_id || form.order_id)}>
            <summary className="text-xs font-semibold text-gray-500 cursor-pointer"><i className="ti ti-link text-violet-500 mr-1" />Other links (optional)</summary>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {formKind !== 'customer' && <div><label className="block text-xs text-gray-400 mb-1">Customer</label><select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={inp}><option value="">— None —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></div>}
              {formKind !== 'certification' && <div><label className="block text-xs text-gray-400 mb-1">Certification</label><select value={form.certification_id} onChange={e => setForm(p => ({ ...p, certification_id: e.target.value }))} className={inp}><option value="">— None —</option>{certs.map(c => <option key={c.id} value={c.id}>{c.cert_name}</option>)}</select></div>}
              <div><label className="block text-xs text-gray-400 mb-1">Vendor</label><select value={form.vendor_id} onChange={e => setForm(p => ({ ...p, vendor_id: e.target.value }))} className={inp}><option value="">— None —</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}</select></div>
              <div><label className="block text-xs text-gray-400 mb-1">Sales order</label><select value={form.order_id} onChange={e => setForm(p => ({ ...p, order_id: e.target.value }))} className={inp}><option value="">— None —</option>{orders.map(o => <option key={o.id} value={o.id}>{o.order_number || 'Order'}</option>)}</select></div>
            </div>
          </details>
          <TagInput ref={tagRef} value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} page="Documents" recordType="document" recordId={editing?.id} className={inp + ' resize-none'} />
          {editing && <>
            <div className="border-t border-[#E4E6EE] pt-4"><FileUpload supabase={sb} recordType="documents" recordId={editing.id} currentUserEmail={userEmail} /></div>
            <DocAI documentId={editing.id} />
            <div className="border-t border-[#E4E6EE] pt-4"><Comments recordType="document" recordId={editing.id} currentUserEmail={userEmail} /><ItemHistory recordId={editing.id} recordType="document" /></div>
          </>}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-3">
            {editing && <button onClick={handleDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500" title="Delete"><i className="ti ti-trash" /></button>}
            {editing && <button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 disabled:opacity-50">{editing.is_active ? 'Archive' : 'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
