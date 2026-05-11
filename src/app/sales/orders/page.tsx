'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import { generatePackingSlip, generateBOL } from '@/lib/pdfHelpers'
import LinkedTasks from '@/components/LinkedTasks'
import { useToast } from '@/components/Toast'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Customer { id: string; company_name: string; email?: string; phone?: string; billing_address?: string; contact_name?: string }
interface Product { id: string; sku: string; product_name: string; unit_of_measure: string | null; unit_price: number | null; on_hand_qty: number | null }
interface Quotation { id: string; quote_number: string }
interface SOLine { id?: string; line_number: number; product_id: string | null; sku: string; description: string; quantity: string; quantity_shipped: string; unit_of_measure: string; unit_price: string; discount_pct: string }
interface SalesOrder { id: string; order_number: string; customer_id: string | null; quotation_id: string | null; order_date: string | null; required_ship_date: string | null; status: string; po_number: string | null; shipping_address: string | null; carrier: string | null; tracking_number: string | null; subtotal: number; tax_pct: number; total: number; notes: string | null }
interface ShipLocation { id: string; location_name: string; address: string | null; city: string | null; state: string | null; zip: string | null; is_default: boolean }

const STATUSES = ['New','In Production','QC','Ready to Ship','Shipped','Invoiced','Closed']
const SC: Record<string,string> = {
  New: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'In Production': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  QC: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  'Ready to Ship': 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Shipped: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  Invoiced: 'bg-[#00C89615] text-[#00C896] border-[#00C89630]',
  Closed: 'bg-[#1E1E24] text-[#5A5A6A] border-[#2A2A35]',
}
const PIPELINE_STAGES = ['New','In Production','QC','Ready to Ship','Shipped','Invoiced']

const emptyForm = { order_number:'', customer_id:'', quotation_id:'', order_date:'', required_ship_date:'', status:'New', po_number:'', shipping_address:'', carrier:'', tracking_number:'', tax_pct:'0', notes:'' }
type F = typeof emptyForm
const emptyLine = (n=1): SOLine => ({ line_number:n, product_id:null, sku:'', description:'', quantity:'1', quantity_shipped:'0', unit_of_measure:'', unit_price:'0', discount_pct:'0' })
const lineTotal = (l: SOLine) => (parseFloat(l.quantity)||0)*(parseFloat(l.unit_price)||0)*(1-(parseFloat(l.discount_pct)||0)/100)
const fmt$ = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
const fmtD = (d:string|null) => d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
function dbErr(e:{code?:string;message:string;hint?:string}){return[e.message,e.code&&`(${e.code})`,e.hint&&`Hint: ${e.hint}`].filter(Boolean).join(' — ')}

const inp = 'w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#5A5A6A] focus:outline-none focus:border-[#00C896] focus:ring-1 focus:ring-[#00C896] transition-all'
const inpSm = 'w-full bg-[#18181C] border border-[#2A2A35] rounded-lg px-2 py-1.5 text-xs text-white placeholder-[#5A5A6A] focus:outline-none focus:border-[#00C896] transition-all'

