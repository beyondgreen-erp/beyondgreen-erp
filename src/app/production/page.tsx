'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import WorkflowMover from '@/components/WorkflowMover'

interface SalesOrder { id: string; order_number: string; customer_id: string | null }
interface Customer { id: string; company_name: string }
interface Product { id: string; name: string }
interface Machine { id: string; name: string }
interface WO { id: string; wo_number: string; sales_order_id: string | null; product_id: string | null; machine_id: string | null; qty_ordered: number; qty_produced: number; start_date: string | null; due_date: string | null; status: string; notes: string | null }
const STATUSES = ['Queued','In Progress','QC','Complete','On Hold']
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SC: Record<string,string> = { Queued:'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]', 'In Progress':'bg-blue-500/15 text-blue-400 border-blue-500/20', QC:'bg-violet-500/15 text-violet-400 border-violet-500/20', Complete:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', 'On Hold':'bg-amber-500/15 text-amber-400 border-amber-500/20' }
const empty = { wo_number:'', sales_order_id:'', product_id:'', machine_id:'', qty_ordered:'1', qty_produced:'0', start_date:'', due_date:'', status:'Queued', notes:'' }
type F = typeof empty
const fmtD=(d:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}

export default function ProductionPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<WO[]>([])
  const [orders,setOrders]=useState<SalesOrder[]>([])
  const [customers,setCustomers]=useState<Customer[]>([])
  const [products,setProducts]=useState<Product[]>([])
  const [machines,setMachines]=useState<Machine[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<WO|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const [deleting,setDeleting]=useState(false)
  const [userEmail,setUserEmail]=useState('')
  const ref=useRef<HTMLDivElement>(null)
  const tagRef=useRef<TagInputHandle>(null)
  const ms=useMultiSelect<WO>()

  async function load(){
    setLoading(true)
    const [{data:w,error:wErr},{data:o},{data:c},{data:p},{data:m}]=await Promise.all([
      sb.from('work_orders').select('*').order('created_at',{ascending:false}),
      sb.from('sales_orders').select('id,order_number,customer_id').not('status','in','("Closed","Cancelled")').order('order_number'),
      sb.from('customers').select('id,company_name').eq('is_active',true),
      sb.from('products').select('id,name').eq('is_active',true).order('name'),
      sb.from('machines').select('id,name').eq('is_active',true).order('name'),
    ])
    if(wErr) console.error('work_orders load error:',wErr)
    setRows((w ?? []) as WO[])
    if(o) setOrders(o as SalesOrder[])
    if(c) setCustomers(c as Customer[])
    if(p) setProducts(p as Product[])
    if(m) setMachines(m as Machine[])
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
    const onVisible=()=>{if(document.visibilityState==='visible')load()}
    document.addEventListener('visibilitychange',onVisible)
    return()=>document.removeEventListener('visibilitychange',onVisible)
  },[]) // eslint-disable-line

  const omap=Object.fromEntries(orders.map(o=>[o.id,o]))
  const cmap=Object.fromEntries(customers.map(c=>[c.id,c.company_name]))
  const pmap=Object.fromEntries(products.map(p=>[p.id,p.name]))
  const mmap=Object.fromEntries(machines.map(m=>[m.id,m.name]))
  const now=new Date(); now.setHours(0,0,0,0)

  const DONE = new Set(['Complete', 'Cancelled'])
  const filtered=rows.filter(r=>{
    if(!archived&&DONE.has(r.status)) return false
    if(archived&&!DONE.has(r.status)) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.wo_number.toLowerCase().includes(q)||(r.product_id?pmap[r.product_id]||'':'').toLowerCase().includes(q)||r.status.toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm(empty);setErr('');setOpen(true)}
  function openEdit(r:WO){setEditing(r);setForm({wo_number:r.wo_number,sales_order_id:r.sales_order_id??'',product_id:r.product_id??'',machine_id:r.machine_id??'',qty_ordered:String(r.qty_ordered),qty_produced:String(r.qty_produced),start_date:r.start_date??'',due_date:r.due_date??'',status:r.status,notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}

  async function save(){
    if(!form.wo_number.trim()){setErr('WO Number is required.');return}
    setErr('');setSaving(true)
    const p={wo_number:form.wo_number.trim(),sales_order_id:form.sales_order_id||null,product_id:form.product_id||null,machine_id:form.machine_id||null,qty_ordered:parseFloat(form.qty_ordered)||0,qty_produced:parseFloat(form.qty_produced)||0,start_date:form.start_date||null,due_date:form.due_date||null,status:form.status,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('work_orders').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('work_orders').insert(p)
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);await tagRef.current?.sendNotifications();close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);const nextStatus=DONE.has(editing.status)?'Queued':'Complete';await sb.from('work_orders').update({status:nextStatus,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}
  async function handleDelete(){if(!editing)return;if(!confirm('Permanently delete this work order? This cannot be undone.'))return;const{error}=await sb.from('work_orders').delete().eq('id',editing.id);if(error){alert('Delete failed: '+error.message);return}close();load()}
  async function bulkDelete(){if(!confirm(`Delete ${ms.count} work orders? This cannot be undone.`))return;setDeleting(true);await sb.from('work_orders').delete().in('id',Array.from(ms.selected));ms.clear();setDeleting(false);load()}

  const inp = 'w-full px-3 py-2.5 rounded-lg border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3B6FE0] transition'
  const inpStyle = { borderColor: '#E4E6EE', color: '#1A1D2E' }

  const SC2: Record<string,string> = {
    Queued:'bg-[#F3F4F6] text-[#6B7280]',
    'In Progress':'bg-[#EFF6FF] text-[#2563EB]',
    QC:'bg-[#F5F3FF] text-[#7C3AED]',
    Complete:'bg-[#ECFDF5] text-[#059669]',
    'On Hold':'bg-[#FFFBEB] text-[#D97706]',
  }

  return (
    <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
      {/* Page header */}
      <div className="bg-white border-b px-8 py-5" style={{ borderColor: '#E4E6EE' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: '#1A1D2E' }}>Work Orders</h1>
            <p className="text-sm mt-0.5" style={{ color: '#9CA3AF' }}>{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} work order${filtered.length!==1?'s':''}`}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={load} title="Refresh" className="w-9 h-9 rounded-lg border flex items-center justify-center transition-colors" style={{ borderColor: '#E4E6EE', color: '#6B7280', background: '#fff' }} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F5F6FA'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='#fff'}}>
              <i className={`ti ti-refresh text-sm${loading?' animate-spin':''}`}/>
            </button>
            <ImportExportBar table="work_orders" filename="work_orders" columns={[
              { header: 'WO Number', dbKey: 'wo_number', example: 'WO-2024-001', required: true },
              { header: 'Order Number', dbKey: 'order_number', example: 'SO-2024-001', lookup: { fromTable: 'sales_orders', matchField: 'order_number', storeAs: 'sales_order_id' } },
              { header: 'Product SKU', dbKey: 'product_sku', example: 'BG-001', lookup: { fromTable: 'products', matchField: 'sku', storeAs: 'product_id' } },
              { header: 'Machine Name', dbKey: 'machine_name', example: 'Injection Molder 1', lookup: { fromTable: 'machines', matchField: 'name', storeAs: 'machine_id' } },
              { header: 'Qty Ordered', dbKey: 'qty_ordered', example: '500' },
              { header: 'Qty Produced', dbKey: 'qty_produced', example: '0' },
              { header: 'Start Date', dbKey: 'start_date', example: '2024-02-01' },
              { header: 'Due Date', dbKey: 'due_date', example: '2024-02-15' },
              { header: 'Status', dbKey: 'status', example: 'Queued' },
              { header: 'Notes', dbKey: 'notes', example: '' },
            ]} onImportDone={load} />
            <button onClick={openAdd} className="flex items-center gap-2 text-[#1A1D2E] text-sm font-medium px-4 py-2 rounded-lg transition-colors" style={{ background: '#3B6FE0' }} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#2D5EC7'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='#3B6FE0'}}>
              <i className="ti ti-plus text-sm"/>Add Work Order
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <i className="ti ti-search absolute left-3 top-2.5 text-sm" style={{ color: '#9CA3AF' }}/>
            <input placeholder="Search work orders…" value={search} onChange={e=>setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border text-sm bg-white focus:outline-none"
              style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }}/>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm" style={{ color: '#6B7280' }}>
            <div onClick={()=>setArchived(v=>!v)} className={`w-8 h-4 rounded-full relative transition-colors ${archived?'bg-[#3B6FE0]':'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/>
            </div>
            Archived
          </label>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: '#E4E6EE' }}>
          {loading ? (
            <div className="flex items-center justify-center py-16"><div className="w-5 h-5 rounded-full border-2 border-[#3B6FE0] border-t-transparent animate-spin"/></div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16"><p className="text-sm" style={{ color: '#9CA3AF' }}>{search?'No matches.':archived?'No archived work orders.':'No work orders yet.'}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E4E6EE', background: '#F9FAFB' }}>
                    <th className="w-10 px-4 py-3"><input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={()=>ms.toggleAll(filtered)} className="w-4 h-4 cursor-pointer accent-[#3B6FE0]"/></th>
                    {['WO #','Customer','Product','Machine','Qty Ord.','Qty Prod.','Start','Due','Status',''].map(h=>(
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r=>{
                    const o=r.sales_order_id?omap[r.sales_order_id]:null
                    const overdue=r.due_date&&new Date(r.due_date+'T00:00:00')<now&&r.status!=='Complete'
                    return (
                      <tr key={r.id} className="transition-colors" style={{ borderBottom: '1px solid #F3F4F6', background: ms.isSelected(r.id)?'#EEF2FF':overdue?'#FEF2F2':'transparent' }}
                        onMouseEnter={e=>{if(!ms.isSelected(r.id))(e.currentTarget as HTMLElement).style.background=overdue?'#FEE2E2':'#F9FAFB'}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=ms.isSelected(r.id)?'#EEF2FF':overdue?'#FEF2F2':'transparent'}}>
                        <td className="px-4 py-3" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={ms.isSelected(r.id)} onChange={()=>ms.toggle(r.id)} className="w-4 h-4 cursor-pointer accent-[#3B6FE0]"/></td>
                        <td className="px-4 py-3.5 font-mono text-xs font-semibold cursor-pointer" style={{ color: '#1A1D2E' }} onClick={()=>openEdit(r)}>{r.wo_number}</td>
                        <td className="px-4 py-3.5 text-sm cursor-pointer" style={{ color: '#6B7280' }} onClick={()=>openEdit(r)}>{o?.customer_id?cmap[o.customer_id]||'—':'—'}</td>
                        <td className="px-4 py-3.5 text-sm cursor-pointer" style={{ color: '#6B7280' }} onClick={()=>openEdit(r)}>{r.product_id?pmap[r.product_id]||'—':'—'}</td>
                        <td className="px-4 py-3.5 text-sm cursor-pointer" style={{ color: '#6B7280' }} onClick={()=>openEdit(r)}>{r.machine_id?mmap[r.machine_id]||'—':'—'}</td>
                        <td className="px-4 py-3.5 text-sm cursor-pointer" style={{ color: '#374151' }} onClick={()=>openEdit(r)}>{r.qty_ordered}</td>
                        <td className="px-4 py-3.5 text-sm cursor-pointer" style={{ color: '#374151' }} onClick={()=>openEdit(r)}>{r.qty_produced}</td>
                        <td className="px-4 py-3.5 text-sm cursor-pointer" style={{ color: '#6B7280' }} onClick={()=>openEdit(r)}>{fmtD(r.start_date)}</td>
                        <td className="px-4 py-3.5 text-sm cursor-pointer font-medium" style={{ color: overdue?'#DC2626':'#6B7280' }} onClick={()=>openEdit(r)}>{fmtD(r.due_date)}</td>
                        <td className="px-4 py-3.5 cursor-pointer" onClick={()=>openEdit(r)}>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${SC2[r.status]||SC2.Queued}`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3.5" onClick={e=>e.stopPropagation()}>
                          <WorkflowMover recordId={r.id} recordType="production" currentStatus={r.status} onMoved={load}/>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting}/>

      {/* Backdrop */}
      <div className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-200 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>

      {/* Slide-out panel */}
      <div ref={ref} onClick={e=>e.stopPropagation()}
        className={`fixed top-0 right-0 h-full z-50 flex flex-col shadow-xl transition-transform duration-300 ${open?'translate-x-0':'translate-x-full'}`}
        style={{ width: 480, background: '#FFFFFF', borderLeft: '1px solid #E4E6EE' }}>
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid #E4E6EE' }}>
          <div>
            <h2 className="font-semibold text-base" style={{ color: '#1A1D2E' }}>{editing?'Edit Work Order':'New Work Order'}</h2>
            {editing && <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>WO #{editing.wo_number}</p>}
          </div>
          <button onClick={close} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: '#F5F6FA', color: '#6B7280' }}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#E4E6EE'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='#F5F6FA'}}>
            <i className="ti ti-x text-sm"/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>WO Number <span style={{ color: '#DC2626' }}>*</span></label>
            <input value={form.wo_number} onChange={e=>setForm(p=>({...p,wo_number:e.target.value}))} className={inp} style={inpStyle}/>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Sales Order</label>
            <select value={form.sales_order_id} onChange={e=>setForm(p=>({...p,sales_order_id:e.target.value}))} className={inp+' cursor-pointer'} style={inpStyle}>
              <option value="">— None —</option>{orders.map(o=><option key={o.id} value={o.id}>{o.order_number}{o.customer_id&&cmap[o.customer_id]?' — '+cmap[o.customer_id]:''}</option>)}
            </select>
          </div>
          {form.sales_order_id&&omap[form.sales_order_id]?.customer_id&&(
            <div className="rounded-lg px-3 py-2.5" style={{ background: '#F5F6FA' }}>
              <p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>Customer</p>
              <p className="text-sm mt-0.5" style={{ color: '#1A1D2E' }}>{cmap[omap[form.sales_order_id]!.customer_id!]||'—'}</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Product</label>
            <select value={form.product_id} onChange={e=>setForm(p=>({...p,product_id:e.target.value}))} className={inp+' cursor-pointer'} style={inpStyle}>
              <option value="">— None —</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Machine</label>
            <select value={form.machine_id} onChange={e=>setForm(p=>({...p,machine_id:e.target.value}))} className={inp+' cursor-pointer'} style={inpStyle}>
              <option value="">— None —</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Qty Ordered</label><input type="number" value={form.qty_ordered} onChange={e=>setForm(p=>({...p,qty_ordered:e.target.value}))} className={inp} style={inpStyle}/></div>
            <div><label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Qty Produced</label><input type="number" value={form.qty_produced} onChange={e=>setForm(p=>({...p,qty_produced:e.target.value}))} className={inp} style={inpStyle}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Start Date</label><input type="date" value={form.start_date} onChange={e=>setForm(p=>({...p,start_date:e.target.value}))} className={inp} style={inpStyle}/></div>
            <div><label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Due Date</label><input type="date" value={form.due_date} onChange={e=>setForm(p=>({...p,due_date:e.target.value}))} className={inp} style={inpStyle}/></div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Status</label>
            <select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'} style={inpStyle}>
              {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <TagInput ref={tagRef} value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} page="Work Orders" className={inp+' resize-none'}/>
          {editing&&(
            <>
              <div className="pt-2" style={{ borderTop: '1px solid #E4E6EE' }}><FileUpload supabase={sb} recordType="work_orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
              <div className="pt-2" style={{ borderTop: '1px solid #E4E6EE' }}><CommentSection recordType="work_orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
            </>
          )}
        </div>

        <div className="shrink-0 px-6 py-4 flex flex-col gap-3" style={{ borderTop: '1px solid #E4E6EE', background: '#F9FAFB' }}>
          {err&&<div className="flex gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>{err}</div>}
          <div className="flex gap-3">
            {editing&&<button onClick={handleDelete} className="px-3 py-2 rounded-lg border text-sm font-medium transition-colors" style={{ borderColor: '#FECACA', background: '#FEF2F2', color: '#DC2626' }}>Delete</button>}
            {editing&&<button onClick={toggleArchive} disabled={busy} className="px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50" style={{ borderColor: '#E4E6EE', color: '#6B7280' }}>{DONE.has(editing.status)?'Restore':'Archive'}</button>}
            <button onClick={close} className="flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors" style={{ borderColor: '#E4E6EE', color: '#6B7280' }}>Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50" style={{ background: '#3B6FE0' }}>{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
