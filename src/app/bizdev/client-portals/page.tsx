'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { clientStage, TONES } from '@/lib/portalStages'

const GREEN = '#037f4c'
const PORTAL_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app') + '/portal'
const fmtWhen = (d: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

interface Client { id: string; customer_id: string | null; name: string | null; company_name: string | null; email: string; is_active: boolean; last_login_at: string | null; created_at: string }
interface Msg { id: string; sender_name: string | null; sender_email: string | null; message: string; is_read: boolean; created_at: string; customer_id: string | null }
interface Customer { id: string; company_name: string }

function Badge({ label, tone }: { label: string; tone: string }) {
  const t = TONES[(tone as keyof typeof TONES)] || TONES.gray
  return <span className="text-[11px] font-bold rounded-full px-2.5 py-1 inline-block whitespace-nowrap" style={{ background: t.bg, color: t.text }}>{label}</span>
}

// Build the exact project/timeline data a client would see, using the same mapping as the portal.
async function loadMirror(sb: ReturnType<typeof createSupabaseBrowserClient>, customerId: string) {
  const [{ data: sos }, { data: qs }] = await Promise.all([
    sb.from('sales_orders').select('id, order_number, po_number, status, client_portal_name, created_at, updated_at').eq('customer_id', customerId).eq('client_portal_visible', true),
    sb.from('quotations').select('id, quote_number, type, status, client_portal_name, created_at, updated_at').eq('customer_id', customerId).eq('client_portal_visible', true).eq('is_active', true),
  ])
  const soList = (sos || []) as any[]; const qList = (qs || []) as any[]
  const soIds = soList.map(o => o.id); const qIds = qList.map(q => q.id)
  const histMap: Record<string, any[]> = {}
  const collect = (rows: any[]) => rows.forEach((h: any) => { const k = h.source_type + ':' + h.source_id; (histMap[k] ||= []).push(h) })
  if (soIds.length) { const { data } = await sb.from('portal_status_history').select('source_type, source_id, status, created_at').eq('source_type', 'sales_order').in('source_id', soIds).order('created_at', { ascending: true }); collect(data || []) }
  if (qIds.length) { const { data } = await sb.from('portal_status_history').select('source_type, source_id, status, created_at').eq('source_type', 'quotation').in('source_id', qIds).order('created_at', { ascending: true }); collect(data || []) }
  const build = (kind: 'so' | 'quote', srcType: string, rec: any) => {
    const hist = histMap[srcType + ':' + rec.id] || []
    const raw = hist.length ? hist : [{ status: rec.status, created_at: rec.created_at || rec.updated_at }]
    const timeline: any[] = []
    for (const h of raw) { const st = clientStage(kind, h.status); const last = timeline[timeline.length - 1]; if (last && last.label === st.label) continue; timeline.push({ ...st, date: h.created_at }) }
    const cur = timeline[timeline.length - 1] || clientStage(kind, rec.status)
    return { current: { label: cur.label, tone: cur.tone }, timeline }
  }
  const projects: any[] = []
  for (const o of soList) { const t = build('so', 'sales_order', o); projects.push({ id: o.id, kind: 'Order', name: o.client_portal_name || o.order_number || o.po_number || 'Order', ...t }) }
  for (const q of qList) { const t = build('quote', 'quotation', q); projects.push({ id: q.id, kind: q.type === 'rfq' ? 'RFQ' : 'Quote', name: q.client_portal_name || q.quote_number || 'Quote', ...t }) }
  return projects
}

/* ── Account modal ── */
function ClientModal({ open, onClose, onSaved, sb, me, editing }: { open: boolean; onClose: () => void; onSaved: () => void; sb: ReturnType<typeof createSupabaseBrowserClient>; me: string; editing: Client | null }) {
  const [form, setForm] = useState<any>({ name: '', company_name: '', email: '', customer_id: '', password: '' })
  const [custQ, setCustQ] = useState(''); const [custResults, setCustResults] = useState<Customer[]>([]); const [custOpen, setCustOpen] = useState(false)
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return; setError('')
    if (editing) { setForm({ name: editing.name || '', company_name: editing.company_name || '', email: editing.email, customer_id: editing.customer_id || '', password: '' }); setCustQ(editing.company_name || '') }
    else { setForm({ name: '', company_name: '', email: '', customer_id: '', password: '' }); setCustQ('') }
  }, [open, editing])

  useEffect(() => {
    if (!custOpen || custQ.trim().length < 2) { setCustResults([]); return }
    let alive = true
    sb.from('customers').select('id, company_name').ilike('company_name', `%${custQ.trim()}%`).order('company_name').limit(20).then(({ data }) => { if (alive) setCustResults((data as Customer[]) || []) })
    return () => { alive = false }
  }, [custQ, custOpen, sb])

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.customer_id) { setError('Link a customer — the portal mirrors that customer’s shared orders and quotes.'); return }
    if (!form.email.trim()) { setError('Email is required.'); return }
    if (!editing && !form.password.trim()) { setError('Set a password for the new account.'); return }
    if (form.password && form.password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setSaving(true)
    try {
      let id = editing?.id
      const row = { name: form.name.trim() || null, company_name: form.company_name.trim() || null, email: form.email.trim(), customer_id: form.customer_id || null }
      if (editing) { const { error } = await sb.from('portal_clients').update({ ...row, updated_at: new Date().toISOString() }).eq('id', editing.id); if (error) { setError(error.message); return } }
      else { const { data, error } = await sb.from('portal_clients').insert({ ...row, created_by: me }).select('id').single(); if (error) { setError(error.message.includes('duplicate') ? 'An account with that email already exists.' : error.message); return } id = (data as any).id }
      if (form.password.trim() && id) { const { error: pe } = await sb.rpc('portal_set_password', { p_id: id, p_password: form.password }); if (pe) { setError('Saved, but password could not be set: ' + pe.message); return } }
      onClose(); onSaved()
    } finally { setSaving(false) }
  }

  if (!open) return null
  const inp = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 text-white rounded-t-2xl" style={{ background: GREEN }}>
          <h2 className="font-bold text-lg">{editing ? 'Edit client account' : 'New client account'}</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={save} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">{error}</div>}
          <label className="block relative"><span className="text-xs font-medium text-gray-600">Customer *</span>
            <input className={inp} value={custQ || (form.customer_id ? '(linked)' : '')} placeholder="Search customers…"
              onChange={e => { setCustQ(e.target.value); setCustOpen(true); setForm((f: any) => ({ ...f, customer_id: '' })) }}
              onFocus={() => setCustOpen(true)} onBlur={() => setTimeout(() => setCustOpen(false), 150)} />
            {form.customer_id && <span className="absolute right-3 top-8 text-[11px] font-semibold text-emerald-600">linked ✓</span>}
            {custOpen && custResults.length > 0 && (
              <div className="absolute z-20 mt-1 left-0 right-0 max-h-52 overflow-auto bg-white border border-[#E4E6EE] rounded-lg shadow-lg">
                {custResults.map(c => (<button type="button" key={c.id} onMouseDown={e => e.preventDefault()} onClick={() => { setForm((f: any) => ({ ...f, customer_id: c.id, company_name: f.company_name || c.company_name })); setCustQ(c.company_name); setCustOpen(false) }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 truncate">{c.company_name}</button>))}
              </div>
            )}
            <span className="text-[11px] text-gray-400">The portal shows only the orders/quotes you toggle on for this customer.</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Company (portal header)</span><input className={inp} value={form.company_name} onChange={e => setForm((f: any) => ({ ...f, company_name: e.target.value }))} placeholder="Acme Foods" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Contact name</span><input className={inp} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" /></label>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-600">Login email *</span><input type="email" className={inp} value={form.email} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} placeholder="jane@acme.com" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">{editing ? 'Reset password (leave blank to keep)' : 'Password *'}</span><input className={inp} value={form.password} onChange={e => setForm((f: any) => ({ ...f, password: e.target.value }))} placeholder={editing ? '••••••••' : 'Set a password'} /></label>
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button type="submit" disabled={saving} className="flex-1 text-white font-semibold py-2 rounded-lg disabled:opacity-50" style={{ background: GREEN }}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 rounded-lg">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Preview (exactly what the client sees) ── */
function PreviewModal({ client, onClose, sb }: { client: Client | null; onClose: () => void; sb: ReturnType<typeof createSupabaseBrowserClient> }) {
  const [projects, setProjects] = useState<any[]>([]); const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!client) return; setLoading(true)
    if (!client.customer_id) { setProjects([]); setLoading(false); return }
    loadMirror(sb, client.customer_id).then(p => { setProjects(p); setLoading(false) })
  }, [client, sb])
  if (!client) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md my-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-white text-xs font-semibold bg-black/40 rounded-full px-3 py-1">Preview · what {client.company_name || 'the client'} sees</p>
          <button onClick={onClose} className="text-white text-xl bg-black/40 rounded-full w-8 h-8 leading-none">&times;</button>
        </div>
        <div className="rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#F1F3F7' }}>
          <div className="text-white" style={{ background: GREEN }}><div className="px-5 py-4"><p className="text-white/80 text-[10px] uppercase tracking-wide">beyondGREEN · Client Portal</p><h1 className="text-lg font-bold leading-tight">{client.company_name || client.name || 'Client'}</h1></div></div>
          <div className="p-4 space-y-4">
            <div>
              <h2 className="font-bold text-[#1A1D2E] text-sm mb-2">Your Projects ({projects.length})</h2>
              <div className="space-y-2">
                {loading ? <p className="text-gray-400 text-sm text-center py-4">Loading…</p> : !client.customer_id ? <div className="bg-white rounded-xl border border-[#E4E6EE] p-5 text-center text-xs text-amber-600">Link this account to a customer first.</div> : projects.length === 0 ? <div className="bg-white rounded-xl border border-[#E4E6EE] p-5 text-center text-xs text-gray-400">Nothing shared yet. Toggle &quot;Show in client portal&quot; on a Sales Order or Quote.</div> : projects.map(p => (
                  <div key={p.id} className="bg-white rounded-xl border border-[#E4E6EE] overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#F1F3F9]"><div><p className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold">{p.kind}</p><p className="font-bold text-[#1A1D2E] text-sm">{p.name}</p></div><Badge label={p.current.label} tone={p.current.tone} /></div>
                    <div className="px-3 py-2">
                      <p className="text-[9px] uppercase tracking-wide text-gray-400 mb-1">Progress</p>
                      <ol>{p.timeline.slice().reverse().map((it: any, i: number) => (
                        <li key={i} className="flex items-start gap-2 pb-1.5 last:pb-0"><span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: i === 0 ? (TONES[(it.tone as keyof typeof TONES)] || TONES.gray).text : '#CBD3E0' }} /><div><p className={`text-xs ${i === 0 ? 'font-bold text-[#1A1D2E]' : 'text-gray-500'}`}>{it.label}</p><p className="text-[10px] text-gray-400">{fmtDate(it.date)}</p></div></li>
                      ))}</ol>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div><h2 className="font-bold text-[#1A1D2E] text-sm mb-2">Message us</h2><div className="bg-white rounded-xl border border-[#E4E6EE] p-3"><div className="bg-[#F5F6FA] border border-[#E4E6EE] rounded-lg px-3 py-2 text-xs text-gray-400">Ask a question or send us an update…</div></div></div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Page ── */
export default function ClientPortalsAdmin() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [clients, setClients] = useState<Client[]>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [custMap, setCustMap] = useState<Record<string, string>>({})
  const [sharedByCust, setSharedByCust] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState('')
  const [tab, setTab] = useState<'clients' | 'messages'>('clients')
  const [modal, setModal] = useState<null | 'account' | 'preview'>(null)
  const [active, setActive] = useState<Client | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: cl }, { data: ms }, { data: vso }, { data: vq }] = await Promise.all([
      sb.from('portal_clients').select('id, customer_id, name, company_name, email, is_active, last_login_at, created_at').order('created_at', { ascending: false }),
      sb.from('portal_messages').select('id, sender_name, sender_email, message, is_read, created_at, customer_id').order('created_at', { ascending: false }).limit(100),
      sb.from('sales_orders').select('customer_id').eq('client_portal_visible', true),
      sb.from('quotations').select('customer_id').eq('client_portal_visible', true).eq('is_active', true),
    ])
    setClients((cl as Client[]) || [])
    setMessages((ms as Msg[]) || [])
    const sc: Record<string, number> = {}
    ;[...((vso as any[]) || []), ...((vq as any[]) || [])].forEach(r => { if (r.customer_id) sc[r.customer_id] = (sc[r.customer_id] || 0) + 1 })
    setSharedByCust(sc)
    const cids = Array.from(new Set([...((cl as Client[]) || []).map(c => c.customer_id), ...((ms as Msg[]) || []).map(m => m.customer_id)].filter(Boolean))) as string[]
    if (cids.length) { const { data: cs } = await sb.from('customers').select('id, company_name').in('id', cids); const m: Record<string, string> = {}; (cs || []).forEach((c: any) => { m[c.id] = c.company_name }); setCustMap(m) }
    setLoading(false)
  }, [sb])
  useEffect(() => { load(); sb.auth.getUser().then(({ data }) => setMe(data.user?.email || '')) }, [load, sb])

  const unread = messages.filter(m => !m.is_read).length
  async function toggleActive(c: Client) { await sb.from('portal_clients').update({ is_active: !c.is_active, updated_at: new Date().toISOString() }).eq('id', c.id); setClients(cs => cs.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x)) }
  async function del(c: Client) { if (!confirm(`Delete the portal account for ${c.company_name || c.email}? Their login is removed (the linked orders/quotes are not affected).`)) return; await sb.from('portal_clients').delete().eq('id', c.id); setClients(cs => cs.filter(x => x.id !== c.id)) }
  async function markRead(m: Msg) { await sb.from('portal_messages').update({ is_read: true }).eq('id', m.id); setMessages(ms => ms.map(x => x.id === m.id ? { ...x, is_read: true } : x)) }
  async function markAllRead() { await sb.from('portal_messages').update({ is_read: true }).eq('is_read', false); setMessages(ms => ms.map(x => ({ ...x, is_read: true }))) }
  function copyLink() { navigator.clipboard?.writeText(PORTAL_URL); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  function openModal(kind: 'account' | 'preview', c: Client | null) { setActive(c); setModal(kind) }
  function closeModal() { setModal(null); setTimeout(() => setActive(null), 200); load() }

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div>
          <span className="mon-tag" style={{ background: '#037f4c22', color: GREEN }}>🔑 Client Portals</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Client Portals</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${clients.length} client account${clients.length === 1 ? '' : 's'}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyLink} className="text-sm font-semibold rounded-lg px-3 py-2 border border-[#E4E6EE] text-gray-600 hover:bg-gray-50">{copied ? 'Copied ✓' : 'Copy portal link'}</button>
          <button onClick={() => openModal('account', null)} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90" style={{ background: GREEN }}>+ New client</button>
        </div>
      </div>

      <div className="bg-[#F0FBF5] border border-[#CDE9DA] rounded-lg px-4 py-2.5 mb-4 text-[13px] text-[#0F5132]">
        To share a project, open a <strong>Sales Order</strong> or <strong>Quote</strong> and turn on <strong>&ldquo;Show in client portal.&rdquo;</strong> It mirrors to that customer&rsquo;s portal automatically — clients see the status and a progress timeline, never pricing or internal notes.
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setTab('clients')} className={`text-sm font-semibold rounded-lg px-3 py-1.5 ${tab === 'clients' ? 'text-white' : 'text-gray-500 bg-white border border-[#E4E6EE]'}`} style={tab === 'clients' ? { background: GREEN } : {}}>Accounts</button>
        <button onClick={() => setTab('messages')} className={`text-sm font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 ${tab === 'messages' ? 'text-white' : 'text-gray-500 bg-white border border-[#E4E6EE]'}`} style={tab === 'messages' ? { background: GREEN } : {}}>Messages {unread > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unread}</span>}</button>
      </div>

      {tab === 'clients' ? (
        <div className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead><tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                <th className="text-left px-4 py-2.5 font-semibold">Company</th>
                <th className="text-left px-3 py-2.5 font-semibold">Contact</th>
                <th className="text-left px-3 py-2.5 font-semibold">Login email</th>
                <th className="text-left px-3 py-2.5 font-semibold">Shared items</th>
                <th className="text-left px-3 py-2.5 font-semibold">Last sign-in</th>
                <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                <th className="text-right px-4 py-2.5 font-semibold">Actions</th>
              </tr></thead>
              <tbody>
                {clients.map((c, i) => {
                  const shared = c.customer_id ? (sharedByCust[c.customer_id] || 0) : 0
                  return (
                    <tr key={c.id} className={i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}>
                      <td className="px-4 py-2.5 font-semibold text-[#1A1D2E]">{c.company_name || (c.customer_id ? custMap[c.customer_id] : '') || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{c.name || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{c.email}</td>
                      <td className="px-3 py-2.5">{c.customer_id ? <span className="text-gray-700 font-medium">{shared}</span> : <span className="text-amber-600 text-xs">not linked</span>}</td>
                      <td className="px-3 py-2.5 text-gray-500">{fmtWhen(c.last_login_at)}</td>
                      <td className="px-3 py-2.5"><span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>{c.is_active ? 'Active' : 'Disabled'}</span></td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => openModal('preview', c)} className="text-xs font-semibold text-[#037f4c] hover:underline mr-3">Preview</button>
                        <button onClick={() => openModal('account', c)} className="text-xs font-semibold text-gray-500 hover:underline mr-3">Edit</button>
                        <button onClick={() => toggleActive(c)} className="text-xs font-semibold text-gray-500 hover:underline mr-3">{c.is_active ? 'Disable' : 'Enable'}</button>
                        <button onClick={() => del(c)} className="text-xs font-semibold text-red-500 hover:underline">Delete</button>
                      </td>
                    </tr>
                  )
                })}
                {!loading && clients.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No client accounts yet. Create one linked to a customer, then share their orders/quotes from the boards.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {unread > 0 && <div className="flex justify-end"><button onClick={markAllRead} className="text-xs font-semibold" style={{ color: GREEN }}>Mark all read</button></div>}
          {messages.map(m => (
            <div key={m.id} className={`bg-white rounded-xl border p-4 ${m.is_read ? 'border-[#ECEEF3]' : 'border-[#037f4c]/40'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-semibold text-[#1A1D2E]">{m.sender_name || m.sender_email || 'Client'}{m.customer_id && custMap[m.customer_id] && <span className="text-gray-400 font-normal"> · {custMap[m.customer_id]}</span>}</p><p className="text-[11px] text-gray-400">{m.sender_email} · {fmtWhen(m.created_at)}</p></div>
                {!m.is_read && <button onClick={() => markRead(m)} className="text-xs font-semibold shrink-0" style={{ color: GREEN }}>Mark read</button>}
              </div>
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{m.message}</p>
              {m.sender_email && <a href={`mailto:${m.sender_email}`} className="inline-block mt-2 text-xs font-semibold" style={{ color: GREEN }}>Reply by email →</a>}
            </div>
          ))}
          {!loading && messages.length === 0 && <div className="bg-white rounded-xl border border-[#ECEEF3] p-10 text-center text-gray-400 text-sm">No messages from clients yet.</div>}
        </div>
      )}

      <ClientModal open={modal === 'account'} onClose={closeModal} onSaved={load} sb={sb} me={me} editing={active} />
      {modal === 'preview' && <PreviewModal client={active} onClose={closeModal} sb={sb} />}
    </div>
  )
}
