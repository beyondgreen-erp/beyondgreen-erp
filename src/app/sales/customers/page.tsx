'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import RichTextEditor from '@/components/RichTextEditor'
import LinkedTasks from '@/components/LinkedTasks'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Customer {
  id: string; company_name: string; contact_name: string | null; email: string | null
  phone: string | null; billing_address: string | null; shipping_address: string | null
  payment_terms: string | null; notes: string | null; is_active: boolean; created_at: string
  pipeline_stage: string | null; deal_value: number | null; probability: number | null
  priority: string | null; industry: string | null; lead_source: string | null
  expected_close_date: string | null; next_follow_up: string | null
  do_not_contact: boolean; customer_status: string | null
}
interface Contact {
  id: string; customer_id: string; full_name: string; title: string | null
  email: string | null; phone: string | null; is_primary: boolean; notes: string | null
}

const PIPELINE_STAGES = ['Lead','Contacted','Qualified','Proposal Sent','Negotiating','Closed Won','Closed Lost']
const CUSTOMER_STATUSES = ['Lead','Prospect','Active Customer','Inactive','Do Not Contact']
const LEAD_SOURCES = ['Referral','Trade Show','Website','Cold Outreach','Social Media','Other']
const PAYMENT_TERMS = ['Net 15','Net 30','Net 45','COD']

const STAGE_COLORS: Record<string,string> = {
  Lead:'border-gray-600 bg-gray-800/40', Contacted:'border-blue-600/40 bg-blue-900/20',
  Qualified:'border-violet-600/40 bg-violet-900/20', 'Proposal Sent':'border-amber-600/40 bg-amber-900/20',
  Negotiating:'border-orange-600/40 bg-orange-900/20', 'Closed Won':'border-emerald-600/40 bg-emerald-900/20',
  'Closed Lost':'border-red-600/40 bg-red-900/20',
}
const STAGE_BADGE: Record<string,string> = {
  Lead:'bg-gray-700/40 text-gray-400 border-gray-600', Contacted:'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Qualified:'bg-violet-500/15 text-violet-400 border-violet-500/20', 'Proposal Sent':'bg-amber-500/15 text-amber-400 border-amber-500/20',
  Negotiating:'bg-orange-500/15 text-orange-400 border-orange-500/20', 'Closed Won':'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'Closed Lost':'bg-red-500/15 text-red-400 border-red-500/20',
}
const STATUS_BADGE: Record<string,string> = {
  Lead:'bg-gray-700/40 text-gray-400 border-gray-600', Prospect:'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Active Customer':'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  Inactive:'bg-gray-600/20 text-gray-500 border-gray-600', 'Do Not Contact':'bg-red-500/15 text-red-400 border-red-500/20',
}

const emptyForm = {
  company_name:'', email:'', phone:'', billing_address:'', shipping_address:'',
  payment_terms:'Net 30', notes:'', pipeline_stage:'Lead', customer_status:'Lead',
  deal_value:'', probability:'0', industry:'', lead_source:'', expected_close_date:'',
  next_follow_up:'', do_not_contact: false,
}
type F = typeof emptyForm
const emptyContact = { full_name:'', title:'', email:'', phone:'', is_primary:false, notes:'' }

const fmt$ = (n:number|null) => n ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n) : '—'
const fmtD = (d:string|null) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'
function initials(name:string){ return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) }
const AVATAR_COLORS = ['bg-blue-600','bg-violet-600','bg-emerald-600','bg-amber-600','bg-rose-600','bg-cyan-600']
function avatarColor(str:string){ let h=0; for(let i=0;i<str.length;i++)h=str.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }

