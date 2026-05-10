'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'

interface SalesOrder { id: string; order_number: string; customer_id: string | null }
interface Customer { id: string; company_name: string }
interface Invoice { id: string; invoice_number: string; sales_order_id: string | null; invoice_date: string | null; due_date: string | null; amount: number; amount_paid: number; status: string; notes: string | null; is_active: boolean }
const STATUSES = ['Draft','Sent','Partial','Paid','Overdue']
const SC: Record<string,string> = { Draft:'bg-gray-700/40 text-gray-400 border-gray-700', Sent:'bg-blue-500/15 text-blue-400 border-blue-500/20', Partial:'bg-amber-500/15 text-amber-400 border-amber-500/20', Paid:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', Overdue:'bg-red-500/15 text-red-400 border-red-500/20' }
const empty = { invoice_number:'', sales_order_id:'', invoice_date:'', due_date:'', amount:'', amount_paid:'0', status:'Draft', notes:'' }
type F = typeof empty
const fmtD=(d:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
const fmt$=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}

export default function InvoicesPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<Invoice[]>([])
  const [orders,setOrders]=useState<SalesOrder[]>([])
  const [customers,setCustomers]=useState<Customer[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<Invoice|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const [userEmail,setUserEmail]=useState('')
  const ref=useRef<HTMLDivElement>(null)

  async function load(){
    setLoading(true)
    const [{data:inv},{data:o},{data:c}]=await Promise.all([
      sb.from('invoices').select('*').order('created_at',{ascending:false}),
      sb.from('sales_orders').select('id,order_number,customer_id').eq('is_active',true).order('order_number'),
      sb.from('customers').select('id,company_name').eq('is_active',true),
    ])
    if(inv) setRows(inv as Invoice[])
    if(o) setOrders(o as SalesOrder[])
    if(c) setCustomers(c as Customer[])
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
  },[]) // eslint-disable-line

  const omap=Object.fromEntries(orders.map(o=>[o.id,o]))
  const cmap=Object.fromEntries(customers.map(c=>[c.id,c.company_name]))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.invoice_number.toLowerCase().includes(q)||r.status.toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm(empty);setErr('');setOpen(true)}
  function openEdit(r:Invoice){setEditing(r);setForm({invoice_number:r.invoice_number,sales_order_id:r.sales_order_id??'',invoice_date:r.invoice_date??'',due_date:r.due_date??'',amount:r.amount?String(r.amount):'',amount_paid:String(r.amount_paid),status:r.status,notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}

  async function save(){
    if(!form.invoice_number.trim()){setErr('Invoice Number is required.');return}
    setErr('');setSaving(true)
    const p={invoice_number:form.invoice_number.trim(),sales_order_id:form.sales_order_id||null,invoice_date:form.invoice_date||null,due_date:form.due_date||null,amount:parseFloat(form.amount)||0,amount_paid:parseFloat(form.amount_paid)||0,status:form.status,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('invoices').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('invoices').insert({...p,is_active:true})
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('invoices').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}

  const inp='w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Invoices</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} invoice${filtered.length!==1?'s':''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="invoices" filename="invoices" columns={[
            { header: 'Invoice Number', dbKey: 'invoice_number', example: 'INV-2024-001', required: true },
            { header: 'Order Number', dbKey: 'order_number', example: 'SO-2024-001', lookup: { fromTable: 'sales_orders', matchField: 'order_number', storeAs: 'sales_order_id' } },
            { header: 'Invoice Date', dbKey: 'invoice_date', example: '2024-02-05' },
            { header: 'Due Date', dbKey: 'due_date', example: '2024-03-05' },
            { header: 'Amount', dbKey: 'amount', example: '1250.00' },
            { header: 'Amount Paid', dbKey: 'amount_paid', example: '0.00' },
            { header: 'Status', dbKey: 'status', example: 'Draft' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Invoice</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input placeholder="Search invoices…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-blue-600':'bg-gray-700'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Show Archived</span></label>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived invoices.':'No invoices yet.'}</p></div>
        :<table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-gray-800">{['Invoice #','Sales Order','Customer','Invoice Date','Due Date','Total','Paid','Balance','Status'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}</tr></thead>
        <tbody>{filtered.map((r,i)=>{
          const o=r.sales_order_id?omap[r.sales_order_id]:null
          const balance=r.amount-r.amount_paid
          return <tr key={r.id} onClick={()=>openEdit(r)} className={`border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/40 transition-colors ${i%2===0?'':'bg-gray-800/10'}`}>
            <td className="px-4 py-3.5 text-white font-mono text-xs">{r.invoice_number}</td>
            <td className="px-4 py-3.5 text-gray-400 font-mono text-xs">{o?.order_number||'—'}</td>
            <td className="px-4 py-3.5 text-gray-400">{o?.customer_id?cmap[o.customer_id]||'—':'—'}</td>
            <td className="px-4 py-3.5 text-gray-400">{fmtD(r.invoice_date)}</td>
            <td className="px-4 py-3.5 text-gray-400">{fmtD(r.due_date)}</td>
            <td className="px-4 py-3.5 text-gray-300">{fmt$(r.amount)}</td>
            <td className="px-4 py-3.5 text-emerald-400">{fmt$(r.amount_paid)}</td>
            <td className={`px-4 py-3.5 font-medium ${balance>0?'text-amber-400':'text-gray-400'}`}>{fmt$(balance)}</td>
            <td className="px-4 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.status]||SC.Draft}`}>{r.status}</span></td>
          </tr>
        })}</tbody></table>}
      </div>
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0"><h2 className="text-white font-semibold">{editing?'Edit Invoice':'Add Invoice'}</h2><button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">Invoice Number <span className="text-red-400">*</span></label><input value={form.invoice_number} onChange={e=>setForm(p=>({...p,invoice_number:e.target.value}))} className={inp}/></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Sales Order</label><select value={form.sales_order_id} onChange={e=>setForm(p=>({...p,sales_order_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{orders.map(o=><option key={o.id} value={o.id}>{o.order_number}{o.customer_id&&cmap[o.customer_id]?' — '+cmap[o.customer_id]:''}</option>)}</select></div>
          {form.sales_order_id&&omap[form.sales_order_id]?.customer_id&&<div className="bg-gray-800/50 rounded-lg px-3 py-2.5"><p className="text-xs text-gray-500">Customer</p><p className="text-sm text-white mt-0.5">{cmap[omap[form.sales_order_id]!.customer_id!]||'—'}</p></div>}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Invoice Date</label><input type="date" value={form.invoice_date} onChange={e=>setForm(p=>({...p,invoice_date:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Due Date</label><input type="date" value={form.due_date} onChange={e=>setForm(p=>({...p,due_date:e.target.value}))} className={inp}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Total Amount ($)</label><input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Amount Paid ($)</label><input type="number" value={form.amount_paid} onChange={e=>setForm(p=>({...p,amount_paid:e.target.value}))} className={inp}/></div>
          </div>
          {(parseFloat(form.amount)||0)>0&&<div className="bg-gray-800/50 rounded-lg px-3 py-2.5 flex justify-between"><span className="text-xs text-gray-500">Balance Due</span><span className={`text-sm font-medium ${(parseFloat(form.amount)||0)-(parseFloat(form.amount_paid)||0)>0?'text-amber-400':'text-emerald-400'}`}>{fmt$((parseFloat(form.amount)||0)-(parseFloat(form.amount_paid)||0))}</span></div>}
          <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>{STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Notes</label><textarea rows={3} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} className={inp+' resize-none'}/></div>
          {editing&&(<>
            <div className="border-t border-gray-800 pt-4"><FileUpload supabase={sb} recordType="invoices" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-gray-800 pt-4"><CommentSection recordType="invoices" recordId={editing.id} currentUserEmail={userEmail}/></div>
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
