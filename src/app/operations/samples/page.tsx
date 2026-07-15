'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'

interface Line { id: string; name: string | null; sku: string | null; quantity: number | null }
interface Sample {
  id: string; name: string | null; requesting_facility: string | null; requestor: string | null; customer_email: string | null
  customer_type: string | null; product: string | null; status: string | null; ship_due_date: string | null; sample_date: string | null
  ship_cost: number | null; shipped_via: string | null; tracking_number: string | null; ship_to_address: string | null; group_name: string | null
  recipient_email?: string | null; position?: number | null
}

// ─────────────────────────── Monday Board config ───────────────────────────
const STATUSES = [
  { label: 'Ready', hex: '#fdab3d' },
  { label: 'Hold', hex: '#579bfc' },
  { label: 'Shipped', hex: '#037f4c' },
  { label: 'Complete', hex: '#00c875' },
  { label: 'Moved to Sales Pipeline', hex: '#9d50dd' },
  { label: 'Cancelled', hex: '#df2f4a' },
  { label: 'Unfulfillable', hex: '#e2445c' },
]
const statusHex = (s: string | null) => STATUSES.find(x => x.label === s)?.hex || '#c4c4c4'
const GROUPS = [
  { key: 'Pending Sample Shipments', color: '#FDAB3D' },
  { key: 'Shipped Samples', color: '#00A84F' },
]

