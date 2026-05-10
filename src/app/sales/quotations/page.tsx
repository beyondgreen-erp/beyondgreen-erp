'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import { generateQuotePDF } from '@/lib/pdfHelpers'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Customer { id: string; company_name: string; email?: string; phone?: string; billing_address?: string; contact_name?: string }
interface Product { id: string; sku: string; name: string; unit_of_measure: string | null; unit_price: number | null }
interface QuoteLine { id?: string; line_number: number; product_id: string | null; sku: string; description: string; quantity: string; unit_of_measure: string; unit_price: string; discount_pct: string }
interface Quotation { id: string; quote_number: string; customer_id: string | null; quote_date: string | null; expiry_date: string | null; status: string; subtotal: number; tax_pct: number; total: number; notes: string | null; is_active: boolean }

const STATUSES = ['Draft','Sent','Accepted','Rejected','Expired']
const SC: Record<string,string> = { Draft:'bg-gray-700/40 text-gray-400 border-gray-700', Sent:'bg-blue-500/15 text-blue-400 border-blue-500/20', Accepted:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', Rejected:'bg-red-500/15 text-red-400 border-red-500/20', Expired:'bg-gray-600/20 text-gray-500 border-gray-600' }
const emptyForm = { quote_number:'', customer_id:'', quote_date:'', expiry_date:'', status:'Draft', tax_pct:'0', notes:'' }
type F = typeof emptyForm
const emptyLine = (n=1): QuoteLine => ({ line_number:n, product_id:null, sku:'', description:'', quantity:'1', unit_of_measure:'', unit_price:'0', discount_pct:'0' })
const lineTotal = (l: QuoteLine) => (parseFloat(l.quantity)||0)*(parseFloat(l.unit_price)||0)*(1-(parseFloat(l.discount_pct)||0)/100)
const fmt$ = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
const fmtD = (d:string|null) => d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
function dbErr(e:{code?:string;message:string;hint?:string}){return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}

export default function QuotationsPage() {
  const sb = useMemo(()=>createSupabaseBrowserClient(),[])
  const [rows,setRows]=useState<Quotation[]>([])
  const [customers,setCustomers]=useState<Customer[]>([])
  const [products,setProducts]=useState<Product[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false)
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<Quotation|null>(null)
  const [form,setForm]=useState<F>(emptyForm)
  const [lines,setLines]=useState<QuoteLine[]>([emptyLine()])
  const [skuFocus,setSkuFocus]=useState<number|null>(null)
  const [saving,setSaving]=useState(false)
  const [converting,setConverting]=useState(false)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const [userEmail,setUserEmail]=useState('')
  const ref=useRef<HTMLDivElement>(null)

  async function load(){
    setLoading(true)
    const [{data:q},{data:c},{data:p}]=await Promise.all([
      sb.from('quotations').select('*').order('created_at',{ascending:false}),
      sb.from('customers').select('*').eq('is_active',true).order('company_name'),
      sb.from('products').select('id,sku,name,unit_of_measure,unit_price').eq('is_active',true).order('sku'),
    ])
    if(q)setRows(q as Quotation[])
    if(c)setCustomers(c as Customer[])
    if(p)setProducts(p as Product[])
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
  },[]) // eslint-disable-line

  const cmap=Object.fromEntries(customers.map(c=>[c.id,c.company_name]))
  const filtered=rows.filter(r=>{
    if(!archived&&!r.is_active) return false
    if(archived&&r.is_active) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.quote_number.toLowerCase().includes(q)||(r.customer_id?cmap[r.customer_id]||'':'').toLowerCase().includes(q)||r.status.toLowerCase().includes(q)
  })

  function openAdd(){setEditing(null);setForm(emptyForm);setLines([emptyLine()]);setErr('');setOpen(true)}

  async function openEdit(r:Quotation){
    setEditing(r)
    setForm({quote_number:r.quote_number,customer_id:r.customer_id??'',quote_date:r.quote_date??'',expiry_date:r.expiry_date??'',status:r.status,tax_pct:String(r.tax_pct??0),notes:r.notes??''})
    setErr('')
    const {data:ls}=await sb.from('quotation_lines').select('*').eq('quotation_id',r.id).order('line_number')
    setLines(ls&&ls.length>0?ls.map((l:any)=>({id:l.id,line_number:l.line_number,product_id:l.product_id,sku:l.sku??'',description:l.description??'',quantity:String(l.quantity),unit_of_measure:l.unit_of_measure??'',unit_price:String(l.unit_price),discount_pct:String(l.discount_pct??0)})):[emptyLine()])
    setOpen(true)
  }

  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(emptyForm);setLines([emptyLine()])},300)}

  function setLine(i:number,patch:Partial<QuoteLine>){setLines(prev=>prev.map((l,idx)=>idx===i?{...l,...patch}:l))}
  function addLine(){setLines(prev=>[...prev,emptyLine(prev.length+1)])}
  function removeLine(i:number){setLines(prev=>prev.filter((_,idx)=>idx!==i).map((l,idx)=>({...l,line_number:idx+1})))}

  function selectProduct(i:number,p:Product){
    setLine(i,{product_id:p.id,sku:p.sku,description:p.name,unit_of_measure:p.unit_of_measure??'',unit_price:p.unit_price!==null?String(p.unit_price):'0'})
    setSkuFocus(null)
  }

  const subtotal=lines.reduce((s,l)=>s+lineTotal(l),0)
  const taxAmt=subtotal*(parseFloat(form.tax_pct)||0)/100
  const grandTotal=subtotal+taxAmt

  async function save(){
    if(!form.quote_number.trim()){setErr('Quote Number is required.');return}
    setErr('');setSaving(true)
    const payload={quote_number:form.quote_number.trim(),customer_id:form.customer_id||null,quote_date:form.quote_date||null,expiry_date:form.expiry_date||null,status:form.status,tax_pct:parseFloat(form.tax_pct)||0,subtotal,total:grandTotal,notes:form.notes.trim()||null}
    let qid=editing?.id
    if(editing){
      const{error}=await sb.from('quotations').update({...payload,updated_at:new Date().toISOString()}).eq('id',editing.id)
      if(error){setErr(dbErr(error));setSaving(false);return}
    } else {
      const{data,error}=await sb.from('quotations').insert({...payload,is_active:true}).select('id').single()
      if(error||!data){setErr(error?dbErr(error):'Insert failed');setSaving(false);return}
      qid=(data as any).id
    }
    if(editing)await sb.from('quotation_lines').delete().eq('quotation_id',qid!)
    const lineRows=lines.filter(l=>l.sku||l.description).map((l,i)=>({quotation_id:qid!,line_number:i+1,product_id:l.product_id||null,sku:l.sku||null,description:l.description,quantity:parseFloat(l.quantity)||1,unit_of_measure:l.unit_of_measure||null,unit_price:parseFloat(l.unit_price)||0,discount_pct:parseFloat(l.discount_pct)||0}))
    if(lineRows.length>0)await sb.from('quotation_lines').insert(lineRows)
    setSaving(false);close();load()
  }

  async function convertToSO(){
    if(!editing)return
    setConverting(true)
    const soNum='SO-'+editing.quote_number.replace(/^Q[-_]?/i,'')
    const{data:so,error:soErr}=await sb.from('sales_orders').insert({order_number:soNum,customer_id:editing.customer_id,quotation_id:editing.id,order_date:new Date().toISOString().slice(0,10),status:'New',tax_pct:editing.tax_pct??0,subtotal:editing.subtotal??0,total:editing.total??0,notes:editing.notes,is_active:true}).select('id').single()
    if(soErr||!so){setErr(soErr?dbErr(soErr):'Failed to create sales order');setConverting(false);return}
    const{data:ql}=await sb.from('quotation_lines').select('*').eq('quotation_id',editing.id).order('line_number')
    if(ql&&ql.length>0){
      await sb.from('sales_order_lines').insert(ql.map((l:any)=>({sales_order_id:(so as any).id,line_number:l.line_number,product_id:l.product_id,sku:l.sku,description:l.description,quantity:l.quantity,quantity_shipped:0,unit_of_measure:l.unit_of_measure,unit_price:l.unit_price,discount_pct:l.discount_pct})))
    }
    await sb.from('quotations').update({status:'Accepted',updated_at:new Date().toISOString()}).eq('id',editing.id)
    setConverting(false);close();load()
  }

  function downloadPDF(){
    if(!editing)return
    const cust=customers.find(c=>c.id===editing.customer_id)||null
    generateQuotePDF({quote_number:editing.quote_number,quote_date:editing.quote_date,expiry_date:editing.expiry_date,status:editing.status,tax_pct:editing.tax_pct??0,subtotal:editing.subtotal??subtotal,total:editing.total??grandTotal,notes:editing.notes},lines.map(l=>({line_number:l.line_number,sku:l.sku||null,description:l.description,quantity:parseFloat(l.quantity)||0,unit_of_measure:l.unit_of_measure||null,unit_price:parseFloat(l.unit_price)||0,discount_pct:parseFloat(l.discount_pct)||0})),cust)
  }

  async function toggleArchive(){if(!editing)return;setBusy(true);await sb.from('quotations').update({is_active:!editing.is_active,updated_at:new Date().toISOString()}).eq('id',editing.id);setBusy(false);close();load()}

  const inp='w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'
  const inpSm='w-full bg-gray-800/80 border border-gray-700/60 text-white placeholder-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition'

  const skuMatches=(i:number)=>{
    const q=lines[i]?.sku.toLowerCase()
    const pool=q?products.filter(p=>p.sku.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)):products
    return pool.slice(0,6)
  }

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Quotations</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${archived?'archived':'active'} quotation${filtered.length!==1?'s':''}`}</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>New Quote
        </button>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input placeholder="Search quotations…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/></div>
        <label className="flex items-center gap-2 cursor-pointer select-none"><div onClick={()=>setArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${archived?'bg-blue-600':'bg-gray-700'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${archived?'translate-x-4':'translate-x-0.5'}`}/></div><span className="text-sm text-gray-400">Archived</span></label>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':archived?'No archived quotations.':'No quotations yet.'}</p></div>
        :<table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-gray-800">{['Quote #','Customer','Date','Expiry','Status','Total'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>)}</tr></thead>
        <tbody>{filtered.map((r,i)=><tr key={r.id} onClick={()=>openEdit(r)} className={`border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/40 transition-colors ${i%2?'bg-gray-800/10':''}`}>
          <td className="px-5 py-3.5 text-white font-medium font-mono text-xs">{r.quote_number}</td>
          <td className="px-5 py-3.5 text-gray-400">{r.customer_id?cmap[r.customer_id]||'—':'—'}</td>
          <td className="px-5 py-3.5 text-gray-400">{fmtD(r.quote_date)}</td>
          <td className="px-5 py-3.5 text-gray-400">{fmtD(r.expiry_date)}</td>
          <td className="px-5 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.status]||SC.Draft}`}>{r.status}</span></td>
          <td className="px-5 py-3.5 text-gray-300 font-medium">{fmt$(r.total??0)}</td>
        </tr>)}</tbody></table>}
      </div>

      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>

      {/* Wide panel for line items */}
      <div ref={ref} onClick={e=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[880px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-white font-semibold text-sm">{editing?`Edit ${editing.quote_number}`:'New Quotation'}</h2>
          <div className="flex items-center gap-2">
            {editing&&<button onClick={downloadPDF} className="flex items-center gap-1.5 text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>PDF</button>}
            {editing&&editing.status!=='Accepted'&&<button onClick={convertToSO} disabled={converting} className="flex items-center gap-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-lg transition-colors">{converting?'Converting…':'→ Sales Order'}</button>}
            <button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-400 mb-1.5">Quote Number <span className="text-red-400">*</span></label><input value={form.quote_number} onChange={e=>setForm(p=>({...p,quote_number:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Customer</label>
              <select value={form.customer_id} onChange={e=>setForm(p=>({...p,customer_id:e.target.value}))} className={inp+' cursor-pointer'}>
                <option value="">— None —</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Quote Date</label><input type="date" value={form.quote_date} onChange={e=>setForm(p=>({...p,quote_date:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Expiry Date</label><input type="date" value={form.expiry_date} onChange={e=>setForm(p=>({...p,expiry_date:e.target.value}))} className={inp}/></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Status</label>
              <select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>
                {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Tax %</label><input type="number" min="0" max="100" step="0.1" value={form.tax_pct} onChange={e=>setForm(p=>({...p,tax_pct:e.target.value}))} className={inp}/></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Notes</label><textarea rows={2} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} className={inp+' resize-none'}/></div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Line Items</p>
              <button onClick={addLine} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Line</button>
            </div>
            <div className="border border-gray-700 rounded-lg overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]">
                <thead><tr className="bg-gray-800/80 border-b border-gray-700">
                  {['#','SKU','Description','Qty','UOM','Unit Price','Disc %','Total',''].map(h=><th key={h} className="text-left text-gray-500 px-2 py-2 font-medium first:pl-3 last:w-8">{h}</th>)}
                </tr></thead>
                <tbody>
                  {lines.map((l,i)=>(
                    <tr key={i} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/20">
                      <td className="pl-3 pr-1 py-1.5 text-gray-500 w-6">{i+1}</td>
                      <td className="px-1 py-1 relative w-28">
                        <input value={l.sku} onChange={e=>{setLine(i,{sku:e.target.value,product_id:null});setSkuFocus(i)}} onFocus={()=>setSkuFocus(i)} onBlur={()=>setTimeout(()=>setSkuFocus(f=>f===i?null:f),150)} placeholder="SKU…" className={inpSm}/>
                        {skuFocus===i&&skuMatches(i).length>0&&(
                          <div className="absolute top-full left-0 z-20 mt-0.5 w-60 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                            {skuMatches(i).map(p=>(
                              <button key={p.id} type="button" onMouseDown={()=>selectProduct(i,p)} className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors flex items-center gap-2">
                                <span className="text-emerald-400 font-mono text-xs shrink-0">{p.sku}</span>
                                <span className="text-gray-300 text-xs truncate">{p.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-1 py-1"><input value={l.description} onChange={e=>setLine(i,{description:e.target.value})} placeholder="Description…" className={inpSm+' min-w-[130px]'}/></td>
                      <td className="px-1 py-1 w-16"><input type="number" value={l.quantity} onChange={e=>setLine(i,{quantity:e.target.value})} min="0" className={inpSm+' text-right'}/></td>
                      <td className="px-1 py-1 w-14"><input value={l.unit_of_measure} onChange={e=>setLine(i,{unit_of_measure:e.target.value})} placeholder="ea" className={inpSm}/></td>
                      <td className="px-1 py-1 w-24"><input type="number" value={l.unit_price} onChange={e=>setLine(i,{unit_price:e.target.value})} min="0" step="0.01" className={inpSm+' text-right'}/></td>
                      <td className="px-1 py-1 w-14"><input type="number" value={l.discount_pct} onChange={e=>setLine(i,{discount_pct:e.target.value})} min="0" max="100" step="0.1" className={inpSm+' text-right'}/></td>
                      <td className="px-2 py-1.5 text-gray-300 text-right w-20 font-medium tabular-nums">{fmt$(lineTotal(l))}</td>
                      <td className="px-1 py-1"><button onClick={()=>removeLine(i)} className="text-gray-600 hover:text-red-400 transition-colors p-0.5 block"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-3">
              <div className="w-52 space-y-1 text-xs">
                <div className="flex justify-between text-gray-400"><span>Subtotal</span><span className="tabular-nums">{fmt$(subtotal)}</span></div>
                <div className="flex justify-between text-gray-400"><span>Tax ({form.tax_pct||'0'}%)</span><span className="tabular-nums">{fmt$(taxAmt)}</span></div>
                <div className="flex justify-between font-semibold text-white border-t border-gray-700 pt-1.5"><span>Total</span><span className="tabular-nums">{fmt$(grandTotal)}</span></div>
              </div>
            </div>
          </div>

          {editing&&(<>
            <div className="border-t border-gray-800 pt-4"><FileUpload supabase={sb} recordType="quotations" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-gray-800 pt-4"><CommentSection recordType="quotations" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing&&<button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">{editing.is_active?'Archive':'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save Quote'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
