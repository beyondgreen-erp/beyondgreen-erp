'use client'
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
import QuickUpload from '@/components/QuickUpload'

interface Customer { id: string; company_name: string }
interface Vendor { id: string; company_name: string }
interface Order { id: string; order_number: string | null }
interface Cert { id: string; cert_name: string | null }
interface Doc { id: string; title: string; category: string; version: string | null; effective_date: string | null; review_date: string | null; status: string; owner: string | null; customer_id: string | null; vendor_id: string | null; order_id: string | null; certification_id: string | null; source_file_path: string | null; notes: string | null; is_active: boolean; ai_summary: string | null; ai_key_facts: string[] | null; ai_suggested_category: string | null; ai_processed_at: string | null }
const CATEGORIES = ['Contract','Spec Sheet','Certificate','SDS','Quality Record','Drawing','Policy','Other']
const STATUSES = ['Active','Under Review','Archived']
const SC: Record<string,string> = { Active:'bg-emerald-500/15 text-emerald-600 border-emerald-500/20', 'Under Review':'bg-amber-500/15 text-amber-600 border-amber-500/20', Archived:'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]' }
const CC: Record<string,string> = { Contract:'bg-blue-500/15 text-blue-600 border-blue-500/20', 'Spec Sheet':'bg-violet-500/15 text-violet-600 border-violet-500/20', Certificate:'bg-emerald-500/15 text-emerald-600 border-emerald-500/20', SDS:'bg-amber-500/15 text-amber-600 border-amber-500/20', 'Quality Record':'bg-teal-500/15 text-teal-600 border-teal-500/20', Drawing:'bg-sky-500/15 text-sky-600 border-sky-500/20', Policy:'bg-pink-500/15 text-pink-600 border-pink-500/20', Other:'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]' }
const empty = { title:'', category:'Other', version:'', effective_date:'', review_date:'', status:'Active', owner:'', customer_id:'', vendor_id:'', order_id:'', certification_id:'', notes:'' }
type F = typeof empty
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}
function isDueForReview(review:string|null,status:string){return review&&status!=='Archived'&&new Date(review+'T00:00:00')<=new Date(new Date().toDateString())}
function Chip({icon,text,cls}:{icon:string;text:string;cls:string}){return <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cls}`}><i className={`ti ${icon} text-[11px]`}/>{text}</span>}

export default function DocumentsPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<Doc[]>([])
  const [customers,setCustomers]=useState<Customer[]>([])
  const [vendors,setVendors]=useState<Vendor[]>([])
  const [orders,setOrders]=useState<Order[]>([])
  const [certs,setCerts]=useState<Cert[]>([])
  const [fileMap,setFileMap]=useState<Record<string,{path:string;name:string}>>({})
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set())
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
    const [{data:docs},{data:c},{data:v},{data:o},{data:ce},{data:atts}]=await Promise.all([
      sb.from('documents').select('*').order('title',{ascending:true}),
      sb.from('customers').select('id,company_name').eq('is_active',true).order('company_name'),
      sb.from('vendors').select('id,company_name').eq('is_active',true).order('company_name'),
      sb.from('sales_orders').select('id,order_number').order('created_at',{ascending:false}).limit(800),
      sb.from('certifications').select('id,cert_name').eq('is_active',true).order('cert_name'),
      sb.from('file_attachments').select('record_id,storage_path,file_name,created_at').eq('record_type','documents').order('created_at',{ascending:false}),
    ])
    if(docs) setRows(docs as Doc[])
    if(c) setCustomers(c as Customer[])
    if(v) setVendors(v as Vendor[])
    if(o) setOrders(o as Order[])
    if(ce) setCerts(ce as Cert[])
    const fm:Record<string,{path:string;name:string}>={}
    for(const a of (atts||[]) as {record_id:string;storage_path:string;file_name:string}[]){ if(!fm[a.record_id]) fm[a.record_id]={path:a.storage_path,name:a.file_name} }
    setFileMap(fm)
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
  },[]) // eslint-disable-line

  const cmap=Object.fromEntries(customers.map(c=>[c.id,c.company_name]))
  const vmap=Object.fromEntries(vendors.map(v=>[v.id,v.company_name]))
  const omap=Object.fromEntries(orders.map(o=>[o.id,o.order_number||'Order']))
  const cemap=Object.fromEntries(certs.map(c=>[c.id,c.cert_name||'Certification']))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.title.toLowerCase().includes(q)||r.category.toLowerCase().includes(q)||r.status.toLowerCase().includes(q)||(r.owner||'').toLowerCase().includes(q)||(r.version||'').toLowerCase().includes(q)||(r.ai_summary||'').toLowerCase().includes(q)||(r.customer_id?cmap[r.customer_id]||'':'').toLowerCase().includes(q)||(r.vendor_id?vmap[r.vendor_id]||'':'').toLowerCase().includes(q)||(r.order_id?omap[r.order_id]||'':'').toLowerCase().includes(q)||(r.certification_id?cemap[r.certification_id]||'':'').toLowerCase().includes(q)
  })
  const groups=useMemo(()=>{
    const byCat:Record<string,Doc[]>={}
    for(const r of filtered){ if(!byCat[r.category]) byCat[r.category]=[]; byCat[r.category].push(r) }
    return Object.keys(byCat).sort((a,b)=>{const ia=CATEGORIES.indexOf(a),ib=CATEGORIES.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b)}).map(cat=>({cat,docs:byCat[cat]}))
  },[filtered]) // eslint-disable-line
  function toggleCat(cat:string){setCollapsed(prev=>{const n=new Set(prev);if(n.has(cat))n.delete(cat);else n.add(cat);return n})}

  function resolveFile(r:Doc){ const fa=fileMap[r.id]; if(fa) return fa; if(r.source_file_path) return {path:r.source_file_path,name:r.source_file_path.split('/').pop()||'file'}; return null }
  function hasFile(r:Doc){ return !!resolveFile(r) }
  async function viewFile(r:Doc){ const f=resolveFile(r); if(!f){alert('No file attached to this document.');return} const url=await getFileUrl(sb,f.path); if(url) window.open(url,'_blank'); else alert('Could not open the file.') }
  async function downloadDoc(r:Doc){ const f=resolveFile(r); if(!f){alert('No file attached to this document.');return} await downloadFile(sb,f.path,f.name) }

  function openAdd(){setEditing(null);setForm(empty);setErr('');setOpen(true)}
  function openEdit(r:Doc){setEditing(r);setForm({title:r.title,category:r.category,version:r.version??'',effective_date:r.effective_date??'',review_date:r.review_date??'',status:r.status,owner:r.owner??'',customer_id:r.customer_id??'',vendor_id:r.vendor_id??'',order_id:r.order_id??'',certification_id:r.certification_id??'',notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}
  useItemDeepLink(rows, openEdit)

  async function save(){
    if(!form.title.trim()){setErr('Document Title is required.');return}
    setErr('');setSaving(true)
    const p={title:form.title.trim(),category:form.category,version:form.version.trim()||null,effective_date:form.effective_date||null,review_date:form.review_date||null,status:form.status,owner:form.owner.trim()||null,customer_id:form.customer_id||null,vendor_id:form.vendor_id||null,order_id:form.order_id||null,certification_id:form.certification_id||null,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('documents').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('documents').insert({...p,is_active:true})
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);await tagRef.current?.sendNotifications();close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('documents').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}
  async function handleDelete(){if(!editing)return;if(!confirm('Permanently delete this document? This cannot be undone.'))return;const{error}=await sb.from('documents').delete().eq('id',editing.id);if(error){alert('Delete failed: '+error.message);return}close();load()}

  const inp='w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'
  const iconBtn='p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-500/10 transition-colors'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-700 border-violet-500/30">BUSINESS DEV</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Documents &amp; Knowledge</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} document${filtered.length!==1?'s':''} in ${groups.length} categor${groups.length!==1?'ies':'y'}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <QuickUpload sb={sb} userEmail={userEmail} onDone={load} />
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
          <button onClick={openAdd} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"><i className="ti ti-plus"/>Add Document</button>
        </div>
      </div>
      <KnowledgeCenter />
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"/><input placeholder="Search documents, summaries, links…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-violet-600':'bg-[#F5F6FA]'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Show Archived</span></label>
      </div>
      {loading?<div className="rounded-xl border border-[#E4E6EE] bg-white flex items-center justify-center py-20"><i className="ti ti-loader-2 animate-spin text-gray-400 text-xl"/></div>
      :groups.length===0?<div className="rounded-xl border border-[#E4E6EE] bg-white flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived documents.':'No documents yet — drop a file with Quick Upload to get started.'}</p></div>
      :<div className="space-y-3">{groups.map(g=>{
        const isCol=collapsed.has(g.cat)
        return <div key={g.cat} className="rounded-xl border border-[#E4E6EE] bg-white overflow-hidden">
          <button onClick={()=>toggleCat(g.cat)} className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-[#F9FAFB] transition-colors text-left">
            <i className={`ti ti-chevron-${isCol?'right':'down'} text-gray-400`}/>
            <span className={`text-xs px-2 py-1 rounded-full font-medium border ${CC[g.cat]||CC.Other}`}>{g.cat}</span>
            <span className="text-sm text-gray-500">{g.docs.length} document{g.docs.length!==1?'s':''}</span>
          </button>
          {!isCol&&<div className="divide-y divide-[#E4E6EE]/60 border-t border-[#E4E6EE]">{g.docs.map(r=>{
            const reviewDue=isDueForReview(r.review_date,r.status)
            return <div key={r.id} className={`px-5 py-3.5 transition-colors ${reviewDue?'bg-amber-500/[0.04] hover:bg-amber-500/10':'hover:bg-[#F9FAFB]'}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={()=>openEdit(r)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[#1A1D2E] font-medium">{r.title}</span>
                    {r.version&&<span className="text-xs text-gray-400 font-mono">v{r.version}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${SC[r.status]||SC.Active}`}>{r.status}</span>
                    {reviewDue&&<span className="text-xs text-amber-500 font-medium">Review due</span>}
                    {r.ai_processed_at&&<span title="Analyzed by AI" className="text-violet-500"><i className="ti ti-sparkles text-xs"/></span>}
                    {hasFile(r)&&<span title="File attached" className="text-gray-400"><i className="ti ti-paperclip text-xs"/></span>}
                  </div>
                  {r.ai_summary&&<p className="text-xs text-gray-500 mt-1 line-clamp-2 max-w-2xl">{r.ai_summary}</p>}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {r.customer_id&&cmap[r.customer_id]&&<Chip icon="ti-user" text={cmap[r.customer_id]} cls="bg-blue-500/10 text-blue-600 border-blue-500/20"/>}
                    {r.vendor_id&&vmap[r.vendor_id]&&<Chip icon="ti-building-store" text={vmap[r.vendor_id]} cls="bg-amber-500/10 text-amber-600 border-amber-500/20"/>}
                    {r.order_id&&omap[r.order_id]&&<Chip icon="ti-shopping-cart" text={omap[r.order_id]} cls="bg-sky-500/10 text-sky-600 border-sky-500/20"/>}
                    {r.certification_id&&cemap[r.certification_id]&&<Chip icon="ti-rosette" text={cemap[r.certification_id]} cls="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"/>}
                    {!(r.customer_id&&cmap[r.customer_id])&&!(r.vendor_id&&vmap[r.vendor_id])&&!(r.order_id&&omap[r.order_id])&&!(r.certification_id&&cemap[r.certification_id])&&<span className="text-xs text-gray-300">No links yet</span>}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={()=>viewFile(r)} disabled={!hasFile(r)} title={hasFile(r)?'View file':'No file'} className={`${iconBtn} disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400`}><i className="ti ti-eye"/></button>
                  <button onClick={()=>downloadDoc(r)} disabled={!hasFile(r)} title={hasFile(r)?'Download':'No file'} className={`${iconBtn} disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400`}><i className="ti ti-download"/></button>
                  <button onClick={()=>openEdit(r)} title="Open" className={iconBtn}><i className="ti ti-pencil"/></button>
                </div>
              </div>
            </div>
          })}</div>}
        </div>
      })}</div>}
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-white border-l border-[#E4E6EE] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0"><h2 className="text-[#1A1D2E] font-semibold">{editing?'Edit Document':'Add Document'}</h2><div className="flex items-center gap-2">{editing && <ShareLink id={editing.id} />}<button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]"><i className="ti ti-x text-lg"/></button></div></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {editing&&hasFile(editing)&&(
            <div className="flex items-center gap-2 bg-[#F9FAFB] border border-[#E4E6EE] rounded-lg px-3 py-2.5">
              <i className="ti ti-file text-violet-500 text-lg"/>
              <span className="flex-1 text-xs text-[#1A1D2E] truncate">{resolveFile(editing)?.name}</span>
              <button onClick={()=>editing&&viewFile(editing)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20"><i className="ti ti-eye mr-1"/>View</button>
              <button onClick={()=>editing&&downloadDoc(editing)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-[#F5F6FA]"><i className="ti ti-download mr-1"/>Download</button>
            </div>
          )}
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
          <div className="pt-1"><p className="text-xs font-semibold text-gray-500 tracking-widest uppercase mb-2 flex items-center gap-1.5"><i className="ti ti-link text-violet-500"/> Linked Records</p></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Customer</label><select value={form.customer_id} onChange={e=>setForm(p=>({...p,customer_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Vendor</label><select value={form.vendor_id} onChange={e=>setForm(p=>({...p,vendor_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.company_name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Sales Order</label><select value={form.order_id} onChange={e=>setForm(p=>({...p,order_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{orders.map(o=><option key={o.id} value={o.id}>{o.order_number||'Order'}</option>)}</select></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Certification</label><select value={form.certification_id} onChange={e=>setForm(p=>({...p,certification_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{certs.map(c=><option key={c.id} value={c.id}>{c.cert_name||'Certification'}</option>)}</select></div>
          </div>
          <TagInput ref={tagRef} value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} page="Documents" className={inp+' resize-none'}/>
          {editing&&(<>
            <div className="border-t border-[#E4E6EE] pt-4"><FileUpload supabase={sb} recordType="documents" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <DocAI documentId={editing.id}/>
            <div className="border-t border-[#E4E6EE] pt-4"><Comments recordType="document" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><i className="ti ti-alert-circle text-red-400 mt-0.5 shrink-0"/><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={handleDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors" title="Delete"><i className="ti ti-trash"/></button>}
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