const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function escHtml(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function AddSampleModal({ open, onClose, onCreated, sb }: { open: boolean; onClose: () => void; onCreated: () => void; sb: ReturnType<typeof createSupabaseBrowserClient> }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<any[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [form, setForm] = useState({
    name: '', recipient_email: '', ship_to_address: '', note: '',
    is_custom_request: false, selected_items: [] as string[], tagged_people: [] as string[], files: [] as File[]
  })

  useEffect(() => {
    if (open) {
      setCatalogLoading(true)
      sb.from('sample_catalog').select('id,name,sku').then(({ data }) => { setCatalog(data || []); setCatalogLoading(false) })
    }
  }, [open, sb])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setForm(prev => ({ ...prev, files: Array.from(e.target.files as FileList) }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const files_inline: any[] = []
      for (const file of form.files) {
        const data = await file.arrayBuffer()
        files_inline.push({ filename: file.name, mimetype: file.type, data: Buffer.from(data).toString('base64') })
      }
      const result = await sb.functions.invoke('sample-submission-create', {
        body: {
          name: form.name, recipient_email: form.recipient_email, ship_to_address: form.ship_to_address, note: form.note,
          is_custom_request: form.is_custom_request,
          sample_items: form.selected_items.map((id, idx) => ({ line_number: idx + 1, catalog_id: id })),
          tagged_people: form.tagged_people, files_inline: files_inline
        }
      })
      if (result.error) throw new Error(result.error)
      setForm({ name: '', recipient_email: '', ship_to_address: '', note: '', is_custom_request: false, selected_items: [], tagged_people: [], files: [] })
      onClose(); onCreated()
    } catch (err: any) { setError(err.message || 'Failed to create sample submission') }
    finally { setLoading(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Add Sample Submission</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Request Name</label>
            <input type="text" required value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g., Q3 Product Line" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Email</label>
            <input type="email" required value={form.recipient_email} onChange={e => setForm(prev => ({ ...prev, recipient_email: e.target.value }))} placeholder="customer@example.com" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ship-To Address</label>
            <textarea value={form.ship_to_address} onChange={e => setForm(prev => ({ ...prev, ship_to_address: e.target.value }))} placeholder="Full shipping address" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" rows={2}/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <textarea value={form.note} onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Any special instructions or notes…" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" rows={2}/>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="custom" checked={form.is_custom_request} onChange={e => setForm(prev => ({ ...prev, is_custom_request: e.target.checked, selected_items: e.target.checked ? [] : prev.selected_items }))} className="w-4 h-4 text-blue-600 rounded"/>
            <label htmlFor="custom" className="text-sm font-medium text-gray-700">Custom Request (no catalog items)</label>
          </div>
          {!form.is_custom_request && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sample Items</label>
              {catalogLoading ? <p className="text-sm text-gray-500">Loading catalog…</p>
              : catalog.length === 0 ? <p className="text-sm text-gray-500">No catalog items available</p>
              : <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {catalog.map(item => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.selected_items.includes(item.id)} onChange={e => {
                        setForm(prev => ({ ...prev, selected_items: e.target.checked ? [...prev.selected_items, item.id] : prev.selected_items.filter(id => id !== item.id) }))
                      }} className="w-4 h-4 text-blue-600 rounded"/>
                      <span className="text-gray-700">{item.name} ({item.sku})</span>
                    </label>
                  ))}
                </div>}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tag Team Members</label>
            <input type="text" placeholder="Enter emails, comma-separated" value={form.tagged_people.join(', ')} onChange={e => setForm(prev => ({ ...prev, tagged_people: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"/>
            {form.tagged_people.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{form.tagged_people.map(email => <span key={email} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{email}</span>)}</div>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label>
            <input type="file" multiple onChange={handleFileChange} className="w-full"/>
            {form.files.length > 0 && <div className="mt-2 text-sm text-gray-600">{form.files.length} file(s) selected</div>}
          </div>
          <div className="flex gap-2 pt-4 border-t border-gray-200">
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition">{loading ? 'Creating…' : 'Create Submission'}</button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-2 rounded-lg transition">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function buildShippedEmail(opts: { sample: Sample; items: Line[]; carrier: string; tracking: string; shipTo: string }): string {
  const { sample, items, carrier, tracking, shipTo } = opts
  const rows = items.map(i =>
    `<tr><td style="padding:6px 10px;border-top:1px solid #eee">${escHtml(i.name || '—')}</td>` +
    `<td style="padding:6px 10px;border-top:1px solid #eee;font-family:monospace">${escHtml(i.sku || '—')}</td>` +
    `<td style="padding:6px 10px;border-top:1px solid #eee;text-align:right">${i.quantity ?? '—'}</td></tr>`).join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1A1D2E">
  <h2 style="color:#16a34a;margin:0 0 8px">Your sample has shipped</h2>
  <p style="margin:0 0 12px">Hi${sample.name ? ' ' + escHtml(sample.name) : ''},</p>
  <p style="margin:0 0 12px">Good news — your beyondGREEN sample submission is on its way.</p>
  <table style="border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:14px">
    <tr><td style="padding:4px 0;color:#6b7280;width:120px">Carrier</td><td style="padding:4px 0;font-weight:600">${escHtml(carrier || '—')}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280">Tracking #</td><td style="padding:4px 0;font-weight:600;font-family:monospace">${escHtml(tracking || '—')}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280">Ship to</td><td style="padding:4px 0">${escHtml(shipTo || '—')}</td></tr>
    ${sample.product ? `<tr><td style="padding:4px 0;color:#6b7280">Product</td><td style="padding:4px 0">${escHtml(sample.product)}</td></tr>` : ''}
  </table>
  ${items.length ? `<h3 style="font-size:14px;margin:16px 0 4px">Items</h3>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead><tr><th style="text-align:left;padding:6px 10px;color:#6b7280">Item</th><th style="text-align:left;padding:6px 10px;color:#6b7280">SKU</th><th style="text-align:right;padding:6px 10px;color:#6b7280">Qty</th></tr></thead>
    <tbody>${rows}</tbody></table>` : ''}
  <p style="margin:20px 0 0">Thank you,<br/>The beyondGREEN Team</p>
</div>`
}

function ShipConfirmModal({ sample, lines, sb, onClose, onDone }: {
  sample: Sample; lines?: Line[]; sb: ReturnType<typeof createSupabaseBrowserClient>; onClose: () => void; onDone: () => void
}) {
  const [items, setItems] = useState<Line[]>(lines || [])
  const [carrier, setCarrier] = useState(sample.shipped_via || '')
  const [tracking, setTracking] = useState(sample.tracking_number || '')
  const [shipTo, setShipTo] = useState(sample.ship_to_address || '')
  const [recipient, setRecipient] = useState(sample.customer_email || sample.recipient_email || '')
  const [subject, setSubject] = useState(`Your beyondGREEN sample has shipped${sample.name ? ` — ${sample.name}` : ''}`)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!lines || lines.length === 0) {
      sb.from('sample_submission_lines').select('id,name,sku,quantity').eq('sample_id', sample.id).order('line_number')
        .then(({ data }) => setItems((data as Line[]) || []))
    }
  }, [lines, sample.id, sb])

  const html = useMemo(() => buildShippedEmail({ sample, items, carrier, tracking, shipTo }), [sample, items, carrier, tracking, shipTo])

  async function sendAndMark() {
    if (!recipient.trim()) { setError('A recipient email is required.'); return }
    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: recipient.trim(), subject, html }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed to send email')
      const now = new Date().toISOString()
      await sb.from('sample_submissions').update({
        status: 'Shipped', group_name: 'Shipped Samples', shipped_via: carrier || null, tracking_number: tracking || null,
        ship_to_address: shipTo || null, recipient_email: recipient.trim(), shipped_at: now, shipped_email_sent_at: now, updated_at: now,
      }).eq('id', sample.id)
      setSent(true); onDone(); setTimeout(onClose, 900)
    } catch (e) { setError((e as Error).message) }
    setSending(false)
  }

  const inp = 'w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-[#1A1D2E]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-[#E4E6EE] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-lg text-[#1A1D2E]">Confirm Shipped</h2>
            <p className="text-xs text-gray-500 mt-0.5">Review the email, then send it to the recipient and mark this sample shipped.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"><i className="ti ti-x" /></button>
        </div>
        <div className="flex-1 overflow-y-auto grid md:grid-cols-2 gap-0">
          <div className="p-6 space-y-3 border-r border-[#E4E6EE]">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Shipment details</p>
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Carrier</label><input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="e.g., UPS, FedEx" className={inp} /></div>
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Tracking #</label><input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="1Z..." className={inp} /></div>
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Ship-to address</label><textarea value={shipTo} onChange={e => setShipTo(e.target.value)} rows={2} className={inp + ' resize-none'} /></div>
            <div className="pt-2 border-t border-[#EEF0F4]"><label className="text-xs font-medium text-gray-600 block mb-1">Recipient email</label><input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="customer@email.com" className={inp} /></div>
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Subject</label><input value={subject} onChange={e => setSubject(e.target.value)} className={inp} /></div>
          </div>
          <div className="p-6 bg-[#F9FAFB]">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Email preview</p>
            <div className="bg-white border border-[#E4E6EE] rounded-lg p-4 overflow-auto" style={{ maxHeight: 360 }} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-[#E4E6EE] flex items-center gap-3 justify-end shrink-0">
          {error && <p className="text-sm text-red-600 mr-auto">{error}</p>}
          {sent && <p className="text-sm text-emerald-600 mr-auto font-medium">Sent &amp; marked shipped ✓</p>}
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium rounded-lg hover:bg-gray-100">Cancel</button>
          <button onClick={sendAndMark} disabled={sending || sent} className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg flex items-center gap-2">
            {sending ? 'Sending…' : <><i className="ti ti-send text-base" />Send &amp; Mark Shipped</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, c }: { label: string; value: string | number; c?: string }) {
  return (
    <div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

export default function SamplesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Sample[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ 'Shipped Samples': true })
  const [open, setOpen] = useState<string | null>(null)
  const [lines, setLines] = useState<Record<string, Line[]>>({})
  const [edit, setEdit] = useState<{ id: string; field: string } | null>(null)
  const [statusOpen, setStatusOpen] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [shipSample, setShipSample] = useState<Sample | null>(null)
  const dragId = useRef<string | null>(null)

  useItemDeepLink(rows, (r) => toggle(r.id))

  const load = useCallback(async () => {
    setLoading(true)
    // paginate past PostgREST's 1000-row cap
    const all: Sample[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from('sample_submissions').select('*').order('position', { ascending: true, nullsFirst: false }).range(from, from + 999)
      const batch = (data as Sample[]) || []
      all.push(...batch)
      if (batch.length < 1000) break
    }
    setRows(all); setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (!lines[id]) {
      const { data } = await sb.from('sample_submission_lines').select('id,name,sku,quantity').eq('sample_id', id).order('line_number')
      setLines(m => ({ ...m, [id]: (data as Line[]) || [] }))
    }
  }

  async function patch(id: string, obj: any) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    await sb.from('sample_submissions').update({ ...obj, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function addItem(group: string) {
    const max = Math.max(0, ...rows.filter(r => (r.group_name || '') === group).map(r => r.position || 0))
    const { data } = await sb.from('sample_submissions').insert({ group_name: group, status: 'Ready', position: max + 1000 }).select('*').single()
    if (data) { setRows(rs => [...rs, data as Sample]); setEdit({ id: (data as any).id, field: 'name' }) }
  }
  async function deleteSample(id: string, name: string | null) {
    if (!confirm(`Delete sample submission${name ? ` "${name}"` : ''}? It will move to the Recycle Bin and can be restored.`)) return
    await sb.from('sample_submission_lines').delete().eq('sample_id', id)
    const { error } = await sb.from('sample_submissions').delete().eq('id', id)
    if (error) { alert(error.message); return }
    setRows(rs => rs.filter(r => r.id !== id)); setOpen(null)
  }
  function onDrop(group: string, beforeId: string | null) {
    const id = dragId.current; dragId.current = null; if (!id) return
    const list = rows.filter(r => (r.group_name || '') === group && r.id !== id).sort((a, b) => (a.position || 0) - (b.position || 0))
    let idx = beforeId ? list.findIndex(r => r.id === beforeId) : list.length; if (idx < 0) idx = list.length
    const prev = list[idx - 1]?.position, next = list[idx]?.position
    const pos = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 1000 : next != null ? next - 1000 : 1000
    patch(id, { group_name: group, position: pos })
  }

  const q = search.trim().toLowerCase()
  const match = (r: Sample) => !q || [r.name, r.customer_email, r.product, r.requestor, r.tracking_number].some(v => (v || '').toLowerCase().includes(q))
  const groupRows = (key: string) => rows.filter(r => (r.group_name || '') === key && match(r)).sort((a, b) => (a.position || 0) - (b.position || 0))
  const extra = Array.from(new Set(rows.map(r => r.group_name || '').filter(k => k && !GROUPS.some(g => g.key === k))))
  const allGroups = [...GROUPS, ...extra.map(k => ({ key: k, color: '#9699A6' }))]
  const shownCount = allGroups.reduce((a, g) => a + groupRows(g.key).length, 0)

  const inpCls = 'w-full bg-white border border-[#0086C0] rounded px-2 py-1 text-[13px] focus:outline-none'
  const EditCell = ({ r, field, type = 'text', mono = false }: { r: Sample; field: keyof Sample; type?: 'text' | 'num' | 'date'; mono?: boolean }) => {
    const editing = edit?.id === r.id && edit?.field === field
    const val = r[field] as any
    if (editing) {
      const t = type === 'num' ? 'number' : type === 'date' ? 'date' : 'text'
      return <input type={t} autoFocus defaultValue={val ?? ''} onClick={e => e.stopPropagation()}
        onBlur={e => { const v = e.target.value; patch(r.id, { [field]: v === '' ? null : type === 'num' ? Number(v) : v.trim() }); setEdit(null) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null) }}
        className={inpCls + (type === 'num' ? ' text-right' : '')} />
    }
    const show = type === 'date' ? (val ? fmtD(val) : '') : type === 'num' ? (val == null ? '' : Number(val).toLocaleString()) : (val || '')
    return <div onClick={e => { e.stopPropagation(); setEdit({ id: r.id, field: field as string }) }}
      className={`cursor-text min-h-[22px] rounded px-1 hover:bg-[#F0F4F9] ${type === 'num' ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-xs text-gray-500' : ''}`}>
      {show || <span className="text-gray-300">+</span>}</div>
  }
  const StatusCell = ({ r }: { r: Sample }) => (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button onClick={() => setStatusOpen(statusOpen === r.id ? null : r.id)} className="w-full text-white text-[12px] font-semibold rounded-full px-2.5 py-1 text-center truncate" style={{ background: r.status ? statusHex(r.status) : '#c4c4c4' }}>{r.status || '—'}</button>
      {statusOpen === r.id && (<>
        <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(null)} />
        <div className="absolute z-20 mt-1 left-0 w-52 bg-white rounded-lg shadow-xl border border-[#E4E6EE] p-1">
          {STATUSES.map(s => <button key={s.label} onClick={() => { patch(r.id, { status: s.label }); setStatusOpen(null) }} className="block w-full text-white text-[12px] font-semibold rounded px-2 py-1.5 mb-1 text-center" style={{ background: s.hex }}>{s.label}</button>)}
          <button onClick={() => { patch(r.id, { status: null }); setStatusOpen(null) }} className="block w-full text-gray-500 text-[12px] rounded px-2 py-1.5 hover:bg-gray-100">Clear</button>
        </div></>)}
    </div>
  )

  const COLS = 9 // caret + name + status + customer + product + requestor + sample date + ship due + tracking

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag">🧪 Samples</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Sample Submissions</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${shownCount} of ${rows.length} submissions`}</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="mon-btn">+ New submission</button>
      </div>

      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <Stat label="Total" value={rows.length} c="#0086C0" />
          <Stat label="Pending" value={rows.filter(r => (r.group_name || '') === 'Pending Sample Shipments').length} c="#FDAB3D" />
          <Stat label="Shipped" value={rows.filter(r => r.status === 'Shipped').length} c="#00A84F" />
          <Stat label="On Hold" value={rows.filter(r => r.status === 'Hold').length} c="#579BFC" />
          <Stat label="Cancelled" value={rows.filter(r => r.status === 'Cancelled').length} c="#E2445C" />
          <Stat label="Ship Cost" value={'$' + rows.reduce((a, r) => a + (Number(r.ship_cost) || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} c="#A25DDC" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search name, customer, product, tracking…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(allGroups.map(g => [g.key, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-6">
          {allGroups.map(group => {
            const gr = groupRows(group.key); const isCol = collapsed[group.key]
            const cost = gr.reduce((a, r) => a + (Number(r.ship_cost) || 0), 0)
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, null)}>
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  {cost > 0 && <span className="ml-auto text-[11px] text-gray-400">Ship cost ${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[980px]">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="w-6" /><th className="w-6" />
                          <th className="text-left font-semibold px-3 py-2 min-w-[200px]">Name</th>
                          <th className="text-left font-semibold px-3 py-2 w-[190px]">Status</th>
                          <th className="text-left font-semibold px-3 py-2 min-w-[180px]">Customer</th>
                          <th className="text-left font-semibold px-3 py-2 min-w-[140px]">Product</th>
                          <th className="text-left font-semibold px-3 py-2 w-[130px]">Requestor</th>
                          <th className="text-left font-semibold px-3 py-2 w-[120px]">Sample Date</th>
                          <th className="text-left font-semibold px-3 py-2 w-[120px]">Ship Due</th>
                          <th className="text-left font-semibold px-3 py-2 w-[150px]">Tracking</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => {
                          const isOpen = open === r.id; const ls = lines[r.id]
                          return (
                            <Fragment key={r.id}>
                              <tr id={'item-' + r.id} className={`group mon-row ${i % 2 ? 'bg-[#F6F8FB]' : 'bg-white'}`} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, r.id)}>
                                <td className="text-center text-gray-300 group-hover:text-gray-500 cursor-grab" draggable onDragStart={() => { dragId.current = r.id }}>&#8942;&#8942;</td>
                                <td className="text-center text-gray-400 cursor-pointer" onClick={() => toggle(r.id)}><span className="inline-block text-[10px]" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>&#9654;</span></td>
                                <td className="px-3 py-2.5 text-[13px] font-medium text-gray-800"><EditCell r={r} field="name" /></td>
                                <td className="px-3 py-2.5"><StatusCell r={r} /></td>
                                <td className="px-3 py-2.5 text-[13px] text-gray-600"><EditCell r={r} field="customer_email" /></td>
                                <td className="px-3 py-2.5 text-[13px] text-gray-600"><EditCell r={r} field="product" /></td>
                                <td className="px-3 py-2.5 text-[13px] text-gray-600"><EditCell r={r} field="requestor" /></td>
                                <td className="px-3 py-2.5 text-[13px] text-gray-600"><EditCell r={r} field="sample_date" type="date" /></td>
                                <td className="px-3 py-2.5 text-[13px] text-gray-600"><EditCell r={r} field="ship_due_date" type="date" /></td>
                                <td className="px-3 py-2.5 text-[13px]"><EditCell r={r} field="tracking_number" mono /></td>
                                <td className="text-center"><button onClick={() => deleteSample(r.id, r.name)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><i className="ti ti-trash" /></button></td>
                              </tr>
                              {isOpen && (
                                <tr className="bg-[#F9FAFB]">
                                  <td colSpan={COLS + 2} className="px-8 py-3">
                                    <div className="mb-2"><ShareLink id={r.id} /></div>
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                      <button onClick={() => setShipSample(r)} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors"><i className="ti ti-truck-delivery text-sm" />Confirm Shipped &amp; Email</button>
                                      <button onClick={() => deleteSample(r.id, r.name)} className="inline-flex items-center gap-1.5 text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"><i className="ti ti-trash text-sm" />Delete</button>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs mb-3">
                                      <div><span className="text-gray-400">Facility: </span><span className="text-gray-700">{r.requesting_facility || '—'}</span></div>
                                      <div><span className="text-gray-400">Type: </span><span className="text-gray-700">{r.customer_type || '—'}</span></div>
                                      <div><span className="text-gray-400">Via: </span><span className="text-gray-700">{r.shipped_via || '—'}</span></div>
                                      <div><span className="text-gray-400">Tracking: </span><span className="text-gray-700 font-mono">{r.tracking_number || '—'}</span></div>
                                      <div className="col-span-2 md:col-span-4"><span className="text-gray-400">Ship To: </span><span className="text-gray-700">{r.ship_to_address || '—'}</span></div>
                                    </div>
                                    {ls == null ? <p className="text-xs text-gray-400">Loading items…</p>
                                    : ls.length === 0 ? <p className="text-xs text-gray-400">No sample items.</p>
                                    : <table className="w-full text-xs"><thead><tr className="text-gray-400"><th className="text-left py-1">Item</th><th className="text-left py-1">SKU</th><th className="text-right py-1">Qty</th></tr></thead>
                                        <tbody>{ls.map(ln => <tr key={ln.id} className="border-t border-[#EEF0F5]"><td className="py-1.5 text-gray-700">{ln.name || '—'}</td><td className="py-1.5 font-mono text-emerald-600">{ln.sku || '—'}</td><td className="py-1.5 text-right text-gray-600">{ln.quantity ?? '—'}</td></tr>)}</tbody></table>}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                        {gr.length === 0 && <tr><td colSpan={COLS + 2} className="px-4 py-3 text-center text-gray-400 text-xs italic">Drop items here or add one below</td></tr>}
                        <tr><td /><td /><td colSpan={COLS} className="px-3 py-2"><button onClick={() => addItem(group.key)} className="text-[13px] text-gray-400 hover:text-[#0086C0]">+ Add item</button></td></tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <AddSampleModal open={showAddModal} onClose={() => setShowAddModal(false)} onCreated={load} sb={sb} />
      {shipSample && <ShipConfirmModal sample={shipSample} lines={lines[shipSample.id]} sb={sb} onClose={() => setShipSample(null)} onDone={load} />}
    </div>
  )
}
