'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'

interface WorkOrder { id: string; wo_number: string }
interface Machine { id: string; name: string }
interface DailyPlan { id: string; plan_date: string | null; work_order_id: string | null; machine_id: string | null; target_qty: number; actual_qty: number; status: string; notes: string | null; is_active: boolean }
const STATUSES = ['Planned','In Progress','Complete','Delayed']
const SC: Record<string,string> = { Planned:'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]', 'In Progress':'bg-blue-500/15 text-blue-400 border-blue-500/20', Complete:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', Delayed:'bg-red-500/15 text-red-400 border-red-500/20' }
const empty = { plan_date:'', work_order_id:'', machine_id:'', target_qty:'0', actual_qty:'0', status:'Planned', notes:'' }
type F = typeof empty
const fmtD=(d:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}

export default function DailyPlanPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<DailyPlan[]>([])
  const [workOrders,setWorkOrders]=useState<WorkOrder[]>([])
  const [machines,setMachines]=useState<Machine[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<DailyPlan|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const ref=useRef<HTMLDivElement>(null)

  async function load(){
    setLoading(true)
    const [{data:dp},{data:wo},{data:m}]=await Promise.all([
      sb.from('daily_plan').select('*').order('plan_date',{ascending:false}),
      sb.from('work_orders').select('id,wo_number').eq('is_active',true).order('wo_number'),
      sb.from('machines').select('id,name').eq('is_active',true).order('name'),
    ])
    if(dp) setRows(dp as DailyPlan[])
    if(wo) setWorkOrders(wo as WorkOrder[])
    if(m) setMachines(m as Machine[])
    setLoading(false)
  }
  useEffect(()=>{load()},[]) // eslint-disable-line

  const womap=Object.fromEntries(workOrders.map(w=>[w.id,w.wo_number]))
  const mmap=Object.fromEntries(machines.map(m=>[m.id,m.name]))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return (r.work_order_id?womap[r.work_order_id]||'':'').toLowerCase().includes(q)||(r.machine_id?mmap[r.machine_id]||'':'').toLowerCase().includes(q)||r.status.toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm({...empty,plan_date:new Date().toISOString().slice(0,10)});setErr('');setOpen(true)}
  function openEdit(r:DailyPlan){setEditing(r);setForm({plan_date:r.plan_date??'',work_order_id:r.work_order_id??'',machine_id:r.machine_id??'',target_qty:String(r.target_qty),actual_qty:String(r.actual_qty),status:r.status,notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}
  useItemDeepLink(rows, openEdit)

  async function save(){
    setErr('');setSaving(true)
    const target=parseFloat(form.target_qty)||0
    const actual=parseFloat(form.actual_qty)||0
    const p={plan_date:form.plan_date||null,work_order_id:form.work_order_id||null,machine_id:form.machine_id||null,target_qty:target,actual_qty:actual,status:form.status,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('daily_plan').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('daily_plan').insert({...p,is_active:true})
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('daily_plan').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}
  async function handleDelete(){if(!editing)return;if(!confirm('Permanently delete this plan entry? This cannot be undone.'))return;const{error}=await sb.from('daily_plan').delete().eq('id',editing.id);if(error){alert('Delete failed: '+error.message);return}close();load()}

  const inp='w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Daily Plan</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} plan${filtered.length!==1?'s':''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="daily_plan" filename="daily_plan" columns={[
            { header: 'Plan Date', dbKey: 'plan_date', example: '2024-02-05', required: true },
            { header: 'WO Number', dbKey: 'wo_number', example: 'WO-2024-001', lookup: { fromTable: 'work_orders', matchField: 'wo_number', storeAs: 'work_order_id' } },
            { header: 'Machine Name', dbKey: 'machine_name', example: 'Injection Molder 1', lookup: { fromTable: 'machines', matchField: 'name', storeAs: 'machine_id' } },
            { header: 'Target Qty', dbKey: 'target_qty', example: '500' },
            { header: 'Actual Qty', dbKey: 'actual_qty', example: '0' },
            { header: 'Status', dbKey: 'status', example: 'Planned' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Plan</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input placeholder="Search plans…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-emerald-600':'bg-[#F5F6FA]'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Show Archived</span></label>
      </div>
      <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-x-auto">
        {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived plans.':'No plans yet.'}</p></div>
        :<table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-[#E4E6EE]">{['Date','Work Order','Machine','Target Qty','Actual Qty','Variance','Status'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>)}</tr></thead>
        <tbody>{filtered.map((r,i)=>{
          const variance=r.actual_qty-r.target_qty
          return <tr key={r.id} onClick={()=>openEdit(r)} className={`border-b border-[#E4E6EE]/60 last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${i%2===0?'':'bg-[#F5F6FA]/10'}`}>
            <td className="px-5 py-3.5 text-[#1A1D2E] font-medium">{fmtD(r.plan_date)}</td>
            <td className="px-5 py-3.5 text-gray-400 font-mono text-xs">{r.work_order_id?womap[r.work_order_id]||'—':'—'}</td>
            <td className="px-5 py-3.5 text-gray-400">{r.machine_id?mmap[r.machine_id]||'—':'—'}</td>
            <td className="px-5 py-3.5 text-gray-400">{r.target_qty}</td>
            <td className="px-5 py-3.5 text-gray-400">{r.actual_qty}</td>
            <td className={`px-5 py-3.5 font-medium ${variance>0?'text-emerald-400':variance<0?'text-red-400':'text-gray-500'}`}>{variance>0?'+':''}{variance}</td>
            <td className="px-5 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.status]||SC.Planned}`}>{r.status}</span></td>
          </tr>
        })}</tbody></table>}
      </div>
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-white border-l border-[#E4E6EE] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0"><h2 className="text-[#1A1D2E] font-semibold">{editing?'Edit Plan':'Add Plan'}</h2><div className="flex items-center gap-2">{editing && <ShareLink id={editing.id} />}<button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></div></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">Plan Date</label><input type="date" value={form.plan_date} onChange={e=>setForm(p=>({...p,plan_date:e.target.value}))} className={inp}/></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Work Order</label><select value={form.work_order_id} onChange={e=>setForm(p=>({...p,work_order_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{workOrders.map(w=><option key={w.id} value={w.id}>{w.wo_number}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Machine</label><select value={form.machine_id} onChange={e=>setForm(p=>({...p,machine_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Target Qty</label><input type="number" value={form.target_qty} onChange={e=>setForm(p=>({...p,target_qty:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Actual Qty</label><input type="number" value={form.actual_qty} onChange={e=>setForm(p=>({...p,actual_qty:e.target.value}))} className={inp}/></div>
          </div>
          {(parseFloat(form.target_qty)||0)>0&&<div className="bg-[#F9FAFB]/50 rounded-lg px-3 py-2.5 flex justify-between"><span className="text-xs text-gray-500">Variance</span><span className={`text-sm font-medium ${(parseFloat(form.actual_qty)||0)-(parseFloat(form.target_qty)||0)>=0?'text-emerald-400':'text-red-400'}`}>{((parseFloat(form.actual_qty)||0)-(parseFloat(form.target_qty)||0)>0?'+':'')}{(parseFloat(form.actual_qty)||0)-(parseFloat(form.target_qty)||0)}</span></div>}
          <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>{STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Notes</label><textarea rows={3} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} className={inp+' resize-none'}/></div>
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={handleDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Delete"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>}
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
