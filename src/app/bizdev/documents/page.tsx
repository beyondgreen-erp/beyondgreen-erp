'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'

interface Customer { id: string; company_name: string }
interface Vendor { id: string; company_name: string }
interface Doc { id: string; title: string; category: string; version: string | null; effective_date: string | null; review_date: string | null; status: string; owner: string | null; customer_id: string | null; vendor_id: string | null; notes: string | null; is_active: boolean }
const CATEGORIES = ['Contract','Spec Sheet','Certificate','SDS','Quality Record','Drawing','Policy','Other']
const STATUSES = ['Active','Under Review','Archived']
const SC: Record<string,string> = { Active:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', 'Under Review':'bg-amber-500/15 text-amber-400 border-amber-500/20', Archived:'bg-gray-700/40 text-gray-400 border-gray-700' }
const CC: Record<string,string> = { Contract:'bg-blue-500/15 text-blue-400 border-blue-500/20', 'Spec Sheet':'bg-violet-500/15 text-violet-400 border-violet-500/20', Certificate:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', SDS:'bg-amber-500/15 text-amber-400 border-amber-500/20', 'Quality Record':'bg-teal-500/15 text-teal-400 border-teal-500/20', Drawing:'bg-sky-500/15 text-sky-400 border-sky-500/20', Policy:'bg-pink-500/15 text-pink-400 border-pink-500/20', Other:'bg-gray-700/40 text-gray-400 border-gray-700' }
const empty = { title:'', category:'Other', version:'', effective_date:'', review_date:'', status:'Active', owner:'', customer_id:'', vendor_id:'', notes:'' }
type F = typeof empty
const fmtD=(d:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}
function isDueForReview(review:string|null,status:string){return review&&status!=='Archived'&&new Date(review+'T00:00:00')<=new Date(new Date().toDateString())}

export default function DocumentsPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<Doc[]>([])
  const [customers,setCustomers]=useState<Customer[]>([])
  const [vendors,setVendors]=useState<Vendor[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<Doc|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const [userEmail,setUserEmail]=useState('')
  const ref=useRef<HTMLDivElement>(null)
  const tagRef=useRef<TagInputHandle>(null)

  async function load(){
    setLoading(true)
    const [{data:docs},{data:c},{data:v}]=await Promise.all([
      sb.from('documents').select('*').order('title',{ascending:true}),
      sb.from('customers').select('id,company_name').eq('is_active',true).order('company_name'),
      sb.from('vendors').select('id,company_name').eq('is_active',true).order('company_name'),
    ])
    if(docs) setRows(docs as Doc[])
    if(c) setCustomers(c as Customer[])
    if(v) setVendors(v as Vendor[])
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
  },[]) // eslint-disable-line

  const cmap=Object.fromEntries(customers.map(c=>[c.id,c.company_name]))
  const vmap=Object.fromEntries(vendors.map(v=>[v.id,v.company_name]))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.title.toLowerCase().includes(q)||r.category.toLowerCase().includes(q)||r.status.toLowerCase().includes(q)||(r.owner||'').toLowerCase().includes(q)||(r.version||'').toLowerCase().includes(q)||(r.customer_id?cmap[r.customer_id]||'':'').toLowerCase().includes(q)||(r.vendor_id?vmap[r.vendor_id]||'':'').toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm(empty);setErr('');setOpen(true)}
  function openEdit(r:Doc){setEditing(r);setForm({title:r.title,category:r.category,version:r.version??'',effective_date:r.effective_date??'',review_date:r.review_date??'',status:r.status,owner:r.owner??'',customer_id:r.customer_id??'',vendor_id:r.vendor_id??'',notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}

  async function save(){
    if(!form.title.trim()){setErr('Document Title is required.');return}
    setErr('');setSaving(true)
    const p={title:form.title.trim(),category:form.category,version:form.version.trim()||null,effective_date:form.effective_date||null,review_date:form.review_date||null,status:form.status,owner:form.owner.trim()||null,customer_id:form.customer_id||null,vendor_id:form.vendor_id||null,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('documents').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('documents').insert({...p,is_active:true})
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);await tagRef.current?.sendNotifications();close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('documents').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}
  async function handleDelete(){if(!editing)return;if(!confirm('Permanently delete this document? This cannot be undone.'))return;const{error}=await sb.from('documents').delete().eq('id',editing.id);if(error){alert('Delete failed: '+error.message);return}close();load()}

  const inp='w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">BUSINESS DEV</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Documents</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} document${filtered.length!==1?'s':''}`}</p>
        </div>
        <div className="flex items-center gap-2">
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
          <button onClick={openAdd} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Document</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input placeholder="Search documents…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-violet-600':'bg-gray-700'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Show Archived</span></label>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived documents.':'No documents yet.'}</p></div>
        :<table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-gray-800">{['Title','Category','Version','Effective Date','Review Date','Status','Owner','Customer','Vendor'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>)}</tr></thead>
        <tbody>{filtered.map((r,i)=>{
          const reviewDue=isDueForReview(r.review_date,r.status)
          return <tr key={r.id} onClick={()=>openEdit(r)} className={`border-b border-gray-800/60 last:border-0 cursor-pointer transition-colors ${reviewDue?'bg-amber-500/5 hover:bg-amber-500/10':i%2===0?'hover:bg-gray-800/40':'bg-gray-800/10 hover:bg-gray-800/40'}`}>
            <td className="px-5 py-3.5 text-white font-medium">{r.title}</td>
            <td className="px-5 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${CC[r.category]||CC.Other}`}>{r.category}</span></td>
            <td className="px-5 py-3.5 text-gray-400 font-mono text-xs">{r.version||'—'}</td>
            <td className="px-5 py-3.5 text-gray-400">{fmtD(r.effective_date)}</td>
            <td className={`px-5 py-3.5 text-sm ${reviewDue?'text-amber-400 font-medium':'text-gray-400'}`}>{fmtD(r.review_date)}{reviewDue&&<span className="ml-1.5 text-xs text-amber-500">Review Due</span>}</td>
            <td className="px-5 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.status]||SC.Active}`}>{r.status}</span></td>
            <td className="px-5 py-3.5 text-gray-400">{r.owner||'—'}</td>
            <td className="px-5 py-3.5 text-gray-400">{r.customer_id?cmap[r.customer_id]||'—':'—'}</td>
            <td className="px-5 py-3.5 text-gray-400">{r.vendor_id?vmap[r.vendor_id]||'—':'—'}</td>
          </tr>
        })}</tbody></table>}
      </div>
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0"><h2 className="text-white font-semibold">{editing?'Edit Document':'Add Document'}</h2><button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">Document Title <span className="text-red-400">*</span></label><input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} className={inp}/></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Category</label><select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))} className={inp+' cursor-pointer'}>{CATEGORIES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Version</label><input value={form.version} placeholder="e.g. 1.0" onChange={e=>setForm(p=>({...p,version:e.target.value}))} className={inp}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Effective Date</label><input type="date" value={form.effective_date} onChange={e=>setForm(p=>({...p,effective_date:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Review Date</label><input type="date" value={form.review_date} onChange={e=>setForm(p=>({...p,review_date:e.target.value}))} className={inp}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>{STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Owner</label><input value={form.owner} onChange={e=>setForm(p=>({...p,owner:e.target.value}))} className={inp}/></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Linked Customer</label><select value={form.customer_id} onChange={e=>setForm(p=>({...p,customer_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Linked Vendor</label><select value={form.vendor_id} onChange={e=>setForm(p=>({...p,vendor_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.company_name}</option>)}</select></div>
          <TagInput ref={tagRef} value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} page="Documents" className={inp+' resize-none'}/>
          {editing&&(<>
            <div className="border-t border-gray-800 pt-4"><FileUpload supabase={sb} recordType="documents" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-gray-800 pt-4"><CommentSection recordType="documents" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={handleDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Delete"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>}
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
