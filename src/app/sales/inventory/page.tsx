'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'

interface Vendor { id: string; company_name: string }
interface Product {
  id: string; sku: string; name: string; category: string | null
  unit_of_measure: string | null; on_hand_qty: number; reorder_point: number
  unit_cost: number | null; unit_price: number | null; vendor_id: string | null
  notes: string | null; is_active: boolean
}
const empty = { sku:'', name:'', category:'', unit_of_measure:'', on_hand_qty:'0', reorder_point:'0', unit_cost:'', unit_price:'', vendor_id:'', notes:'' }
type F = typeof empty
const fmt$ = (n:number|null) => n===null?'—':'$'+n.toFixed(2)
function dbErr(e:{code?:string;message:string;hint?:string}) { console.error(e); return [e.message, e.code&&`(${e.code})`, e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ') }

export default function InventoryPage() {
  const sb = useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<Product[]>([])
  const [vendors,setVendors]=useState<Vendor[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<Product|null>(null)
  const [form,setForm]=useState<F>(empty)
  const [saving,setSaving]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const ref=useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    const [{ data:p },{ data:v }] = await Promise.all([
      sb.from('products').select('*').order('name'),
      sb.from('vendors').select('id,company_name').eq('is_active',true).order('company_name'),
    ])
    if(p) setRows(p as Product[])
    if(v) setVendors(v as Vendor[])
    setLoading(false)
  }
  useEffect(()=>{load()},[]) // eslint-disable-line

  const filtered = rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.sku.toLowerCase().includes(q)||r.name.toLowerCase().includes(q)||(r.category??'').toLowerCase().includes(q)
  })

  function openAdd(){ setEditing(null); setForm(empty); setErr(''); setOpen(true) }
  function openEdit(r:Product){ setEditing(r); setForm({ sku:r.sku, name:r.name, category:r.category??'', unit_of_measure:r.unit_of_measure??'', on_hand_qty:String(r.on_hand_qty), reorder_point:String(r.reorder_point), unit_cost:r.unit_cost!==null?String(r.unit_cost):'', unit_price:r.unit_price!==null?String(r.unit_price):'', vendor_id:r.vendor_id??'', notes:r.notes??'' }); setErr(''); setOpen(true) }
  function close(){ setOpen(false); setTimeout(()=>{ setEditing(null); setForm(empty) },300) }


  async function save() {
    if(!form.sku.trim()||!form.name.trim()){ setErr('SKU and Product Name are required.'); return }
    setErr(''); setSaving(true)
    const payload = { sku:form.sku.trim(), name:form.name.trim(), category:form.category.trim()||null, unit_of_measure:form.unit_of_measure.trim()||null, on_hand_qty:parseFloat(form.on_hand_qty)||0, reorder_point:parseFloat(form.reorder_point)||0, unit_cost:form.unit_cost?parseFloat(form.unit_cost):null, unit_price:form.unit_price?parseFloat(form.unit_price):null, vendor_id:form.vendor_id||null, notes:form.notes.trim()||null }
    const { error } = editing ? await sb.from('products').update({...payload,updated_at:new Date().toISOString()}).eq('id',editing.id) : await sb.from('products').insert({...payload,is_active:true})
    if(error){ setErr(dbErr(error)); setSaving(false); return }
    setSaving(false); close(); load()
  }
  async function toggleArchive(){ if(!editing) return; setBusy(true); await sb.from('products').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id); setBusy(false); close(); load() }

  const vmap = Object.fromEntries(vendors.map(v=>[v.id,v.company_name]))
  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'
  const f=(k:keyof F,label:string,opts?:{type?:string;ta?:boolean})=>(
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
      {opts?.ta ? <textarea rows={3} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} className={inp+' resize-none'}/> : <input type={opts?.type??'text'} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} className={inp}/>}
    </div>
  )

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Inventory</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} item${filtered.length!==1?'s':''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="products" filename="inventory" columns={[
            { header: 'SKU', dbKey: 'sku', example: 'BG-001', required: true },
            { header: 'Name', dbKey: 'name', example: 'Compostable Cup 12oz', required: true },
            { header: 'Category', dbKey: 'category', example: 'Packaging' },
            { header: 'Unit of Measure', dbKey: 'unit_of_measure', example: 'Each' },
            { header: 'On Hand Qty', dbKey: 'on_hand_qty', example: '500' },
            { header: 'Reorder Point', dbKey: 'reorder_point', example: '100' },
            { header: 'Unit Cost', dbKey: 'unit_cost', example: '0.45' },
            { header: 'Unit Price', dbKey: 'unit_price', example: '0.85' },
            { header: 'Vendor Name', dbKey: 'vendor_name', example: 'Global Packaging Inc', lookup: { fromTable: 'vendors', matchField: 'company_name', storeAs: 'vendor_id' } },
            { header: 'Notes', dbKey: 'notes', example: 'Top seller' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Item
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search inventory…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-blue-600':'bg-gray-700'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div>
          <span className="text-sm text-gray-400">Show Archived</span>
        </label>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading ? <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        : filtered.length===0 ? <div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No items match.':archived?'No archived items.':'No items yet.'}</p></div>
        : <table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-gray-800">{['SKU','Product Name','Category','UOM','On Hand','Reorder Pt','Unit Cost','Unit Price','Vendor','Status'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}</tr></thead>
          <tbody>{filtered.map((p,i)=>{
            const low=p.on_hand_qty<=p.reorder_point&&p.reorder_point>0
            return <tr key={p.id} onClick={()=>openEdit(p)} className={`border-b border-gray-800/60 last:border-0 cursor-pointer transition-colors ${low?'bg-amber-500/5 hover:bg-amber-500/10':i%2===0?'hover:bg-gray-800/40':'bg-gray-800/10 hover:bg-gray-800/40'}`}>
              <td className="px-4 py-3 text-gray-300 font-mono text-xs">{p.sku}</td>
              <td className="px-4 py-3 text-white font-medium">{p.name}</td>
              <td className="px-4 py-3 text-gray-400">{p.category||'—'}</td>
              <td className="px-4 py-3 text-gray-400">{p.unit_of_measure||'—'}</td>
              <td className={`px-4 py-3 font-medium ${low?'text-amber-400':'text-gray-300'}`}>{p.on_hand_qty}</td>
              <td className="px-4 py-3 text-gray-400">{p.reorder_point}</td>
              <td className="px-4 py-3 text-gray-400">{fmt$(p.unit_cost)}</td>
              <td className="px-4 py-3 text-gray-400">{fmt$(p.unit_price)}</td>
              <td className="px-4 py-3 text-gray-400 text-xs">{p.vendor_id?vmap[p.vendor_id]||'—':'—'}</td>
              <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${!p.is_active?'bg-gray-700/40 text-gray-500 border border-gray-700':low?'bg-amber-500/15 text-amber-400 border border-amber-500/20':'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'}`}>{!p.is_active?'Archived':low?'Low Stock':'Active'}</span></td>
            </tr>
          })}</tbody></table>}
      </div>
      <div onClick={close} className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`}/>
      <div ref={ref} onClick={(e)=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <h2 className="text-white font-semibold">{editing?'Edit Item':'Add Item'}</h2>
          <button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {f('sku','SKU')}{f('name','Product Name')}
          {f('category','Category')}{f('unit_of_measure','Unit of Measure')}
          <div className="grid grid-cols-2 gap-4">{f('on_hand_qty','On Hand Qty',{type:'number'})}{f('reorder_point','Reorder Point',{type:'number'})}</div>
          <div className="grid grid-cols-2 gap-4">{f('unit_cost','Unit Cost ($)',{type:'number'})}{f('unit_price','Unit Price ($)',{type:'number'})}</div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Vendor</label>
            <select value={form.vendor_id} onChange={e=>setForm(p=>({...p,vendor_id:e.target.value}))} className={inp+' cursor-pointer'}>
              <option value="">— None —</option>
              {vendors.map(v=><option key={v.id} value={v.id}>{v.company_name}</option>)}
            </select>
          </div>
          {f('notes','Notes',{ta:true})}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save Item'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