export default function CustomersPage() {
  const supabase = useMemo(()=>createSupabaseBrowserClient(),[])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [primaryContacts, setPrimaryContacts] = useState<Record<string,Contact>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [viewMode, setViewMode] = useState<'table'|'pipeline'>('table')

  // Panel
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Customer|null>(null)
  const [activeTab, setActiveTab] = useState<'info'|'contacts'|'activity'|'files'>('info')
  const [form, setForm] = useState<F>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [formError, setFormError] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([])
  const [addingContact, setAddingContact] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact|null>(null)
  const [contactForm, setContactForm] = useState(emptyContact)
  const [savingContact, setSavingContact] = useState(false)
  const [deletingContact, setDeletingContact] = useState<string|null>(null)

  // Activity
  const [activityTab, setActivityTab] = useState<'orders'|'quotes'|'tasks'>('orders')
  const [activityOrders, setActivityOrders] = useState<any[]>([])
  const [activityQuotes, setActivityQuotes] = useState<any[]>([])
  const [activityTasks, setActivityTasks] = useState<any[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  // Pipeline drag
  const [draggingId, setDraggingId] = useState<string|null>(null)
  const [dragOverStage, setDragOverStage] = useState<string|null>(null)

  // ── Load ──────────────────────────────────────────────────
  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    const [{ data: c }, { data: pc }] = await Promise.all([
      supabase.from('customers').select('*').order('company_name'),
      supabase.from('customer_contacts').select('*').eq('is_primary', true),
    ])
    if (c) setCustomers(c as Customer[])
    if (pc) {
      const map: Record<string,Contact> = {}
      ;(pc as Contact[]).forEach(ct => { map[ct.customer_id] = ct })
      setPrimaryContacts(map)
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchCustomers()
    supabase.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  // ── Filtering ─────────────────────────────────────────────
  const filtered = customers.filter(c => {
    if (!showArchived && !c.is_active) return false
    if (showArchived && c.is_active) return false
    if (stageFilter !== 'all' && (c.customer_status||'Lead') !== stageFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    const pc = primaryContacts[c.id]
    return c.company_name.toLowerCase().includes(q) ||
      (c.contact_name??'').toLowerCase().includes(q) ||
      (c.email??'').toLowerCase().includes(q) ||
      (pc?.full_name??'').toLowerCase().includes(q) ||
      (pc?.email??'').toLowerCase().includes(q) ||
      (c.pipeline_stage??'').toLowerCase().includes(q)
  })

  // ── Panel helpers ──────────────────────────────────────────
  function openAdd() {
    setEditing(null); setForm(emptyForm); setFormError(''); setActiveTab('info')
    setContacts([]); setAddingContact(false); setEditingContact(null)
    setPanelOpen(true)
  }

  async function openEdit(c: Customer) {
    setEditing(c)
    setForm({
      company_name:c.company_name, email:c.email??'', phone:c.phone??'',
      billing_address:c.billing_address??'', shipping_address:c.shipping_address??'',
      payment_terms:c.payment_terms??'Net 30', notes:c.notes??'',
      pipeline_stage:c.pipeline_stage??'Lead', customer_status:c.customer_status??'Lead',
      deal_value:c.deal_value!=null?String(c.deal_value):'', probability:String(c.probability??0),
      industry:c.industry??'', lead_source:c.lead_source??'',
      expected_close_date:c.expected_close_date??'', next_follow_up:c.next_follow_up??'',
      do_not_contact:c.do_not_contact??false,
    })
    setFormError(''); setActiveTab('info')
    setAddingContact(false); setEditingContact(null)
    setPanelOpen(true)
    // Load contacts
    const { data: cts } = await supabase.from('customer_contacts').select('*').eq('customer_id', c.id).order('is_primary', { ascending: false })
    setContacts((cts as Contact[]) ?? [])
  }

  function closePanel() {
    setPanelOpen(false)
    setTimeout(() => { setEditing(null); setForm(emptyForm); setContacts([]) }, 300)
  }

  // ── Activity load ─────────────────────────────────────────
  async function loadActivity(cid: string) {
    setActivityLoading(true)
    const [{ data: o }, { data: q }, { data: t }] = await Promise.all([
      supabase.from('sales_orders').select('id,order_number,status,order_date,total').eq('customer_id', cid).order('created_at', { ascending: false }),
      supabase.from('quotations').select('id,quote_number,status,quote_date,total').eq('customer_id', cid).order('created_at', { ascending: false }),
      supabase.from('tasks').select('id,task_name,status,due_date,priority').eq('customer_id', cid).eq('is_active', true).order('created_at', { ascending: false }),
    ])
    setActivityOrders((o as any[]) ?? [])
    setActivityQuotes((q as any[]) ?? [])
    setActivityTasks((t as any[]) ?? [])
    setActivityLoading(false)
  }

  useEffect(() => {
    if (activeTab === 'activity' && editing) loadActivity(editing.id)
  }, [activeTab, editing?.id]) // eslint-disable-line

  // ── Save customer ─────────────────────────────────────────
  async function handleSave() {
    if (!form.company_name.trim()) { setFormError('Company Name is required.'); return }
    setFormError(''); setSaving(true)
    const payload = {
      company_name:form.company_name.trim(), email:form.email.trim()||null, phone:form.phone.trim()||null,
      billing_address:form.billing_address.trim()||null, shipping_address:form.shipping_address.trim()||null,
      payment_terms:form.payment_terms, notes:form.notes||null,
      pipeline_stage:form.pipeline_stage||'Lead', customer_status:form.customer_status||'Lead',
      deal_value:form.deal_value?parseFloat(form.deal_value):null, probability:parseInt(form.probability)||0,
      industry:form.industry.trim()||null, lead_source:form.lead_source||null,
      expected_close_date:form.expected_close_date||null, next_follow_up:form.next_follow_up||null,
      do_not_contact:form.do_not_contact,
    }
    if (editing) {
      const { error } = await supabase.from('customers').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id)
      if (error) { setFormError(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('customers').insert({ ...payload, is_active: true })
      if (error) { setFormError(error.message); setSaving(false); return }
    }
    setSaving(false); closePanel(); fetchCustomers()
  }

  async function handleArchive() {
    if (!editing) return
    setArchiving(true)
    await supabase.from('customers').update({ is_active: !editing.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id)
    setArchiving(false); closePanel(); fetchCustomers()
  }

  // ── Contacts ──────────────────────────────────────────────
  async function saveContact() {
    if (!contactForm.full_name.trim() || !editing) return
    setSavingContact(true)
    if (contactForm.is_primary) {
      await supabase.from('customer_contacts').update({ is_primary: false }).eq('customer_id', editing.id)
    }
    if (editingContact) {
      await supabase.from('customer_contacts').update({ ...contactForm, updated_at: new Date().toISOString() }).eq('id', editingContact.id)
    } else {
      // auto-primary if first contact
      const isPrimary = contactForm.is_primary || contacts.length === 0
      await supabase.from('customer_contacts').insert({ ...contactForm, customer_id: editing.id, is_primary: isPrimary })
    }
    const { data } = await supabase.from('customer_contacts').select('*').eq('customer_id', editing.id).order('is_primary', { ascending: false })
    setContacts((data as Contact[]) ?? [])
    // update primary contacts map
    const pc = (data as Contact[])?.find(c => c.is_primary)
    if (pc) setPrimaryContacts(prev => ({ ...prev, [editing.id]: pc }))
    setSavingContact(false); setAddingContact(false); setEditingContact(null); setContactForm(emptyContact)
  }

  async function deleteContact(id: string) {
    if (!confirm('Delete this contact?') || !editing) return
    setDeletingContact(id)
    await supabase.from('customer_contacts').delete().eq('id', id)
    const { data } = await supabase.from('customer_contacts').select('*').eq('customer_id', editing.id).order('is_primary', { ascending: false })
    setContacts((data as Contact[]) ?? [])
    const pc = (data as Contact[])?.find(c => c.is_primary)
    if (pc) setPrimaryContacts(prev => ({ ...prev, [editing.id]: pc }))
    else setPrimaryContacts(prev => { const n = {...prev}; delete n[editing.id]; return n })
    setDeletingContact(null)
  }

  async function setPrimary(contact: Contact) {
    if (!editing) return
    await supabase.from('customer_contacts').update({ is_primary: false }).eq('customer_id', editing.id)
    await supabase.from('customer_contacts').update({ is_primary: true }).eq('id', contact.id)
    const { data } = await supabase.from('customer_contacts').select('*').eq('customer_id', editing.id).order('is_primary', { ascending: false })
    setContacts((data as Contact[]) ?? [])
    const pc = (data as Contact[])?.find(c => c.is_primary)
    if (pc) setPrimaryContacts(prev => ({ ...prev, [editing.id]: pc }))
  }

  // ── Pipeline drag-and-drop ────────────────────────────────
  async function dropOnStage(stage: string) {
    if (!draggingId || draggingId === null) return
    setDragOverStage(null); setDraggingId(null)
    setCustomers(prev => prev.map(c => c.id === draggingId ? { ...c, pipeline_stage: stage } : c))
    await supabase.from('customers').update({ pipeline_stage: stage, updated_at: new Date().toISOString() }).eq('id', draggingId)
  }

  // ── Helpers ───────────────────────────────────────────────
  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'
  const sel = inp + ' cursor-pointer'
  const tabs: { key: 'info'|'contacts'|'activity'|'files'; label: string }[] = [
    { key: 'info', label: 'Company Info' },
    { key: 'contacts', label: `Contacts${contacts.length ? ` (${contacts.length})` : ''}` },
    { key: 'activity', label: 'Activity' },
    { key: 'files', label: 'Files & Notes' },
  ]

  // ── Table columns header ──────────────────────────────────
  const STATUS_FILTERS = ['all','Lead','Prospect','Active Customer','Inactive']

  return (
    <div className="p-4 md:p-8 min-h-screen">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Customers</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading?'Loading…':`${filtered.length} ${showArchived?'archived':'active'} customer${filtered.length!==1?'s':''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700">
            <button onClick={()=>setViewMode('table')} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors ${viewMode==='table'?'bg-gray-700 text-white':'text-gray-400 hover:text-white'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M3 14h18M3 18h18"/></svg>Table
            </button>
            <button onClick={()=>setViewMode('pipeline')} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors ${viewMode==='pipeline'?'bg-gray-700 text-white':'text-gray-400 hover:text-white'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>Pipeline
            </button>
          </div>
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Customer
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input placeholder="Search by name, contact, email…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div onClick={()=>setShowArchived(v=>!v)} className={`w-9 h-5 rounded-full transition-colors relative ${showArchived?'bg-blue-600':'bg-gray-700'}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showArchived?'translate-x-4':'translate-x-0.5'}`}/></div>
            <span className="text-sm text-gray-400">Archived</span>
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map(f=>(
            <button key={f} onClick={()=>setStageFilter(f)} className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${stageFilter===f?'bg-blue-600 border-blue-600 text-white':'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'}`}>
              {f==='all'?'All':f}
            </button>
          ))}
        </div>
      </div>

      {/* ── TABLE VIEW ── */}
      {viewMode==='table'&&(
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
          {loading?<div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
          :filtered.length===0?<div className="flex items-center justify-center py-20"><p className="text-gray-500 text-sm">{search?'No matches.':showArchived?'No archived customers.':'No customers yet.'}</p></div>
          :<table className="w-full min-w-[800px] text-sm">
            <thead><tr className="border-b border-gray-800">
              {['Company','Primary Contact','Email','Phone','Pipeline Stage','Deal Value','Status'].map(h=><th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}
            </tr></thead>
            <tbody>{filtered.map((c,i)=>{
              const pc=primaryContacts[c.id]
              return <tr key={c.id} onClick={()=>openEdit(c)} className={`border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/40 transition-colors ${i%2?'bg-gray-800/10':''}`}>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full ${avatarColor(c.company_name)} flex items-center justify-center shrink-0`}>
                      <span className="text-white font-semibold text-xs">{initials(c.company_name)}</span>
                    </div>
                    <span className="text-white font-medium">{c.company_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-gray-400 text-sm">{pc?.full_name||'—'}</td>
                <td className="px-4 py-3.5 text-gray-400 text-sm">{pc?.email||c.email||'—'}</td>
                <td className="px-4 py-3.5 text-gray-400 text-sm">{pc?.phone||c.phone||'—'}</td>
                <td className="px-4 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${STAGE_BADGE[c.pipeline_stage||'Lead']||STAGE_BADGE.Lead}`}>{c.pipeline_stage||'Lead'}</span></td>
                <td className="px-4 py-3.5 text-gray-300 font-medium">{fmt$(c.deal_value)}</td>
                <td className="px-4 py-3.5"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${STATUS_BADGE[c.customer_status||'Lead']||STATUS_BADGE.Lead}`}>{c.customer_status||'Lead'}</span></td>
              </tr>
            })}</tbody>
          </table>}
        </div>
      )}

      {/* ── PIPELINE VIEW ── */}
      {viewMode==='pipeline'&&(
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {PIPELINE_STAGES.map(stage=>{
              const stageCustomers=filtered.filter(c=>(c.pipeline_stage||'Lead')===stage)
              const stageTotal=stageCustomers.reduce((s,c)=>s+(c.deal_value||0),0)
              const isOver=dragOverStage===stage
              return (
                <div
                  key={stage}
                  className={`w-60 flex flex-col rounded-xl border transition-colors ${isOver?'border-blue-500 bg-blue-900/10':STAGE_COLORS[stage]||STAGE_COLORS.Lead}`}
                  onDragOver={e=>{e.preventDefault();setDragOverStage(stage)}}
                  onDragLeave={()=>setDragOverStage(s=>s===stage?null:s)}
                  onDrop={()=>dropOnStage(stage)}
                >
                  <div className="px-3 py-2.5 border-b border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{stage}</span>
                      <span className="text-xs text-gray-500">{stageCustomers.length}</span>
                    </div>
                    {stageTotal>0&&<p className="text-xs text-gray-500 mt-0.5">{fmt$(stageTotal)}</p>}
                  </div>
                  <div className="p-2 space-y-2 min-h-[120px]">
                    {stageCustomers.map(c=>{
                      const pc=primaryContacts[c.id]
                      return (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={()=>setDraggingId(c.id)}
                          onDragEnd={()=>{setDraggingId(null);setDragOverStage(null)}}
                          onClick={()=>openEdit(c)}
                          className={`bg-gray-900 border border-gray-700 rounded-lg p-2.5 cursor-pointer hover:border-gray-600 transition-colors ${draggingId===c.id?'opacity-40':''}`}
                        >
                          <p className="text-xs text-white font-medium leading-tight">{c.company_name}</p>
                          {pc&&<p className="text-xs text-gray-500 mt-0.5">{pc.full_name}</p>}
                          {c.deal_value&&<p className="text-xs text-emerald-400 font-medium mt-1">{fmt$(c.deal_value)}</p>}
                          {c.probability!=null&&c.probability>0&&<p className="text-xs text-gray-600 mt-0.5">{c.probability}% probability</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── OVERLAY ── */}
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${panelOpen?'opacity-100':'opacity-0 pointer-events-none'}`} onClick={closePanel}/>

      {/* ── PANEL ── */}
      <div ref={panelRef} onClick={e=>e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[640px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${panelOpen?'translate-x-0':'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            {editing&&<div className={`w-8 h-8 rounded-full ${avatarColor(editing.company_name)} flex items-center justify-center`}><span className="text-white font-bold text-xs">{initials(editing.company_name)}</span></div>}
            <div>
              <h2 className="text-white font-semibold text-sm">{editing?editing.company_name:'Add Customer'}</h2>
              {editing&&<p className="text-xs text-gray-500">{editing.customer_status||'Lead'}</p>}
            </div>
          </div>
          <button onClick={closePanel} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 shrink-0 px-2">
          {tabs.map(t=>(
            <button key={t.key} onClick={()=>setActiveTab(t.key)} className={`px-4 py-3 text-xs font-medium transition-colors relative ${activeTab===t.key?'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-500':'text-gray-500 hover:text-gray-300'}`}>{t.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── TAB: Company Info ── */}
          {activeTab==='info'&&(
            <div className="px-6 py-5 space-y-4">
              <div><label className="block text-xs text-gray-400 mb-1.5">Company Name <span className="text-red-400">*</span></label><input value={form.company_name} onChange={e=>setForm(p=>({...p,company_name:e.target.value}))} className={inp}/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs text-gray-400 mb-1.5">Customer Status</label>
                  <select value={form.customer_status} onChange={e=>setForm(p=>({...p,customer_status:e.target.value}))} className={sel}>
                    {CUSTOMER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Pipeline Stage</label>
                  <select value={form.pipeline_stage} onChange={e=>setForm(p=>({...p,pipeline_stage:e.target.value}))} className={sel}>
                    {PIPELINE_STAGES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Industry</label><input value={form.industry} onChange={e=>setForm(p=>({...p,industry:e.target.value}))} placeholder="e.g. Food & Beverage" className={inp}/></div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Lead Source</label>
                  <select value={form.lead_source} onChange={e=>setForm(p=>({...p,lead_source:e.target.value}))} className={sel}>
                    <option value="">— None —</option>{LEAD_SOURCES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Deal Value ($)</label><input type="number" min="0" value={form.deal_value} onChange={e=>setForm(p=>({...p,deal_value:e.target.value}))} className={inp}/></div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Probability %</label><input type="number" min="0" max="100" value={form.probability} onChange={e=>setForm(p=>({...p,probability:e.target.value}))} className={inp}/></div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Expected Close</label><input type="date" value={form.expected_close_date} onChange={e=>setForm(p=>({...p,expected_close_date:e.target.value}))} className={inp}/></div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Next Follow Up</label><input type="date" value={form.next_follow_up} onChange={e=>setForm(p=>({...p,next_follow_up:e.target.value}))} className={inp}/></div>
              </div>
              <div><label className="block text-xs text-gray-400 mb-1.5">Payment Terms</label>
                <select value={form.payment_terms} onChange={e=>setForm(p=>({...p,payment_terms:e.target.value}))} className={sel}>
                  {PAYMENT_TERMS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-gray-400 mb-1.5">Email</label><input type="email" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} className={inp}/></div>
              <div><label className="block text-xs text-gray-400 mb-1.5">Phone</label><input type="tel" value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} className={inp}/></div>
              <div><label className="block text-xs text-gray-400 mb-1.5">Billing Address</label><textarea rows={2} value={form.billing_address} onChange={e=>setForm(p=>({...p,billing_address:e.target.value}))} className={inp+' resize-none'}/></div>
              <div><label className="block text-xs text-gray-400 mb-1.5">Shipping Address</label><textarea rows={2} value={form.shipping_address} onChange={e=>setForm(p=>({...p,shipping_address:e.target.value}))} className={inp+' resize-none'}/></div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={form.do_not_contact} onChange={e=>setForm(p=>({...p,do_not_contact:e.target.checked}))} className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-red-500"/>
                  <span className="text-sm text-gray-400">Do Not Contact</span>
                </label>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
                <RichTextEditor content={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} placeholder="Add notes…" supabase={supabase}/>
              </div>
            </div>
          )}

          {/* ── TAB: Contacts ── */}
          {activeTab==='contacts'&&(
            <div className="px-6 py-5 space-y-3">
              {contacts.length===0&&!addingContact&&(
                <p className="text-sm text-gray-500 italic">No contacts yet.</p>
              )}
              {contacts.map(ct=>{
                const isEditing=editingContact?.id===ct.id
                if(isEditing){
                  return (
                    <div key={ct.id} className="bg-gray-800 border border-blue-500/30 rounded-xl p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs text-gray-400 mb-1">Full Name <span className="text-red-400">*</span></label><input value={contactForm.full_name} onChange={e=>setContactForm(p=>({...p,full_name:e.target.value}))} className={inp}/></div>
                        <div><label className="block text-xs text-gray-400 mb-1">Title</label><input value={contactForm.title} onChange={e=>setContactForm(p=>({...p,title:e.target.value}))} placeholder="e.g. CEO" className={inp}/></div>
                        <div><label className="block text-xs text-gray-400 mb-1">Email</label><input type="email" value={contactForm.email} onChange={e=>setContactForm(p=>({...p,email:e.target.value}))} className={inp}/></div>
                        <div><label className="block text-xs text-gray-400 mb-1">Phone</label><input type="tel" value={contactForm.phone} onChange={e=>setContactForm(p=>({...p,phone:e.target.value}))} className={inp}/></div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={contactForm.is_primary} onChange={e=>setContactForm(p=>({...p,is_primary:e.target.checked}))} className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500"/>
                        <span className="text-xs text-gray-400">Set as Primary Contact</span>
                      </label>
                      <div className="flex gap-2">
                        <button onClick={()=>{setEditingContact(null);setContactForm(emptyContact)}} className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button onClick={saveContact} disabled={savingContact} className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium transition-colors">{savingContact?'Saving…':'Save'}</button>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={ct.id} className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-full ${avatarColor(ct.full_name)} flex items-center justify-center shrink-0`}>
                        <span className="text-white font-bold text-xs">{initials(ct.full_name)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white font-medium">{ct.full_name}</p>
                          {ct.is_primary&&<span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded font-medium">Primary</span>}
                        </div>
                        {ct.title&&<p className="text-xs text-gray-500 mt-0.5">{ct.title}</p>}
                        {ct.email&&<a href={`mailto:${ct.email}`} onClick={e=>e.stopPropagation()} className="text-xs text-blue-400 hover:underline mt-1 block">{ct.email}</a>}
                        {ct.phone&&<a href={`tel:${ct.phone}`} onClick={e=>e.stopPropagation()} className="text-xs text-gray-400 mt-0.5 block">{ct.phone}</a>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!ct.is_primary&&<button onClick={()=>setPrimary(ct)} title="Set as primary" className="p-1.5 text-gray-600 hover:text-blue-400 transition-colors rounded"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z"/></svg></button>}
                        <button onClick={()=>{setEditingContact(ct);setContactForm({full_name:ct.full_name,title:ct.title??'',email:ct.email??'',phone:ct.phone??'',is_primary:ct.is_primary,notes:ct.notes??''})}} className="p-1.5 text-gray-600 hover:text-white transition-colors rounded"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                        <button onClick={()=>deleteContact(ct.id)} disabled={deletingContact===ct.id} className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded disabled:opacity-50"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Add contact form */}
              {addingContact&&!editingContact&&(
                <div className="bg-gray-800 border border-blue-500/30 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">New Contact</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-400 mb-1">Full Name <span className="text-red-400">*</span></label><input value={contactForm.full_name} onChange={e=>setContactForm(p=>({...p,full_name:e.target.value}))} className={inp} autoFocus/></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Title</label><input value={contactForm.title} onChange={e=>setContactForm(p=>({...p,title:e.target.value}))} placeholder="e.g. CEO" className={inp}/></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Email</label><input type="email" value={contactForm.email} onChange={e=>setContactForm(p=>({...p,email:e.target.value}))} className={inp}/></div>
                    <div><label className="block text-xs text-gray-400 mb-1">Phone</label><input type="tel" value={contactForm.phone} onChange={e=>setContactForm(p=>({...p,phone:e.target.value}))} className={inp}/></div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={contactForm.is_primary} onChange={e=>setContactForm(p=>({...p,is_primary:e.target.checked}))} className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500"/>
                    <span className="text-xs text-gray-400">Set as Primary Contact</span>
                  </label>
                  <div className="flex gap-2">
                    <button onClick={()=>{setAddingContact(false);setContactForm(emptyContact)}} className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
                    <button onClick={saveContact} disabled={savingContact} className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium transition-colors">{savingContact?'Saving…':'Add Contact'}</button>
                  </div>
                </div>
              )}

              {!addingContact&&!editingContact&&(
                <button onClick={()=>{setAddingContact(true);setContactForm(emptyContact)}} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-700 hover:border-gray-600 text-gray-500 hover:text-gray-300 rounded-xl py-3 text-xs font-medium transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Contact
                </button>
              )}
            </div>
          )}

          {/* ── TAB: Activity ── */}
          {activeTab==='activity'&&(
            <div className="px-6 py-5">
              <div className="flex gap-1 mb-4 bg-gray-800/60 p-1 rounded-lg w-fit">
                {(['orders','quotes','tasks'] as const).map(t=>(
                  <button key={t} onClick={()=>setActivityTab(t)} className={`text-xs px-3 py-1.5 rounded-md transition-colors capitalize ${activityTab===t?'bg-gray-700 text-white':'text-gray-400 hover:text-white'}`}>{t}</button>
                ))}
              </div>
              {activityLoading?<div className="flex justify-center py-8"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
              :activityTab==='orders'?(<div className="space-y-2">
                {activityOrders.length===0?<p className="text-sm text-gray-500 italic">No orders.</p>
                :activityOrders.map(o=><a key={o.id} href="/sales/orders" className="flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 hover:border-gray-600 transition-colors">
                  <div><p className="text-sm text-white font-medium font-mono">{o.order_number}</p><p className="text-xs text-gray-500">{fmtD(o.order_date)}</p></div>
                  <div className="flex items-center gap-3"><span className={`text-xs px-2 py-1 rounded-full border ${STAGE_BADGE[o.status]||STAGE_BADGE.Lead}`}>{o.status}</span><span className="text-sm text-gray-300 font-medium">{fmt$(o.total)}</span></div>
                </a>)}
              </div>)
              :activityTab==='quotes'?(<div className="space-y-2">
                {activityQuotes.length===0?<p className="text-sm text-gray-500 italic">No quotations.</p>
                :activityQuotes.map(q=><a key={q.id} href="/sales/quotations" className="flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 hover:border-gray-600 transition-colors">
                  <div><p className="text-sm text-white font-medium font-mono">{q.quote_number}</p><p className="text-xs text-gray-500">{fmtD(q.quote_date)}</p></div>
                  <div className="flex items-center gap-3"><span className={`text-xs px-2 py-1 rounded-full border ${STAGE_BADGE[q.status]||STAGE_BADGE.Lead}`}>{q.status}</span><span className="text-sm text-gray-300 font-medium">{fmt$(q.total)}</span></div>
                </a>)}
              </div>)
              :(<div className="space-y-2">
                {activityTasks.length===0?<p className="text-sm text-gray-500 italic">No tasks.</p>
                :activityTasks.map(t=><a key={t.id} href="/bizdev/tasks" className="flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 hover:border-gray-600 transition-colors">
                  <div><p className="text-sm text-white font-medium">{t.task_name}</p><p className="text-xs text-gray-500">{t.due_date?fmtD(t.due_date):'No due date'}</p></div>
                  <span className={`text-xs px-2 py-1 rounded-full border ${STAGE_BADGE[t.status]||STAGE_BADGE.Lead}`}>{t.status}</span>
                </a>)}
              </div>)}
            </div>
          )}

          {/* ── TAB: Files & Comments ── */}
          {activeTab==='files'&&editing&&(
            <div className="px-6 py-5 space-y-5">
              <LinkedTasks recordType="customers" recordId={editing.id} currentUserEmail={userEmail}/>
              <div className="border-t border-gray-800 pt-4"><FileUpload supabase={supabase} recordType="customers" recordId={editing.id} currentUserEmail={userEmail}/></div>
              <div className="border-t border-gray-800 pt-4"><CommentSection recordType="customers" recordId={editing.id} currentUserEmail={userEmail}/></div>
            </div>
          )}
          {activeTab==='files'&&!editing&&(
            <div className="px-6 py-5"><p className="text-sm text-gray-500 italic">Save the customer first to attach files and comments.</p></div>
          )}
        </div>

        {/* Footer (only show on info tab) */}
        {activeTab==='info'&&(
          <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
            {formError&&<div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><p className="text-red-400 text-xs">{formError}</p></div>}
            <div className="flex gap-3">
              {editing&&<button onClick={handleArchive} disabled={archiving} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">{archiving?'…':editing.is_active?'Archive':'Restore'}</button>}
              <button onClick={closePanel} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">{saving?'Saving…':'Save Customer'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
