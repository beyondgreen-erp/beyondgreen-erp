'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'

interface Vendor { id: string; company_name: string }
interface Product { id: string; name: string; sku: string }
interface PO { id: string; po_number: string; vendor_id: string | null; product_id: string | null; qty_ordered: number; unit_cost: number; order_date: string | null; expected_receipt_date: string | null; status: string; notes: string | null; is_active: boolean }
const STATUSES = ['Draft','Sent','Confirmed','Received','Cancelled']
const SC: Record<string,string> = { Draft:'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]', Sent:'bg-blue-500/15 text-blue-400 border-blue-500/20', Confirmed:'bg-violet-500/15 text-violet-400 border-violet-500/20', Received:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', Cancelled:'bg-red-500/15 text-red-400 border-red-500/20' }
const empty = { po_number:'', vendor_id:'', product_id:'', qty_ordered:'1', unit_cost:'', order_date:'', expected_receipt_date:'', status:'Draft', notes:'' }
type F = typeof empty
const fmtD=(d:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
const fmt$=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}

export default function PurchaseOrdersPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<PO[]>([])
  const [vendors,setVendors]=useState<Vendor[]>([])
  const [products,setProducts]=useState<Product[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<PO|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const [deleting,setDeleting]=useState(false)
  const [userEmail,setUserEmail]=useState('')
  const ref=useRef<HTMLDivElement>(null)
  const ms=useMultiSelect<PO>()

  async function load(){
    setLoading(true)
    const [{data:po},{data:v},{data:p}]=await Promise.all([
      sb.from('purchase_orders').select('*').order('created_at',{ascending:false}),
      sb.from('vendors').select('id,company_name').eq('is_active',true).order('company_name'),
      sb.from('products').select('id,name,sku').eq('is_active',true).order('name'),
    ])
    if(po) setRows(po as PO[])
    if(v) setVendors(v as Vendor[])
    if(p) setProducts(p as Product[])
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
  },[]) // eslint-disable-line

  const vmap=Object.fromEntries(vendors.map(v=>[v.id,v.company_name]))
  const pmap=Object.fromEntries(products.map(p=>[p.id,p.name]))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.po_number.toLowerCase().includes(q)||(r.vendor_id?vmap[r.vendor_id]||'':'').toLowerCase().includes(q)||r.status.toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm(empty);setErr('');setOpen(true)}
  function openEdit(r:PO){setEditing(r);setForm({po_number:r.po_number,vendor_id:r.vendor_id??'',product_id:r.product_id??'',qty_ordered:String(r.qty_ordered),unit_cost:String(r.unit_cost),order_date:r.order_date??'',expected_receipt_date:r.expected_receipt_date??'',status:r.status,notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}

  async function save(){
    if(!form.po_number.trim()){setErr('PO Number is required.');return}
    setErr('');setSaving(true)
    const qty=parseFloat(form.qty_ordered)||0
    const cost=parseFloat(form.unit_cost)||0
    const p={po_number:form.po_number.trim(),vendor_id:form.vendor_id||null,product_id:form.product_id||null,qty_ordered:qty,unit_cost:cost,order_date:form.order_date||null,expected_receipt_date:form.expected_receipt_date||null,status:form.status,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('purchase_orders').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('purchase_orders').insert({...p,is_active:true})
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('purchase_orders').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}
  async function handleDelete(){if(!editing)return;if(!confirm('Permanently delete this PO? This cannot be undone.'))return;const{error}=await sb.from('purchase_orders').delete().eq('id',editing.id);if(error){alert('Delete failed: '+error.message);return}close();load()}
  async function bulkDelete(){if(!confirm(`Delete ${ms.count} purchase orders? This cannot be undone.`))return;setDeleting(true);await sb.from('purchase_orders').delete().in('id',Array.from(ms.selected));ms.clear();setDeleting(false);load()}

  const inp='w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'
  const totalCost=(parseFloat(form.qty_ordered)||0)*(parseFloat(form.unit_cost)||0)

  return (
    <div className="min-h-screen" style={{background:"#F5F6FA"}}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Purchase Orders</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} PO${filtered.length!==1?'s':''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="purchase_orders" filename="purchase_orders" columns={[
            { header: 'PO Number', dbKey: 'po_number', example: 'PO-2024-001', required: true },
            { header: 'Vendor Name', dbKey: 'vendor_name', example: 'Global Packaging Inc', lookup: { fromTable: 'vendors', matchField: 'company_name', storeAs: 'vendor_id' } },
            { header: 'Product SKU', dbKey: 'product_sku', example: 'BG-001', lookup: { fromTable: 'products', matchField: 'sku', storeAs: 'product_id' } },
            { header: 'Qty Ordered', dbKey: 'qty_ordered', example: '500' },
            { header: 'Unit Cost', dbKey: 'unit_cost', example: '0.45' },
            { header: 'Order Date', dbKey: 'order_date', example: '2024-01-20' },
            { header: 'Expected Receipt Date', dbKey: 'expected_receipt_date', example: '2024-02-10' },
            { header: 'Status', dbKey: 'status', example: 'Draft' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add PO</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input placeholder="Search purchase orders…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-blue-600':'bg-[#F5F6FA]'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Show Archived</span></label>
      </div>
      <div className="rounded-xl overflow-x-auto" style={{border:"1px solid #E4E6EE",background:"#FFFFFF"}}>
        {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived POs.':'No purchase orders yet.'}</p></div>
        :<table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-[#E4E6EE]"><th className="w-10 px-4 py-3"><input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={()=>ms.toggleAll(filtered)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></th>{['PO #','Vendor','Product','Qty','Unit Cost','Total Cost','Order Date','Exp. Receipt','Status'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}</tr></thead>
        <tbody>{filtered.map((r,i)=><tr key={r.id} className={`border-b border-[#F3F4F6] last:border-0 hover:bg-[#F9FAFB] transition-colors ${ms.isSelected(r.id)?'bg-blue-500/5':i%2===0?'':'bg-[#FAFAFA]'}`}>
          <td className="px-4 py-3.5" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={ms.isSelected(r.id)} onChange={()=>ms.toggle(r.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></td>
          <td className="px-4 py-3.5 text-[#1A1D2E] font-mono text-xs cursor-pointer" onClick={()=>openEdit(r)}>{r.po_number}</td>
          <td className="px-4 py-3.5 text-gray-400 cursor-pointer" onClick={()=>openEdit(r)}>{r.vendor_id?vmap[r.vendor_id]||'—':'—'}</td>
          <td className="px-4 py-3.5 text-gray-400 cursor-pointer" onClick={()=>openEdit(r)}>{r.product_id?pmap[r.product_id]||'—':'—'}</td>
          <td className="px-4 py-3.5 text-gray-400 cursor-pointer" onClick={()=>openEdit(r)}>{r.qty_ordered}</td>
          <td className="px-4 py-3.5 text-gray-400 cursor-pointer" onClick={()=>openEdit(r)}>{fmt$(r.unit_cost)}</td>
          <td className="px-4 py-3.5 text-gray-500 font-medium cursor-pointer" onClick={()=>openEdit(r)}>{fmt$(r.qty_ordered*r.unit_cost)}</td>
          <td className="px-4 py-3.5 text-gray-400 cursor-pointer" onClick={()=>openEdit(r)}>{fmtD(r.order_date)}</td>
          <td className="px-4 py-3.5 text-gray-400 cursor-pointer" onClick={()=>openEdit(r)}>{fmtD(r.expected_receipt_date)}</td>
          <td className="px-4 py-3.5 cursor-pointer" onClick={()=>openEdit(r)}><span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.status]||SC.Draft}`}>{r.status}</span></td>
        </tr>)}</tbody></table>}
      </div>
      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting}/>
      <div className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`} style={{ background: '#FFFFFF', borderLeft: '1px solid #E4E6EE' }}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0"><h2 className="text-[#1A1D2E] font-semibold">{editing?'Edit PO':'Add PO'}</h2><button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">PO Number <span className="text-red-400">*</span></label><input value={form.po_number} onChange={e=>setForm(p=>({...p,po_number:e.target.value}))} className={inp}/></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Vendor</label><select value={form.vendor_id} onChange={e=>setForm(p=>({...p,vendor_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.company_name}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Product</label><select value={form.product_id} onChange={e=>setForm(p=>({...p,product_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Qty Ordered</label><input type="number" value={form.qty_ordered} onChange={e=>setForm(p=>({...p,qty_ordered:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Unit Cost ($)</label><input type="number" value={form.unit_cost} onChange={e=>setForm(p=>({...p,unit_cost:e.target.value}))} className={inp}/></div>
          </div>
          {totalCost>0&&<div className="rounded-lg bg-[#F9FAFB] px-3 py-2.5 flex justify-between"><span className="text-xs text-gray-500">Total Cost</span><span className="text-sm font-medium text-[#1A1D2E]">{fmt$(totalCost)}</span></div>}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Order Date</label><input type="date" value={form.order_date} onChange={e=>setForm(p=>({...p,order_date:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Expected Receipt</label><input type="date" value={form.expected_receipt_date} onChange={e=>setForm(p=>({...p,expected_receipt_date:e.target.value}))} className={inp}/></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>{STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Notes</label><textarea rows={3} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} className={inp+' resize-none'}/></div>
          {editing&&(<>
            <div className="border-t border-[#E4E6EE] pt-4"><FileUpload supabase={sb} recordType="purchase_orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-[#E4E6EE] pt-4"><CommentSection recordType="purchase_orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={handleDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Delete"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>}
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
