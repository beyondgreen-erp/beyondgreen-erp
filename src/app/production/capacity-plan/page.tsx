'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'

interface Machine { id: string; name: string }
interface CapPlan { id: string; machine_id: string | null; week_start_date: string | null; available_hours: number; booked_hours: number; notes: string | null; is_active: boolean }
const empty = { machine_id:'', week_start_date:'', available_hours:'40', booked_hours:'0', notes:'' }
type F = typeof empty
const fmtD=(d:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
function dbErr(e:{code?:string;message:string;hint?:string}){console.error(e);return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}
function utilColor(pct:number){return pct>=90?'text-red-400':pct>=70?'text-amber-400':'text-emerald-400'}
function utilBg(pct:number){return pct>=90?'bg-red-500/10 border-red-500/20':pct>=70?'bg-amber-500/5':''}

export default function CapacityPlanPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<CapPlan[]>([])
  const [machines,setMachines]=useState<Machine[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<CapPlan|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const ref=useRef<HTMLDivElement>(null)

  async function load(){
    setLoading(true)
    const [{data:cp},{data:m}]=await Promise.all([
      sb.from('capacity_plan').select('*').order('week_start_date',{ascending:false}),
      sb.from('machines').select('id,name').eq('is_active',true).order('name'),
    ])
    if(cp) setRows(cp as CapPlan[])
    if(m) setMachines(m as Machine[])
    setLoading(false)
  }
  useEffect(()=>{load()},[]) // eslint-disable-line

  const mmap=Object.fromEntries(machines.map(m=>[m.id,m.name]))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return (r.machine_id?mmap[r.machine_id]||'':'').toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm(empty);setErr('');setOpen(true)}
  function openEdit(r:CapPlan){setEditing(r);setForm({machine_id:r.machine_id??'',week_start_date:r.week_start_date??'',available_hours:String(r.available_hours),booked_hours:String(r.booked_hours),notes:r.notes??''});setErr('');setOpen(true)}
  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(empty)},300)}

  async function save(){
    setErr('');setSaving(true)
    const avail=parseFloat(form.available_hours)||0
    const booked=parseFloat(form.booked_hours)||0
    const p={machine_id:form.machine_id||null,week_start_date:form.week_start_date||null,available_hours:avail,booked_hours:booked,notes:form.notes.trim()||null}
    const{error}=editing?await sb.from('capacity_plan').update({...p,updated_at:new Date().toISOString()}).eq('id',editing.id):await sb.from('capacity_plan').insert({...p,is_active:true})
    if(error){setErr(dbErr(error));setSaving(false);return}
    setSaving(false);close();load()
  }
  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('capacity_plan').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}

  const inp='w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'
  const formUtil=form.available_hours?(Math.round(((parseFloat(form.booked_hours)||0)/(parseFloat(form.available_hours)||1))*100)):0

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Capacity Plan</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} entr${filtered.length!==1?'ies':'y'}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="capacity_plan" filename="capacity_plan" columns={[
            { header: 'Machine Name', dbKey: 'machine_name', example: 'Injection Molder 1', lookup: { fromTable: 'machines', matchField: 'name', storeAs: 'machine_id' } },
            { header: 'Week Start Date', dbKey: 'week_start_date', example: '2024-02-05', required: true },
            { header: 'Available Hours', dbKey: 'available_hours', example: '40' },
            { header: 'Booked Hours', dbKey: 'booked_hours', example: '32' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Entry</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input placeholder="Search by machine…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-emerald-600':'bg-gray-700'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Show Archived</span></label>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived entries.':'No capacity plans yet.'}</p></div>
        :<table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-gray-800">{['Machine','Week Starting','Available Hrs','Booked Hrs','Utilization','Notes'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>)}</tr></thead>
        <tbody>{filtered.map((r,i)=>{
          const pct=r.available_hours>0?Math.round((r.booked_hours/r.available_hours)*100):0
          return <tr key={r.id} onClick={()=>openEdit(r)} className={`border-b border-gray-800/60 last:border-0 cursor-pointer transition-colors ${utilBg(pct)||( i%2===0?'hover:bg-gray-800/40':'bg-gray-800/10 hover:bg-gray-800/40')}`}>
            <td className="px-5 py-3.5 text-white font-medium">{r.machine_id?mmap[r.machine_id]||'—':'—'}</td>
            <td className="px-5 py-3.5 text-gray-400">{fmtD(r.week_start_date)}</td>
            <td className="px-5 py-3.5 text-gray-400">{r.available_hours}h</td>
            <td className="px-5 py-3.5 text-gray-400">{r.booked_hours}h</td>
            <td className="px-5 py-3.5">
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${pct>=90?'bg-red-500':pct>=70?'bg-amber-500':'bg-emerald-500'}`} style={{width:`${Math.min(pct,100)}%`}}/></div>
                <span className={`text-xs font-medium ${utilColor(pct)}`}>{pct}%</span>
              </div>
            </td>
            <td className="px-5 py-3.5 text-gray-500 text-xs truncate max-w-xs">{r.notes||'—'}</td>
          </tr>
        })}</tbody></table>}
      </div>
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0"><h2 className="text-white font-semibold">{editing?'Edit Entry':'Add Entry'}</h2><button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">Machine</label><select value={form.machine_id} onChange={e=>setForm(p=>({...p,machine_id:e.target.value}))} className={inp+' cursor-pointer'}><option value="">— None —</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Week Start Date</label><input type="date" value={form.week_start_date} onChange={e=>setForm(p=>({...p,week_start_date:e.target.value}))} className={inp}/></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs text-gray-400 mb-1.5">Available Hours</label><input type="number" value={form.available_hours} onChange={e=>setForm(p=>({...p,available_hours:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Booked Hours</label><input type="number" value={form.booked_hours} onChange={e=>setForm(p=>({...p,booked_hours:e.target.value}))} className={inp}/></div>
          </div>
          {(parseFloat(form.available_hours)||0)>0&&(
            <div className={`rounded-lg px-3 py-2.5 flex items-center justify-between ${formUtil>=90?'bg-red-500/10 border border-red-500/20':formUtil>=70?'bg-amber-500/10 border border-amber-500/20':'bg-gray-800/50'}`}>
              <span className="text-xs text-gray-500">Utilization</span>
              <span className={`text-sm font-medium ${utilColor(formUtil)}`}>{formUtil}%{formUtil>=90?' — Over capacity':''}</span>
            </div>
          )}
          <div><label className="block text-xs text-gray-400 mb-1.5">Notes</label><textarea rows={3} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} className={inp+' resize-none'}/></div>
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
