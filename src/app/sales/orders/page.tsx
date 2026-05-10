'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'

interface Customer { id: string; company_name: string }
interface Quotation { id: string; quote_number: string }
interface SalesOrder { id: string; order_number: string; customer_id: string | null; quotation_id: string | null; order_date: string | null; required_ship_date: string | null; status: string; notes: string | null; is_active: boolean }
const STATUSES = ['New','In Production','Ready to Ship','Shipped','Invoiced','Closed']
const SC: Record<string,string> = { New:'bg-blue-500/15 text-blue-400 border-blue-500/20', 'In Production':'bg-amber-500/15 text-amber-400 border-amber-500/20', 'Ready to Ship':'bg-violet-500/15 text-violet-400 border-violet-500/20', Shipped:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', Invoiced:'bg-teal-500/15 text-teal-400 border-teal-500/20', Closed:'bg-gray-700/40 text-gray-500 border-gray-700' }
const empty = { order_number:'', customer_id:'', quotation_id:'', order_date:'', required_ship_date:'', status:'New', notes:'' }
type F = typeof empty
const fmtD=(d:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}

export default function SalesOrdersPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<SalesOrder[]>([])
  const [customers,setCustomers]=useState<Customer[]>([])
  const [quotations,setQuotations]=useState<Quotation[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<SalesOrder|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const [userEmail,setUserEmail]=useState('')
  const ref=useRef<HTMLDivElement>(null)
  const tagRef=useRef<TagInputHandle>(null)

  async function load(){
    setLoading(true)
    const [{data:o},{data:c},{data:q}]=await Promise.all([
      sb.from('sales_orders').select('*').order('created_at',{ascending:false}),
      sb.from('customers').select('id,company_name').eq('is_active',true).order('company_name'),
      sb.from('quotations').select('id,quote_number').eq('is_active',true).order('quote_number'),
    ])
    if(o) setRows(o as SalesOrder[])
    if(c) setCustomers(c as Customer[])
    if(q) setQuotations(q as Quotation[])
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
  },[]) // eslint-disable-line

  const cmap=Object.fromEntries(customers.map(c=>[c.id,c.company_name]))
  const qmap=Object.fromEntries(quotations.map(q=>[q.id,q.quote_number]))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.order_number.toLowerCase().includes(q)||(r.customer_id?cmap[r.customer_id]||'':'').toLowerCase().includes(q)||r.status.toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm(empty);setErr('');setOpen(true)}
  function openEdit(r:SalesOrder){setEditing(r);setForm({order_number:r.order_number,customer_id:r.customer_id??'',quotation_id:r.quotation_id??'',order_date:r.order_date??'',required_ship_date:r.required_ship_date??'',status:r.status,notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}

  async function save(){
    if(!form.order_number.trim()){setErr('Order Number is required.');return}
    setErr('');setSaving(true)
    const p={order_number:form.order_number.trim(),customer_id:form.customer_id||null,quotation_id:form.quotation_id||null,order_date:form.order_date||null,required_ship_date:form.required_ship_date||null,status:form.status,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('sales_orders').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('sales_orders').insert({...p,is_active:true})
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);await tagRef.current?.sendNotifications();close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('sales_orders').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}

  const inp='w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Sales Orders</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} order${filtered.length!==1?'s':''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="sales_orders" filename="sales_orders" columns={[
            { header: 'Order Number', dbKey: 'order_number', example: 'SO-2024-001', required: true },
            { header: 'Customer Name', dbKey: 'customer_name', example: 'Acme Corp', lookup: { fromTable: 'customers', matchField: 'company_name', storeAs: 'customer_id' } },
            { header: 'Quote Number', dbKey: 'quote_number', example: 'Q-2024-001', lookup: { fromTable: 'quotations', matchField: 'quote_number', storeAs: 'quotation_id' } },
            { header: 'Order Date', dbKey: 'order_date', example: '2024-01-20' },
            { header: 'Ship By Date', dbKey: 'required_ship_date', example: '2024-02-05' },
            { header: 'Status', dbKey: 'status', example: 'New' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Order</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input placeholder="Search orders…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-blue-600':'bg-gray-700'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Show Archived</span></label>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived orders.':'No orders yet.'}</p></div>
        :<table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-gray-800">{['Order #','Customer','Order Date','Ship By','Quotation','Status'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>)}</tr></thead>
        <tbody>{filtered.map((r,i)=><tr key={r.id} onClick={()=>openEdit(r)} className={`border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/40 transition-colors ${i%2===0?'':'bg-gray-800/10'}`}>
          <td className="px-5 py-3.5 text-white font-medium font-mono text-xs">{r.order_number}</td>
          <td className="px-5 py-3.5 text-gray-400">{r.customer_id?cmap[r.customer_id]||'—':'—'}</td>
          <td className="px-5 py-3.5 text-gray-400">{fmtD(r.order_date)}</td>
          <td className="px-5 py-3.5 text-gray-400">{fmtD(r.required_ship_date)}</td>
          <td className="px-5 py-3.5 text-gray-500 text-xs font-mono">{r.quotation_id?qmap[r.quotation_id]||'—':'—'}</td>
          <td className="px-5 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.status]||SC.New}`}>{r.status}</span></td>
        </tr>)}</tbody></table>}
      </div>
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0"><h2 className="text-white font-semibold">{editing?'Edit Order':'Add Order'}</h2><button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">Order Number <span className="text-red-400">*</span></label><input value={form.order_number} onChange={e=>setForm(p=>({...p,order_number:e.target.value}))} className={inp}/></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Customer</label><select value={form.customer_id} onChange={e=>setForm(p=>({...p,customer_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Linked Quotation</label><select value={form.quotation_id} onChange={e=>setForm(p=>({...p,quotation_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{quotations.map(q=><option key={q.id} value={q.id}>{q.quote_number}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Order Date</label><input type="date" value={form.order_date} onChange={e=>setForm(p=>({...p,order_date:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Required Ship Date</label><input type="date" value={form.required_ship_date} onChange={e=>setForm(p=>({...p,required_ship_date:e.target.value}))} className={inp}/></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>{STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <TagInput ref={tagRef} value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} page="Sales Orders" className={inp+' resize-none'}/>
          {editing&&(<>
            <div className="border-t border-gray-800 pt-4"><FileUpload supabase={sb} recordType="orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-gray-800 pt-4"><CommentSection recordType="orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
