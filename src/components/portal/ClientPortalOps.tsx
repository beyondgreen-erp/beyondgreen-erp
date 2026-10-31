'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Staff views for the client portal self-service features, shown as tabs on
// Bizdev > Client Portals: Sign-ups & approvals, Portal orders, Calls, Shared documents.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const GREEN = '#037f4c'
const fmt = (d: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const fmtDay = (d: string | null) => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const inp = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40'
const card = 'bg-white rounded-xl border border-[#ECEEF3] shadow-sm'
async function post(path: string, body: any) {
  const r = await fetch(`/api/portal/self/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

type Sb = ReturnType<typeof createSupabaseBrowserClient>

function CustomerPicker({ sb, onPick }: { sb: Sb; onPick: (c: { id: string; company_name: string }) => void }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState<any[]>([])
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return }
    let alive = true
    sb.from('customers').select('id, company_name, customer_status').eq('board', 'customer').not('is_merged', 'is', true).ilike('company_name', `%${q.trim()}%`).order('company_name').limit(15).then(({ data }) => { if (alive) setRes(data || []) })
    return () => { alive = false }
  }, [q, sb])
  return (
    <div className="relative">
      <input className={inp} placeholder="Search customers to link…" value={q} onChange={e => setQ(e.target.value)} />
      {res.length > 0 && <div className="absolute z-20 mt-1 left-0 right-0 max-h-56 overflow-auto bg-white border border-[#E4E6EE] rounded-lg shadow-lg">{res.map(c => <button key={c.id} onClick={() => { onPick(c); setQ(''); setRes([]) }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">{c.company_name} <span className="text-[11px] text-gray-400">{c.customer_status}</span></button>)}</div>}
    </div>
  )
}

const OB_LABELS: [string, string][] = [
  ['legal_name', 'Legal name'], ['dba', 'DBA'], ['website', 'Website'], ['main_phone', 'Main phone'], ['business_type', 'Business type'], ['locations', 'Locations'], ['years_in_business', 'Years in business'], ['est_annual_spend', 'Est. annual spend'],
  ['ap_name', 'AP contact'], ['ap_email', 'AP email'], ['ap_phone', 'AP phone'], ['receiving_name', 'Receiving contact'], ['receiving_email', 'Receiving email'], ['receiving_phone', 'Receiving phone'],
  ['billing_address', 'Billing address'], ['shipping_address', 'Ship-to'], ['receiving_hours', 'Receiving hours'], ['freight_account', 'Freight account'],
  ['tax_status', 'Sales tax'], ['resale_number', 'Resale / exemption #'], ['payment_method', 'Payment method'], ['terms_requested', 'Terms requested'], ['bank_name', 'Bank'], ['bank_contact', 'Bank contact'], ['bank_phone', 'Bank phone'],
  ['interest', 'Interested in'], ['how_heard', 'How heard'], ['signature', 'Signed by'], ['signer_title', 'Signer title'],
]

function Signups({ sb, toast }: { sb: Sb; toast: (m: string) => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [custMap, setCustMap] = useState<Record<string, any>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const load = useCallback(async () => {
    const { data } = await sb.from('portal_clients').select('id, customer_id, name, company_name, email, phone, title, signup_source, email_verified_at, approved_at, approved_by, onboarding, onboarding_submitted_at, created_at, is_active').order('created_at', { ascending: false }).limit(300)
    const list = (data || []) as any[]
    setRows(list)
    const ids = Array.from(new Set(list.map(r => r.customer_id).filter(Boolean)))
    if (ids.length) { const { data: cs } = await sb.from('customers').select('id, company_name, customer_status, lead_source').in('id', ids); const m: any = {}; (cs || []).forEach((c: any) => { m[c.id] = c }); setCustMap(m) }
  }, [sb])
  useEffect(() => { load() }, [load])
  const shown = rows.filter(r => filter === 'all' || !r.approved_at)

  async function approve(r: any, yes = true) {
    setBusy(r.id); const { ok, data } = await post('staff-approve', { clientId: r.id, approve: yes }); setBusy(null)
    toast(ok ? (yes ? `Approved ${r.company_name || r.email}. They were emailed.` : 'Approval removed.') : (data.error || 'Could not update.')); if (ok) load()
  }
  async function link(r: any, c: any) {
    setBusy(r.id); const { ok, data } = await post('staff-link', { clientId: r.id, customerId: c.id }); setBusy(null)
    toast(ok ? `Linked to ${c.company_name}.` : (data.error || 'Could not link.')); if (ok) load()
  }
  async function openFile(path: string) {
    const { data } = await sb.storage.from('erp-files').createSignedUrl(path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">{(['pending', 'all'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`text-xs font-semibold rounded-lg px-3 py-1.5 ${filter === f ? 'text-white' : 'bg-white border border-[#E4E6EE] text-gray-500'}`} style={filter === f ? { background: GREEN } : {}}>{f === 'pending' ? `Needs approval (${rows.filter(r => !r.approved_at).length})` : `All accounts (${rows.length})`}</button>)}</div>
      {shown.length === 0 && <div className={`${card} p-8 text-center text-sm text-gray-400`}>Nothing waiting. New sign-ups from the portal show up here.</div>}
      {shown.map(r => {
        const c = r.customer_id ? custMap[r.customer_id] : null
        const ob = r.onboarding || {}
        return (
          <div key={r.id} className={`${card} p-4`}>
            <div className="flex flex-wrap items-start gap-3 justify-between">
              <div className="min-w-0">
                <p className="font-bold text-[#1A1D2E]">{r.company_name || c?.company_name || r.email}</p>
                <p className="text-xs text-gray-500">{r.name}{r.title ? ` · ${r.title}` : ''} · {r.email}{r.phone ? ` · ${r.phone}` : ''}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5 text-[11px] font-semibold">
                  <span className={`rounded-full px-2 py-0.5 ${r.signup_source === 'self' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r.signup_source === 'self' ? 'Self sign-up' : 'Staff created'} · {fmtDay(r.created_at)}</span>
                  <span className={`rounded-full px-2 py-0.5 ${r.email_verified_at ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.email_verified_at ? 'Email confirmed' : 'Email not confirmed'}</span>
                  <span className={`rounded-full px-2 py-0.5 ${r.onboarding_submitted_at ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{r.onboarding_submitted_at ? `Onboarding ${fmtDay(r.onboarding_submitted_at)}` : 'Onboarding not sent'}</span>
                  <span className={`rounded-full px-2 py-0.5 ${r.approved_at ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.approved_at ? `Approved${r.approved_by ? ' · ' + r.approved_by : ''}` : 'Pending approval'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#E4E6EE] text-gray-600">{open === r.id ? 'Hide details' : 'Review'}</button>
                {r.approved_at ? <button disabled={busy === r.id} onClick={() => approve(r, false)} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#E4E6EE] text-gray-500">Unapprove</button>
                  : <button disabled={busy === r.id || !r.customer_id} onClick={() => approve(r)} className="text-xs font-semibold rounded-lg px-3 py-1.5 text-white disabled:opacity-40" style={{ background: GREEN }} title={r.customer_id ? '' : 'Link a customer first'}>Approve ordering</button>}
                <a href={`/api/portal/impersonate?clientId=${r.id}`} target="_blank" rel="noreferrer" className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#E4E6EE]" style={{ color: GREEN }}>View portal ↗</a>
              </div>
            </div>
            <div className="mt-3 grid sm:grid-cols-[1fr_280px] gap-3 items-start">
              <p className="text-xs text-gray-600">ERP customer: {c ? <><a href={`/sales/customers?item=${r.customer_id}`} className="font-semibold" style={{ color: GREEN }}>{c.company_name}</a> <span className="text-gray-400">({c.customer_status}{c.lead_source === 'Client portal' ? ', created by sign-up' : ''})</span></> : <span className="text-amber-700 font-semibold">not linked yet</span>}
                {ob.suggested_customer_id && <><br /><span className="text-blue-700">Same email domain as existing customer <b>{ob.suggested_customer_name}</b>.</span> <button onClick={() => link(r, { id: ob.suggested_customer_id, company_name: ob.suggested_customer_name })} className="font-semibold underline" style={{ color: GREEN }}>Link to it</button></>}
              </p>
              <CustomerPicker sb={sb} onPick={cu => link(r, cu)} />
            </div>
            {open === r.id && (
              <div className="mt-3 border-t border-[#F1F3F9] pt-3">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
                  {OB_LABELS.filter(([k]) => ob[k] && (!Array.isArray(ob[k]) || ob[k].length)).map(([k, l]) => <div key={k}><span className="text-gray-400">{l}</span><br /><span className="text-gray-800 whitespace-pre-wrap">{Array.isArray(ob[k]) ? ob[k].join(', ') : String(ob[k])}</span></div>)}
                  {(['liftgate', 'appointment', 'residential', 'will_call'] as const).filter(k => ob[k]).length > 0 && <div><span className="text-gray-400">Delivery</span><br />{(['liftgate', 'appointment', 'residential', 'will_call'] as const).filter(k => ob[k]).map(k => ({ liftgate: 'Liftgate', appointment: 'Appointment', residential: 'Residential', will_call: 'Will call' } as any)[k]).join(', ')}</div>}
                </div>
                {(ob.trade_refs || []).filter((t: any) => t.company).length > 0 && <div className="mt-3 text-xs"><p className="text-gray-400">Trade references</p>{ob.trade_refs.filter((t: any) => t.company).map((t: any, i: number) => <p key={i}>{t.company} · {t.contact} · {t.phone} · {t.email}</p>)}</div>}
                {(ob.files || []).length > 0 && <div className="mt-3 text-xs"><p className="text-gray-400">Documents</p>{ob.files.map((f: any) => <p key={f.path}><button onClick={() => openFile(f.path)} className="font-semibold hover:underline" style={{ color: GREEN }}>📎 {f.slot}: {f.name}</button></p>)}</div>}
                {!Object.keys(ob).length && <p className="text-xs text-gray-400">No onboarding details yet.</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Orders({ sb, toast }: { sb: Sb; toast: (m: string) => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'Submitted' | 'all'>('Submitted')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    let q = sb.from('portal_order_requests').select('*').order('created_at', { ascending: false }).limit(200)
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    const list = (data || []) as any[]; setRows(list)
    const ids = Array.from(new Set(list.map(r => r.customer_id).filter(Boolean)))
    if (ids.length) { const { data: cs } = await sb.from('customers').select('id, company_name').in('id', ids); const m: any = {}; (cs || []).forEach((c: any) => { m[c.id] = c.company_name }); setNames(m) }
  }, [sb, filter])
  useEffect(() => { load() }, [load])
  async function convert(r: any) {
    if (!confirm(`Create a sales order from ${r.request_number}? It lands in the order pipeline as "New Order" with the PO attached.`)) return
    setBusy(r.id); const { ok, data } = await post('order-convert', { id: r.id }); setBusy(null)
    toast(ok ? `Created SO ${data.order_number}. The client was emailed.` : (data.error || 'Could not convert.')); if (ok) load()
  }
  async function decline(r: any) {
    const reason = prompt('Tell the client what needs to change (they will be emailed):') ; if (reason === null) return
    setBusy(r.id); const { ok, data } = await post('order-decline', { id: r.id, reason }); setBusy(null)
    toast(ok ? 'Declined and client notified.' : (data.error || 'Could not decline.')); if (ok) load()
  }
  async function openPo(path: string) { const { data } = await sb.storage.from('erp-files').createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, '_blank') }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">{(['Submitted', 'all'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`text-xs font-semibold rounded-lg px-3 py-1.5 ${filter === f ? 'text-white' : 'bg-white border border-[#E4E6EE] text-gray-500'}`} style={filter === f ? { background: GREEN } : {}}>{f === 'Submitted' ? 'To process' : 'All'}</button>)}</div>
      {rows.length === 0 && <div className={`${card} p-8 text-center text-sm text-gray-400`}>{filter === 'Submitted' ? 'No portal orders waiting.' : 'No portal orders yet.'}</div>}
      {rows.map(r => (
        <div key={r.id} className={`${card} p-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold text-[#1A1D2E]">{names[r.customer_id] || 'Customer'} · {r.request_number}{r.po_number ? ` · PO ${r.po_number}` : ''}</p>
              <p className="text-xs text-gray-500">Placed {fmt(r.created_at)}{r.requested_ship_date ? ` · ship by ${fmtDay(r.requested_ship_date)}` : ''} · <b>{r.status}</b>{r.converted_by ? ` by ${r.converted_by}` : ''}</p>
            </div>
            <div className="flex gap-2">
              {r.po_storage_path && <button onClick={() => openPo(r.po_storage_path)} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#E4E6EE]" style={{ color: GREEN }}>📄 Open PO</button>}
              {r.status === 'Submitted' && <><button disabled={busy === r.id} onClick={() => decline(r)} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#E4E6EE] text-gray-500">Decline</button>
                <button disabled={busy === r.id} onClick={() => convert(r)} className="text-xs font-semibold rounded-lg px-3 py-1.5 text-white" style={{ background: GREEN }}>{busy === r.id ? 'Creating…' : 'Create sales order'}</button></>}
              {r.sales_order_id && <a href={`/sales/orders?item=${r.sales_order_id}`} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#E4E6EE]" style={{ color: GREEN }}>Open SO</a>}
            </div>
          </div>
          {(r.lines || []).length > 0 && <table className="w-full text-xs mt-3"><tbody>{r.lines.map((l: any, i: number) => <tr key={i} className="border-t border-[#F3F4F8]"><td className="py-1 font-semibold w-28">{l.sku}</td><td>{l.description}</td><td className="text-right">{Number(l.quantity).toLocaleString('en-US')} {l.unit || ''}</td><td className="text-right text-gray-400 w-24">{l.last_price != null ? '$' + Number(l.last_price).toFixed(4).replace(/0{1,2}$/, '') + ' last' : ''}</td></tr>)}</tbody></table>}
          {(r.ship_to || r.delivery_notes || r.notes) && <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{r.ship_to ? `Ship to: ${r.ship_to}\n` : ''}{r.delivery_notes ? `Delivery: ${r.delivery_notes}\n` : ''}{r.notes || ''}</p>}
        </div>
      ))}
    </div>
  )
}

function Calls({ sb, toast }: { sb: Sb; toast: (m: string) => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const { data } = await sb.from('portal_bookings').select('*').neq('status', 'Cancelled').or(`start_at.gte.${new Date(Date.now() - 86400000).toISOString()},start_at.is.null`).order('start_at', { ascending: true, nullsFirst: true }).limit(200)
    const list = (data || []) as any[]; setRows(list)
    const ids = Array.from(new Set(list.map(r => r.portal_client_id)))
    if (ids.length) { const { data: cs } = await sb.from('portal_clients').select('id, company_name, name, email').in('id', ids); const m: any = {}; (cs || []).forEach((c: any) => { m[c.id] = `${c.company_name || c.email} (${c.name || c.email})` }); setNames(m) }
  }, [sb])
  useEffect(() => { load() }, [load])
  async function confirmTime(r: any, start: string) {
    const { ok, data } = await post('booking-confirm', { id: r.id, start })
    toast(ok ? `Confirmed. ${data.invite_sent ? 'Outlook invite sent.' : 'Calendar not connected: the client was emailed; add it to your calendar.'}` : (data.error || 'Could not confirm.')); if (ok) load()
  }
  return (
    <div className="space-y-3">
      {rows.length === 0 && <div className={`${card} p-8 text-center text-sm text-gray-400`}>No upcoming calls.</div>}
      {rows.map(r => (
        <div key={r.id} className={`${card} p-4`}>
          <div className="flex flex-wrap justify-between gap-2">
            <div><p className="font-bold text-[#1A1D2E]">{r.topic}</p><p className="text-xs text-gray-500">{names[r.portal_client_id] || 'Client'}</p></div>
            <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 h-fit ${r.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{r.status}</span>
          </div>
          {r.status === 'Confirmed' ? (
            <p className="text-sm mt-2">{fmt(r.start_at)} {r.zoom_join_url && <a href={r.zoom_join_url} target="_blank" rel="noreferrer" className="ml-2 font-semibold" style={{ color: GREEN }}>Zoom</a>} {!r.outlook_event_id && <span className="text-xs text-amber-700 ml-2">not on Outlook calendar</span>}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">{(r.preferred_times || []).map((t: string) => <button key={t} onClick={() => confirmTime(r, t)} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#E4E6EE] hover:border-[#037f4c]">Confirm {fmt(t)}</button>)}</div>
          )}
          {r.notes && <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{r.notes}</p>}
        </div>
      ))}
    </div>
  )
}

function Docs({ sb, toast, me }: { sb: Sb; toast: (m: string) => void; me: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [f, setF] = useState<any>({ name: '', category: 'Company', description: '', url: '' })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { const { data } = await sb.from('portal_shared_documents').select('*').order('sort').order('created_at'); setRows(data || []) }, [sb])
  useEffect(() => { load() }, [load])
  async function add() {
    if (!f.name.trim() || (!file && !f.url.trim())) { toast('Add a name and a file or link.'); return }
    setBusy(true)
    try {
      let storage_path: string | null = null
      if (file) {
        storage_path = `portal-shared/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
        const { error } = await sb.storage.from('erp-files').upload(storage_path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
        if (error) { toast('Upload failed: ' + error.message); return }
      }
      const { error } = await sb.from('portal_shared_documents').insert({ name: f.name.trim(), category: f.category, description: f.description.trim() || null, url: file ? null : f.url.trim(), storage_path, created_by: me, sort: 100 })
      if (error) { toast(error.message); return }
      setF({ name: '', category: 'Company', description: '', url: '' }); setFile(null); load(); toast('Shared with all portal clients.')
    } finally { setBusy(false) }
  }
  async function toggle(d: any) { await sb.from('portal_shared_documents').update({ is_active: !d.is_active }).eq('id', d.id); load() }
  return (
    <div className="space-y-3">
      <div className={`${card} p-4 space-y-2`}>
        <p className="text-sm font-bold text-[#1A1D2E]">Share a document with every portal client</p>
        <p className="text-xs text-gray-500">W-9, certificate of insurance, certificates, SDS, PFAS statement, spec sheets: clients download these for vendor setup instead of emailing us.</p>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className={inp} placeholder="Name (e.g. W-9 2026)" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <select className={inp} value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{['Company', 'Certifications', 'Spec sheets', 'Forms'].map(c => <option key={c}>{c}</option>)}</select>
          <input className={inp} placeholder="Short description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
          <input type="file" className="text-xs sm:col-span-2" onChange={e => setFile(e.target.files?.[0] || null)} />
          <input className={inp} placeholder="…or a link" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} disabled={!!file} />
        </div>
        <div className="flex justify-end"><button onClick={add} disabled={busy} className="text-sm font-semibold rounded-lg px-4 py-2 text-white disabled:opacity-50" style={{ background: GREEN }}>{busy ? 'Saving…' : 'Share'}</button></div>
      </div>
      <div className={`${card} divide-y divide-[#F1F3F9]`}>
        {rows.map(d => <div key={d.id} className="flex items-center gap-3 px-4 py-2.5"><div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${d.is_active ? 'text-[#1A1D2E]' : 'text-gray-400 line-through'}`}>{d.name}</p><p className="text-[11px] text-gray-400">{d.category}{d.description ? ' · ' + d.description : ''}{d.url ? ' · link' : ' · file'}</p></div><button onClick={() => toggle(d)} className="text-xs font-semibold text-gray-500 hover:underline">{d.is_active ? 'Hide' : 'Show'}</button></div>)}
        {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-400">Nothing shared yet.</p>}
      </div>
    </div>
  )
}

export default function ClientPortalOps({ view, me }: { view: 'signups' | 'orders' | 'calls' | 'docs'; me: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [msg, setMsg] = useState('')
  const toast = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(''), 5000) }, [])
  return (
    <div>
      {msg && <div className="fixed top-4 right-4 z-[70] bg-[#1A1D2E] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg max-w-sm">{msg}</div>}
      {view === 'signups' && <Signups sb={sb} toast={toast} />}
      {view === 'orders' && <Orders sb={sb} toast={toast} />}
      {view === 'calls' && <Calls sb={sb} toast={toast} />}
      {view === 'docs' && <Docs sb={sb} toast={toast} me={me} />}
    </div>
  )
}

// Counts for tab badges
export function usePortalOpsCounts() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [c, setC] = useState({ signups: 0, orders: 0, calls: 0 })
  useEffect(() => {
    Promise.all([
      sb.from('portal_clients').select('id', { count: 'exact', head: true }).is('approved_at', null).eq('is_active', true),
      sb.from('portal_order_requests').select('id', { count: 'exact', head: true }).eq('status', 'Submitted'),
      sb.from('portal_bookings').select('id', { count: 'exact', head: true }).eq('status', 'Requested'),
    ]).then(([a, b, d]) => setC({ signups: a.count || 0, orders: b.count || 0, calls: d.count || 0 }))
  }, [sb])
  return c
}