export default function SalesOrdersPage() {
  const sb = useMemo(()=>createSupabaseBrowserClient(),[])
  const { toast } = useToast()
  const [rows,setRows]=useState<SalesOrder[]>([])
  const [customers,setCustomers]=useState<Customer[]>([])
  const [quotations,setQuotations]=useState<Quotation[]>([])
  const [products,setProducts]=useState<Product[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [stageFilter,setStageFilter]=useState<string>('All')
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<SalesOrder|null>(null)
  const [form,setForm]=useState<F>(emptyForm)
  const [lines,setLines]=useState<SOLine[]>([emptyLine()])
  const [skuFocus,setSkuFocus]=useState<number|null>(null)
  const [saving,setSaving]=useState(false)
  const [err,setErr]=useState('')
  const [shipLocs,setShipLocs]=useState<ShipLocation[]>([])
  const [selLocId,setSelLocId]=useState('')
  const [userEmail,setUserEmail]=useState('')
  const ref=useRef<HTMLDivElement>(null)

  async function load(){
    setLoading(true)
    const [{data:o},{data:c},{data:q},{data:p}]=await Promise.all([
      sb.from('sales_orders').select('*').order('created_at',{ascending:false}),
      sb.from('customers').select('*').eq('is_active',true).order('company_name'),
      sb.from('quotations').select('id,quote_number').order('quote_number'),
      sb.from('products').select('id,sku,product_name,unit_of_measure,unit_price,on_hand_qty').eq('is_active',true).order('sku'),
    ])
    if(o)setRows(o as SalesOrder[])
    if(c)setCustomers(c as Customer[])
    if(q)setQuotations(q as Quotation[])
    if(p)setProducts(p as Product[])
    setLoading(false)
  }
  useEffect(()=>{
    load()
    sb.auth.getUser().then(({data})=>{if(data.user?.email)setUserEmail(data.user.email)})
  },[]) // eslint-disable-line

  const cmap=Object.fromEntries(customers.map(c=>[c.id,c.company_name]))
  const qmap=Object.fromEntries(quotations.map(q=>[q.id,q.quote_number]))

  const filtered=rows.filter(r=>{
    if(stageFilter !== 'All' && r.status !== stageFilter) return false
    if(!search) return true
    const q=search.toLowerCase()
    return r.order_number.toLowerCase().includes(q)||(r.customer_id?cmap[r.customer_id]||'':'').toLowerCase().includes(q)||r.status.toLowerCase().includes(q)||(r.po_number??'').toLowerCase().includes(q)
  })

  const stageCounts = Object.fromEntries(PIPELINE_STAGES.map(s=>[s, rows.filter(r=>r.status===s).length]))

  async function loadShipLocs(cid: string) {
    if (!cid) { setShipLocs([]); setSelLocId(''); return }
    const { data } = await sb.from('customer_ship_locations').select('id,location_name,address,city,state,zip,is_default').eq('customer_id', cid).order('is_default', { ascending: false })
    const locs = (data ?? []) as ShipLocation[]
    setShipLocs(locs)
    const def = locs.find(l => l.is_default) ?? locs[0]
    if (def) {
      setSelLocId(def.id)
      const addr = [def.address, def.city && def.state ? `${def.city}, ${def.state}` : (def.city || def.state), def.zip].filter(Boolean).join('\n')
      setForm(p => ({ ...p, shipping_address: addr }))
    } else { setSelLocId('') }
  }

  function onLocSelect(locId: string) {
    setSelLocId(locId)
    const loc = shipLocs.find(l => l.id === locId)
    if (!loc) return
    const addr = [loc.address, loc.city && loc.state ? `${loc.city}, ${loc.state}` : (loc.city || loc.state), loc.zip].filter(Boolean).join('\n')
    setForm(p => ({ ...p, shipping_address: addr }))
  }

  function openAdd(){
    const nums=rows.map(r=>parseInt(r.order_number)).filter(n=>!isNaN(n))
    const next=nums.length>0?Math.max(...nums)+1:1001
    setEditing(null);setForm({...emptyForm,order_number:String(next)});setLines([emptyLine()]);setShipLocs([]);setSelLocId('');setErr('');setOpen(true)
  }

  async function openEdit(r:SalesOrder){
    setEditing(r)
    setForm({order_number:r.order_number,customer_id:r.customer_id??'',quotation_id:r.quotation_id??'',order_date:r.order_date??'',required_ship_date:r.required_ship_date??'',status:r.status,po_number:r.po_number??'',shipping_address:r.shipping_address??'',carrier:r.carrier??'',tracking_number:r.tracking_number??'',tax_pct:String(r.tax_pct??0),notes:r.notes??''})
    setErr('')
    if (r.customer_id) {
      const { data } = await sb.from('customer_ship_locations').select('id,location_name,address,city,state,zip,is_default').eq('customer_id', r.customer_id).order('is_default', { ascending: false })
      setShipLocs((data ?? []) as ShipLocation[]); setSelLocId('')
    } else { setShipLocs([]); setSelLocId('') }
    const{data:ls}=await sb.from('sales_order_lines').select('*').eq('sales_order_id',r.id).order('line_number')
    setLines(ls&&ls.length>0?ls.map((l:any)=>({id:l.id,line_number:l.line_number,product_id:l.product_id,sku:l.sku??'',description:l.description??'',quantity:String(l.quantity),quantity_shipped:String(l.quantity_shipped??0),unit_of_measure:l.unit_of_measure??'',unit_price:String(l.unit_price),discount_pct:String(l.discount_pct??0)})):[emptyLine()])
    setOpen(true)
  }

  function close(){setOpen(false);setTimeout(()=>{setEditing(null);setForm(emptyForm);setLines([emptyLine()]);setShipLocs([]);setSelLocId('')},300)}
  function setLine(i:number,patch:Partial<SOLine>){setLines(prev=>prev.map((l,idx)=>idx===i?{...l,...patch}:l))}
  function addLine(){setLines(prev=>[...prev,emptyLine(prev.length+1)])}
  function removeLine(i:number){setLines(prev=>prev.filter((_,idx)=>idx!==i).map((l,idx)=>({...l,line_number:idx+1})))}
  function selectProduct(i:number,p:Product){setLine(i,{product_id:p.id,sku:p.sku,description:p.product_name,unit_of_measure:p.unit_of_measure??'',unit_price:p.unit_price!==null?String(p.unit_price):'0'});setSkuFocus(null)}

  async function onQuotationChange(qid:string){
    setForm(p=>({...p,quotation_id:qid}))
    if(!qid)return
    const{data:q}=await sb.from('quotations').select('customer_id,tax_pct').eq('id',qid).single()
    if(q){
      setForm(p=>({...p,quotation_id:qid,customer_id:(q as any).customer_id??p.customer_id,tax_pct:String((q as any).tax_pct??0)}))
      const{data:ql}=await sb.from('quotation_lines').select('*').eq('quotation_id',qid).order('line_number')
      if(ql&&ql.length>0) setLines(ql.map((l:any)=>({line_number:l.line_number,product_id:l.product_id,sku:l.sku??'',description:l.description??'',quantity:String(l.quantity),quantity_shipped:'0',unit_of_measure:l.unit_of_measure??'',unit_price:String(l.unit_price),discount_pct:String(l.discount_pct??0)})))
    }
  }

  const subtotal=lines.reduce((s,l)=>s+lineTotal(l),0)
  const taxAmt=subtotal*(parseFloat(form.tax_pct)||0)/100
  const grandTotal=subtotal+taxAmt

  async function save(){
    if(!form.order_number.trim()){setErr('Order Number is required.');return}
    setErr('');setSaving(true)
    const payload={order_number:form.order_number.trim(),customer_id:form.customer_id||null,quotation_id:form.quotation_id||null,order_date:form.order_date||null,required_ship_date:form.required_ship_date||null,status:form.status,po_number:form.po_number.trim()||null,shipping_address:form.shipping_address.trim()||null,carrier:form.carrier.trim()||null,tracking_number:form.tracking_number.trim()||null,tax_pct:parseFloat(form.tax_pct)||0,subtotal,total:grandTotal,notes:form.notes.trim()||null}
    let sid=editing?.id
    if(editing){
      const{error}=await sb.from('sales_orders').update({...payload,updated_at:new Date().toISOString()}).eq('id',editing.id)
      if(error){setErr(dbErr(error));setSaving(false);return}
    } else {
      const{data,error}=await sb.from('sales_orders').insert({...payload}).select('id').single()
      if(error||!data){setErr(error?dbErr(error):'Insert failed');setSaving(false);return}
      sid=(data as any).id
    }
    if(editing)await sb.from('sales_order_lines').delete().eq('sales_order_id',sid!)
    const lineRows=lines.filter(l=>l.sku||l.description).map((l,i)=>({sales_order_id:sid!,line_number:i+1,product_id:l.product_id||null,sku:l.sku||null,description:l.description,quantity:parseFloat(l.quantity)||1,quantity_shipped:parseFloat(l.quantity_shipped)||0,unit_of_measure:l.unit_of_measure||null,unit_price:parseFloat(l.unit_price)||0,discount_pct:parseFloat(l.discount_pct)||0}))
    if(lineRows.length>0)await sb.from('sales_order_lines').insert(lineRows)
    toast(editing ? 'Order updated' : 'Order created', 'success')
    setSaving(false);close();load()
  }

  function getCustomer(){return customers.find(c=>c.id===form.customer_id)||null}
  function doPackingSlip(){generatePackingSlip({order_number:form.order_number,order_date:form.order_date||null,required_ship_date:form.required_ship_date||null,status:form.status,po_number:form.po_number||null,shipping_address:form.shipping_address||null,carrier:form.carrier||null,tracking_number:form.tracking_number||null,subtotal,tax_pct:parseFloat(form.tax_pct)||0,total:grandTotal,notes:form.notes||null},lines.map(l=>({line_number:l.line_number,sku:l.sku||null,description:l.description,quantity:parseFloat(l.quantity)||0,quantity_shipped:parseFloat(l.quantity_shipped)||0,unit_of_measure:l.unit_of_measure||null,unit_price:parseFloat(l.unit_price)||0,discount_pct:parseFloat(l.discount_pct)||0})),getCustomer())}
  function doBOL(){generateBOL({order_number:form.order_number,order_date:form.order_date||null,required_ship_date:form.required_ship_date||null,status:form.status,po_number:form.po_number||null,shipping_address:form.shipping_address||null,carrier:form.carrier||null,tracking_number:form.tracking_number||null,subtotal,tax_pct:parseFloat(form.tax_pct)||0,total:grandTotal,notes:form.notes||null},lines.map(l=>({line_number:l.line_number,sku:l.sku||null,description:l.description,quantity:parseFloat(l.quantity)||0,quantity_shipped:parseFloat(l.quantity_shipped)||0,unit_of_measure:l.unit_of_measure||null,unit_price:parseFloat(l.unit_price)||0,discount_pct:parseFloat(l.discount_pct)||0})),getCustomer())}

  const skuMatches=(i:number)=>{
    const q=lines[i]?.sku.toLowerCase()
    if(!q) return products.slice(0,6)
    return products.filter(p=>p.sku.toLowerCase().includes(q)||(p.product_name??'').toLowerCase().includes(q)).sort((a,b)=>{const as=a.sku.toLowerCase(),bs=b.sku.toLowerCase();if(as===q)return -1;if(bs===q)return 1;if(as.startsWith(q))return -1;if(bs.startsWith(q))return 1;return 0}).slice(0,6)
  }

  return (
    <div className="p-5 md:p-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-bold text-white mt-1.5 tracking-tight">Sales Orders</h1>
          <p className="text-[#5A5A6A] text-sm mt-0.5">{loading?'Loading…':`${filtered.length} order${filtered.length!==1?'s':''}`}</p>
        </div>
        <button onClick={openAdd} className="bg-[#00C896] hover:bg-[#00B085] text-black font-semibold text-sm px-5 py-2.5 rounded-xl transition-all flex items-center gap-2 self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>New Order
        </button>
      </div>

      {/* Pipeline stage filter */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        <button onClick={()=>setStageFilter('All')} className={`shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all border ${stageFilter==='All'?'bg-[#2A2A35] text-white border-[#3A3A45]':'bg-transparent text-[#5A5A6A] border-[#2A2A35] hover:text-[#9898A8]'}`}>
          All <span className="ml-1 text-[#5A5A6A]">{rows.length}</span>
        </button>
        {PIPELINE_STAGES.map(s=>(
          <button key={s} onClick={()=>setStageFilter(s)} className={`shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all border ${stageFilter===s?'bg-[#2A2A35] text-white border-[#3A3A45]':'bg-transparent text-[#5A5A6A] border-[#2A2A35] hover:text-[#9898A8]'}`}>
            {s} <span className={`ml-1 ${stageFilter===s?'text-[#9898A8]':'text-[#3A3A4A]'}`}>{stageCounts[s]??0}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5A5A6A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input placeholder="Search orders, customers, PO…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-[#111113] border border-[#2A2A35] text-white placeholder-[#5A5A6A] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#00C896] transition-all"/>
      </div>

      {/* Table */}
      <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-x-auto">
        {loading
          ? <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
          : filtered.length===0
            ? <div className="flex flex-col items-center justify-center py-20"><div className="w-12 h-12 bg-[#1E1E24] rounded-2xl flex items-center justify-center mb-3"><svg className="w-6 h-6 text-[#3A3A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg></div><p className="text-white font-medium mb-1">No orders{search?' found':''}</p><p className="text-[#5A5A6A] text-sm">{search?'Try a different search.':'Create your first sales order.'}</p></div>
            : <table className="w-full min-w-[700px] text-sm">
                <thead><tr className="border-b border-[#2A2A35]">
                  {['Order #','Customer','Quote','Order Date','Ship By','Status','Total'].map(h=>(
                    <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((r,i)=>(
                    <tr key={r.id} onClick={()=>openEdit(r)} className={`border-b border-[#2A2A35]/60 last:border-0 cursor-pointer hover:bg-[#18181C] transition-colors ${i%2===1?'bg-[#18181C]/30':''}`}>
                      <td className="px-4 py-3.5 text-white font-mono text-xs font-medium">{r.order_number}</td>
                      <td className="px-4 py-3.5 text-[#9898A8] text-sm">{r.customer_id?cmap[r.customer_id]||'—':'—'}</td>
                      <td className="px-4 py-3.5 text-[#5A5A6A] text-xs font-mono">{r.quotation_id?qmap[r.quotation_id]||'—':'—'}</td>
                      <td className="px-4 py-3.5 text-[#9898A8] text-sm">{fmtD(r.order_date)}</td>
                      <td className="px-4 py-3.5 text-[#9898A8] text-sm">{fmtD(r.required_ship_date)}</td>
                      <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${SC[r.status]||SC.New}`}>{r.status}</span></td>
                      <td className="px-4 py-3.5 text-white font-semibold tabular-nums">{fmt$(r.total??0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
        }
      </div>

      {/* Backdrop */}
      <div className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${open?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={close}/>

      {/* Panel */}
      <div ref={ref} onClick={e=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[880px] bg-[#111113] border-l border-[#2A2A35] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open?'translate-x-0':'translate-x-full'}`}>
        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A35] shrink-0">
          <div>
            <h2 className="text-white font-semibold">{editing?editing.order_number:'New Sales Order'}</h2>
            {editing && <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-medium border mt-1 ${SC[editing.status]||SC.New}`}>{editing.status}</span>}
          </div>
          <div className="flex items-center gap-2">
            {editing && <>
              <button onClick={doPackingSlip} className="flex items-center gap-1.5 text-xs border border-[#2A2A35] text-[#9898A8] hover:text-white hover:border-[#3A3A45] px-3 py-1.5 rounded-xl transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>Packing Slip
              </button>
              <button onClick={doBOL} className="flex items-center gap-1.5 text-xs border border-[#2A2A35] text-[#9898A8] hover:text-white hover:border-[#3A3A45] px-3 py-1.5 rounded-xl transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>BOL
              </button>
            </>}
            <button onClick={close} className="p-2 rounded-xl text-[#5A5A6A] hover:text-white hover:bg-[#18181C] transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <section>
            <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Order Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-[#9898A8] mb-1.5">Order Number <span className="text-red-400">*</span></label><input value={form.order_number} onChange={e=>setForm(p=>({...p,order_number:e.target.value}))} className={inp}/></div>
              <div><label className="block text-xs text-[#9898A8] mb-1.5">From Quotation</label>
                <select value={form.quotation_id} onChange={e=>onQuotationChange(e.target.value)} className={inp+' cursor-pointer'}>
                  <option value="">— None —</option>{quotations.map(q=><option key={q.id} value={q.id}>{q.quote_number}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-[#9898A8] mb-1.5">Customer</label>
                <select value={form.customer_id} onChange={e=>{setForm(p=>({...p,customer_id:e.target.value}));loadShipLocs(e.target.value)}} className={inp+' cursor-pointer'}>
                  <option value="">— None —</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-[#9898A8] mb-1.5">PO Number</label><input value={form.po_number} onChange={e=>setForm(p=>({...p,po_number:e.target.value}))} placeholder="Customer PO #" className={inp}/></div>
              <div><label className="block text-xs text-[#9898A8] mb-1.5">Order Date</label><input type="date" value={form.order_date} onChange={e=>setForm(p=>({...p,order_date:e.target.value}))} className={inp}/></div>
              <div><label className="block text-xs text-[#9898A8] mb-1.5">Required Ship Date</label><input type="date" value={form.required_ship_date} onChange={e=>setForm(p=>({...p,required_ship_date:e.target.value}))} className={inp}/></div>
              <div><label className="block text-xs text-[#9898A8] mb-1.5">Status</label>
                <select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>
                  {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-[#9898A8] mb-1.5">Tax %</label><input type="number" min="0" max="100" step="0.1" value={form.tax_pct} onChange={e=>setForm(p=>({...p,tax_pct:e.target.value}))} className={inp}/></div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Shipping</h3>
            <div className="space-y-3">
              {form.customer_id && shipLocs.length > 0 && (
                <select value={selLocId} onChange={e=>onLocSelect(e.target.value)} className={inp+' cursor-pointer'}>
                  <option value="">— Select ship-to location —</option>
                  {shipLocs.map(l=><option key={l.id} value={l.id}>{l.location_name}{l.city?` (${l.city}, ${l.state})`:''}{l.is_default?' ★':''}</option>)}
                </select>
              )}
              <textarea rows={2} value={form.shipping_address} onChange={e=>setForm(p=>({...p,shipping_address:e.target.value}))} placeholder="Delivery address…" className={inp+' resize-none'}/>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs text-[#9898A8] mb-1.5">Carrier</label><input value={form.carrier} onChange={e=>setForm(p=>({...p,carrier:e.target.value}))} placeholder="UPS, FedEx, Freight…" className={inp}/></div>
                <div><label className="block text-xs text-[#9898A8] mb-1.5">Tracking Number</label><input value={form.tracking_number} onChange={e=>setForm(p=>({...p,tracking_number:e.target.value}))} className={inp}/></div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-2">Notes</h3>
            <textarea rows={2} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} className={inp+' resize-none'}/>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider">Line Items</h3>
              <button onClick={addLine} className="flex items-center gap-1.5 text-xs text-[#00C896] hover:text-[#00B085] transition-colors font-medium">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Line
              </button>
            </div>
            <div className="border border-[#2A2A35] rounded-xl overflow-x-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead><tr className="bg-[#18181C] border-b border-[#2A2A35]">
                  {['#','SKU','Description','Qty','Shipped','UOM','Unit Price','Disc %','Total',''].map(h=><th key={h} className="text-left text-[#5A5A6A] px-2 py-2 font-medium first:pl-3 last:w-8">{h}</th>)}
                </tr></thead>
                <tbody>
                  {lines.map((l,i)=>(
                    <tr key={i} className="border-b border-[#2A2A35]/60 last:border-0 hover:bg-[#18181C]/50">
                      <td className="pl-3 pr-1 py-1.5 text-[#5A5A6A] w-6">{i+1}</td>
                      <td className="px-1 py-1 relative w-28">
                        <input value={l.sku} onChange={e=>{setLine(i,{sku:e.target.value,product_id:null});setSkuFocus(i)}} onFocus={()=>setSkuFocus(i)} onBlur={()=>setTimeout(()=>setSkuFocus(f=>f===i?null:f),150)} placeholder="SKU…" className={inpSm}/>
                        {skuFocus===i&&skuMatches(i).length>0&&(
                          <div className="absolute top-full left-0 z-20 mt-0.5 w-80 bg-[#1E1E24] border border-[#2A2A35] rounded-xl shadow-xl overflow-hidden">
                            {skuMatches(i).map(p=>{
                              const qty=parseFloat(lines[i]?.quantity)||1
                              const stock=p.on_hand_qty??0
                              const lowStock=stock>0&&stock<qty
                              const noStock=stock===0
                              return(
                              <button key={p.id} type="button" onMouseDown={()=>selectProduct(i,p)} className="w-full text-left px-3 py-2.5 hover:bg-[#2A2A35] transition-colors">
                                <div className="flex items-center gap-2.5">
                                  <span className="text-[#00C896] font-mono text-xs shrink-0">{p.sku}</span>
                                  <span className="text-[#9898A8] text-xs truncate flex-1">{p.product_name}</span>
                                  <span className={`text-xs shrink-0 ${noStock?'text-red-400':lowStock?'text-amber-400':'text-[#5A5A6A]'}`}>{stock} on hand</span>
                                </div>
                                {(lowStock||noStock)&&<p className="text-xs mt-0.5 text-amber-400">{noStock?'Out of stock':'Low stock for this qty'}</p>}
                              </button>
                            )})}
                          </div>
                        )}
                      </td>
                      <td className="px-1 py-1"><input value={l.description} onChange={e=>setLine(i,{description:e.target.value})} placeholder="Description…" className={inpSm+' min-w-[110px]'}/></td>
                      <td className="px-1 py-1 w-16"><input type="number" value={l.quantity} onChange={e=>setLine(i,{quantity:e.target.value})} min="0" className={inpSm+' text-right'}/></td>
                      <td className="px-1 py-1 w-16"><input type="number" value={l.quantity_shipped} onChange={e=>setLine(i,{quantity_shipped:e.target.value})} min="0" className={inpSm+' text-right'}/></td>
                      <td className="px-1 py-1 w-14"><input value={l.unit_of_measure} onChange={e=>setLine(i,{unit_of_measure:e.target.value})} placeholder="ea" className={inpSm}/></td>
                      <td className="px-1 py-1 w-24"><input type="number" value={l.unit_price} onChange={e=>setLine(i,{unit_price:e.target.value})} min="0" step="0.01" className={inpSm+' text-right'}/></td>
                      <td className="px-1 py-1 w-14"><input type="number" value={l.discount_pct} onChange={e=>setLine(i,{discount_pct:e.target.value})} min="0" max="100" step="0.1" className={inpSm+' text-right'}/></td>
                      <td className="px-2 py-1.5 text-white text-right w-20 font-medium tabular-nums">{fmt$(lineTotal(l))}</td>
                      <td className="px-1 py-1"><button onClick={()=>removeLine(i)} className="text-[#3A3A4A] hover:text-red-400 transition-colors p-0.5 block"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-3">
              <div className="w-52 space-y-1.5 text-xs">
                <div className="flex justify-between text-[#9898A8]"><span>Subtotal</span><span className="tabular-nums">{fmt$(subtotal)}</span></div>
                <div className="flex justify-between text-[#9898A8]"><span>Tax ({form.tax_pct||'0'}%)</span><span className="tabular-nums">{fmt$(taxAmt)}</span></div>
                <div className="flex justify-between font-semibold text-white border-t border-[#2A2A35] pt-2"><span>Total</span><span className="tabular-nums">{fmt$(grandTotal)}</span></div>
              </div>
            </div>
          </section>

          {editing&&(<>
            <div className="border-t border-[#2A2A35] pt-5"><LinkedTasks recordType="sales_orders" recordId={editing.id} defaultCustomerId={editing.customer_id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-[#2A2A35] pt-5"><FileUpload supabase={sb} recordType="sales_orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-[#2A2A35] pt-5"><CommentSection recordType="sales_orders" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-[#2A2A35] space-y-3">
          {err&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            <button onClick={close} className="flex-1 bg-[#18181C] hover:bg-[#22222A] border border-[#2A2A35] text-white text-sm px-4 py-2.5 rounded-xl transition-all">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-[#00C896] hover:bg-[#00B085] disabled:opacity-50 text-black font-semibold text-sm px-4 py-2.5 rounded-xl transition-all">{saving?'Saving…':'Save Order'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
