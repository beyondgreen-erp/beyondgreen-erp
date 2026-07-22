'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import Comments from '@/components/Comments'

interface Line { id?: string; _new?: boolean; name: string | null; sku: string | null; quantity: number | null }
interface Sample {
  id: string; name: string | null; requesting_facility: string | null; requestor: string | null; customer_email: string | null
  customer_type: string | null; product: string | null; status: string | null; ship_due_date: string | null; sample_date: string | null
  ship_cost: number | null; shipped_via: string | null; tracking_number: string | null; ship_to_address: string | null; group_name: string | null
  recipient_email?: string | null; position?: number | null; attachments?: { name: string; url: string }[] | null
}

const STATUSES = [
  { label: 'Ready', hex: '#fdab3d' },
  { label: 'Hold', hex: '#579bfc' },
  { label: 'Shipped', hex: '#037f4c' },
  { label: 'Complete', hex: '#00c875' },
  { label: 'Moved to Sales Pipeline', hex: '#9d50dd' },
  { label: 'Cancelled', hex: '#df2f4a' },
  { label: 'Unfulfillable', hex: '#e2445c' },
]
const STATUS_OPTIONS = STATUSES.map(s => s.label)
const statusHex = (s: string | null) => STATUSES.find(x => x.label === s)?.hex || '#c4c4c4'
const GROUPS = [
  { key: 'Pending Sample Shipments', color: '#FDAB3D' },
  { key: 'Shipped Samples', color: '#00A84F' },
]
const GROUP_OPTIONS = GROUPS.map(g => g.key)

const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
function escHtml(v: unknown): string { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

const FIELDS: { key: keyof Sample; label: string; kind: 'text' | 'date' | 'num' | 'status' | 'group'; wide?: boolean }[] = [
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'group_name', label: 'Group', kind: 'group' },
  { key: 'requesting_facility', label: 'Requesting Facility', kind: 'text' },
  { key: 'requestor', label: 'Requestor', kind: 'text' },
  { key: 'customer_email', label: 'Customer Email', kind: 'text' },
  { key: 'customer_type', label: 'Customer Type', kind: 'text' },
  { key: 'product', label: 'Product', kind: 'text' },
  { key: 'sample_date', label: 'Sample Date', kind: 'date' },
  { key: 'ship_due_date', label: 'Ship Due Date', kind: 'date' },
  { key: 'ship_cost', label: 'Ship Cost', kind: 'num' },
  { key: 'shipped_via', label: 'Shipped Via', kind: 'text' },
  { key: 'tracking_number', label: 'Tracking #', kind: 'text' },
  { key: 'recipient_email', label: 'Recipient Email', kind: 'text' },
  { key: 'ship_to_address', label: 'Ship-To Address', kind: 'text', wide: true },
]

// ─────────────────────────── Add Sample modal ───────────────────────────
function AddSampleModal({ open, onClose, onCreated, sb }: { open: boolean; onClose: () => void; onCreated: () => void; sb: ReturnType<typeof createSupabaseBrowserClient> }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<any[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [form, setForm] = useState({ name: '', recipient_email: '', ship_to_address: '', note: '', is_custom_request: false, selected_items: [] as string[], tagged_people: [] as string[], files: [] as File[] })

  useEffect(() => {
    if (open) { setCatalogLoading(true); sb.from('sample_catalog').select('id,name,sku').then(({ data }) => { setCatalog(data || []); setCatalogLoading(false) }) }
  }, [open, sb])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) setForm(prev => ({ ...prev, files: Array.from(e.target.files as FileList) })) }
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const files_inline: any[] = []
      for (const file of form.files) { const data = await file.arrayBuffer(); files_inline.push({ filename: file.name, mimetype: file.type, data: btoa(String.fromCharCode(...new Uint8Array(data))) }) }
      const result = await sb.functions.invoke('sample-submission-create', {
        body: { name: form.name, recipient_email: form.recipient_email, ship_to_address: form.ship_to_address, note: form.note, is_custom_request: form.is_custom_request, sample_items: form.selected_items.map((id, idx) => ({ line_number: idx + 1, catalog_id: id })), tagged_people: form.tagged_people, files_inline: files_inline },
      })
      if (result.error) throw new Error(result.error as any)
      setForm({ name: '', recipient_email: '', ship_to_address: '', note: '', is_custom_request: false, selected_items: [], tagged_people: [], files: [] })
      onClose(); onCreated()
    } catch (err: any) { setError(err.message || 'Failed to create sample submission') } finally { setLoading(false) }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Add Sample Submission</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Request Name</label><input type="text" required value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g., Q3 Product Line" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Recipient Email</label><input type="email" required value={form.recipient_email} onChange={e => setForm(prev => ({ ...prev, recipient_email: e.target.value }))} placeholder="customer@example.com" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Ship-To Address</label><textarea value={form.ship_to_address} onChange={e => setForm(prev => ({ ...prev, ship_to_address: e.target.value }))} placeholder="Full shipping address" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" rows={2} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Note</label><textarea value={form.note} onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Any special instructions or notes…" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" rows={2} /></div>
          <div className="flex items-center gap-2"><input type="checkbox" id="custom" checked={form.is_custom_request} onChange={e => setForm(prev => ({ ...prev, is_custom_request: e.target.checked, selected_items: e.target.checked ? [] : prev.selected_items }))} className="w-4 h-4 text-blue-600 rounded" /><label htmlFor="custom" className="text-sm font-medium text-gray-700">Custom Request (no catalog items)</label></div>
          {!form.is_custom_request && (
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Sample Items</label>
              {catalogLoading ? <p className="text-sm text-gray-500">Loading catalog…</p> : catalog.length === 0 ? <p className="text-sm text-gray-500">No catalog items available</p>
              : <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {catalog.map(item => (<label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.selected_items.includes(item.id)} onChange={e => { setForm(prev => ({ ...prev, selected_items: e.target.checked ? [...prev.selected_items, item.id] : prev.selected_items.filter(id => id !== item.id) })) }} className="w-4 h-4 text-blue-600 rounded" /><span className="text-gray-700">{item.name} ({item.sku})</span></label>))}
                </div>}
            </div>
          )}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Tag Team Members</label><input type="text" placeholder="Enter emails, comma-separated" value={form.tagged_people.join(', ')} onChange={e => setForm(prev => ({ ...prev, tagged_people: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />{form.tagged_people.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{form.tagged_people.map(email => <span key={email} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{email}</span>)}</div>}</div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label><input type="file" multiple onChange={handleFileChange} className="w-full" />{form.files.length > 0 && <div className="mt-2 text-sm text-gray-600">{form.files.length} file(s) selected</div>}</div>
          <div className="flex gap-2 pt-4 border-t border-gray-200"><button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition">{loading ? 'Creating…' : 'Create Submission'}</button><button type="button" onClick={onClose} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-2 rounded-lg transition">Cancel</button></div>
        </form>
      </div>
    </div>
  )
}

function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  const t = (tracking || '').trim()
  if (!t) return null
  const enc = encodeURIComponent(t)
  const c = (carrier || '').toLowerCase()
  if (c.includes('ups')) return `https://www.ups.com/track?loc=en_US&tracknum=${enc}`
  if (c.includes('fedex') || c.includes('fed ex')) return `https://www.fedex.com/fedextrack/?trknbr=${enc}`
  if (c.includes('usps') || c.includes('postal') || c.includes('mail')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc}`
  if (c.includes('dhl')) return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${enc}`
  if (/^1Z[0-9A-Z]{16}$/i.test(t)) return `https://www.ups.com/track?loc=en_US&tracknum=${enc}`
  if (/^(94|93|92|95|420)\d{15,26}$/.test(t) || /^\d{20,22}$/.test(t)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc}`
  if (/^\d{12}$|^\d{15}$/.test(t)) return `https://www.fedex.com/fedextrack/?trknbr=${enc}`
  return null
}

function buildShippedEmail(opts: { sample: Sample; items: Line[]; carrier: string; tracking: string; shipTo: string }): string {
  const { sample, items, carrier, tracking, shipTo } = opts
  const trackUrl = trackingUrl(carrier, tracking)
  const rows = items.map(i => `<tr><td style="padding:6px 10px;border-top:1px solid #eee">${escHtml(i.name || '—')}</td><td style="padding:6px 10px;border-top:1px solid #eee;font-family:monospace">${escHtml(i.sku || '—')}</td><td style="padding:6px 10px;border-top:1px solid #eee;text-align:right">${i.quantity ?? '—'}</td></tr>`).join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1A1D2E">
  <h2 style="color:#16a34a;margin:0 0 8px">Your sample has shipped</h2>
  <p style="margin:0 0 12px">Hi${sample.name ? ' ' + escHtml(sample.name) : ''},</p>
  <p style="margin:0 0 12px">Good news! The beyondGREEN team has sent the samples you requested!</p>
  <table style="border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:14px">
    <tr><td style="padding:4px 0;color:#6b7280;width:120px">Carrier</td><td style="padding:4px 0;font-weight:600">${escHtml(carrier || '—')}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280">Tracking #</td><td style="padding:4px 0;font-weight:600;font-family:monospace">${trackUrl ? `<a href="${trackUrl}" style="color:#16a34a;text-decoration:underline">${escHtml(tracking)}</a>` : escHtml(tracking || '—')}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280">Ship to</td><td style="padding:4px 0">${escHtml(shipTo || '—')}</td></tr>
    ${sample.product ? `<tr><td style="padding:4px 0;color:#6b7280">Product</td><td style="padding:4px 0">${escHtml(sample.product)}</td></tr>` : ''}
  </table>
  ${trackUrl ? `<div style="margin:2px 0 18px"><a href="${trackUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600">Track your shipment</a></div>` : ''}
  ${items.length ? `<h3 style="font-size:14px;margin:16px 0 4px">Items</h3><table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr><th style="text-align:left;padding:6px 10px;color:#6b7280">Item</th><th style="text-align:left;padding:6px 10px;color:#6b7280">SKU</th><th style="text-align:right;padding:6px 10px;color:#6b7280">Qty</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
  <p style="margin:20px 0 0">Thank you,<br/>The beyondGREEN Team</p>
</div>`
}

function ShipConfirmModal({ sample, lines, sb, onClose, onDone }: { sample: Sample; lines?: Line[]; sb: ReturnType<typeof createSupabaseBrowserClient>; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState<Line[]>(lines || [])
  const [carrier, setCarrier] = useState(sample.shipped_via || '')
  const [tracking, setTracking] = useState(sample.tracking_number || '')
  const [shipTo, setShipTo] = useState(sample.ship_to_address || '')
  const [recipient, setRecipient] = useState(sample.customer_email || sample.recipient_email || '')
  const [subject, setSubject] = useState(`Your beyondGREEN sample(s) have shipped${sample.name ? ` - ${sample.name}` : ''}`)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  useEffect(() => { if (!lines || lines.length === 0) { sb.from('sample_submission_lines').select('id,name,sku,quantity').eq('sample_id', sample.id).order('line_number').then(({ data }) => setItems((data as Line[]) || [])) } }, [lines, sample.id, sb])
  const html = useMemo(() => buildShippedEmail({ sample, items, carrier, tracking, shipTo }), [sample, items, carrier, tracking, shipTo])
  async function sendAndMark() {
    if (!recipient.trim()) { setError('A recipient email is required.'); return }
    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: recipient.trim(), subject, html, reply_to: 'info@byndgrn.com' }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed to send email')
      const now = new Date().toISOString()
      await sb.from('sample_submissions').update({ status: 'Shipped', group_name: 'Shipped Samples', shipped_via: carrier || null, tracking_number: tracking || null, ship_to_address: shipTo || null, recipient_email: recipient.trim(), shipped_at: now, shipped_email_sent_at: now, updated_at: now }).eq('id', sample.id)
      setSent(true); onDone(); setTimeout(onClose, 900)
    } catch (e) { setError((e as Error).message) }
    setSending(false)
  }
  const inp = 'w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-[#1A1D2E]'
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-[#E4E6EE] flex items-center justify-between shrink-0">
          <div><h2 className="font-bold text-lg text-[#1A1D2E]">Confirm Shipped</h2><p className="text-xs text-gray-500 mt-0.5">Review the email, then send it to the recipient and mark this sample shipped.</p></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xl">&times;</button>
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
          <div className="p-6 bg-[#F9FAFB]"><p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Email preview</p><div className="bg-white border border-[#E4E6EE] rounded-lg p-4 overflow-auto" style={{ maxHeight: 360 }} dangerouslySetInnerHTML={{ __html: html }} /></div>
        </div>
        <div className="px-6 py-4 border-t border-[#E4E6EE] flex items-center gap-3 justify-end shrink-0">
          {error && <p className="text-sm text-red-600 mr-auto">{error}</p>}
          {sent && <p className="text-sm text-emerald-600 mr-auto font-medium">Sent &amp; marked shipped ✓</p>}
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium rounded-lg hover:bg-gray-100">Cancel</button>
          <button onClick={sendAndMark} disabled={sending || sent} className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg">{sending ? 'Sending…' : 'Send & Mark Shipped'}</button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, c }: { label: string; value: string | number; c?: string }) {
  return (<div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}><p className="text-xs font-semibold text-gray-400">{label}</p><p className="mon-stat-val mt-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</p></div>)
}

export default function SamplesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Sample[]>([])

  // Deep-link: open the item referenced by ?item=<id> in the URL (used by @mention notifications).
  const deepLinkOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const openId = new URLSearchParams(window.location.search).get('item')
    if (!openId || deepLinkOpenedRef.current === openId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (rows as any[]).find((x) => x && x.id === openId)
    if (target) { deepLinkOpenedRef.current = openId; openDetail(target) }
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const [items, setItems] = useState<Record<string, Line[]>>({})
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ 'Shipped Samples': true })
  const [showAddModal, setShowAddModal] = useState(false)
  const [shipSample, setShipSample] = useState<Sample | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const dragId = useRef<string | null>(null)

  const [detail, setDetail] = useState<Sample | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [lineForms, setLineForms] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const all: Sample[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from('sample_submissions').select('*').order('position', { ascending: true, nullsFirst: false }).range(from, from + 999)
      const batch = (data as Sample[]) || []
      all.push(...batch)
      if (batch.length < 1000) break
    }
    setRows(all)
    const ids = all.map(r => r.id)
    if (ids.length) {
      const counts: Record<string, number> = {}
      for (let i = 0; i < ids.length; i += 300) {
        const { data: cm } = await sb.from('comments').select('record_id').eq('record_type', 'sample_submission').in('record_id', ids.slice(i, i + 300))
        ;(cm || []).forEach((c: any) => { counts[c.record_id] = (counts[c.record_id] || 0) + 1 })
      }
      setCommentCounts(counts)
    }
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const ensureLines = useCallback(async (id: string) => {
    if (items[id]) return
    const { data } = await sb.from('sample_submission_lines').select('id,name,sku,quantity').eq('sample_id', id).order('line_number')
    setItems(m => ({ ...m, [id]: (data as Line[]) || [] }))
  }, [items, sb])

  async function openDetail(r: Sample) { setEditing(false); setDetail(r); await ensureLines(r.id) }
  useItemDeepLink(rows, (r) => openDetail(r as Sample))
  function closeDetail() { setDetail(null); setEditing(false) }

  const detailLines = detail ? (items[detail.id] || []) : []

  function startEdit() {
    if (!detail) return
    const f: any = {}
    for (const fld of FIELDS) f[fld.key] = (detail as any)[fld.key] ?? ''
    f.name = detail.name ?? ''
    setForm(f)
    setLineForms(detailLines.map(l => ({ id: l.id, name: l.name ?? '', sku: l.sku ?? '', quantity: l.quantity })))
    setEditing(true)
  }
  const setLine = (idx: number, patch: Partial<Line>) => setLineForms(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const addLine = () => setLineForms(ls => [...ls, { _new: true, name: '', sku: '', quantity: null }])
  const removeLine = (idx: number) => setLineForms(ls => ls.filter((_, i) => i !== idx))

  async function saveRecord() {
    if (!detail) return
    setSaving(true)
    try {
      const clean = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
      const patch: any = { name: clean(form.name) ?? detail.name, updated_at: new Date().toISOString() }
      for (const fld of FIELDS) {
        if (fld.kind === 'date') patch[fld.key] = form[fld.key] || null
        else if (fld.kind === 'num') { const n = Number(form[fld.key]); patch[fld.key] = form[fld.key] === '' || isNaN(n) ? null : n }
        else patch[fld.key] = clean(form[fld.key])
      }
      const { error: upErr } = await sb.from('sample_submissions').update(patch).eq('id', detail.id)
      if (upErr) { alert('Save failed: ' + upErr.message); return }

      const keptIds = lineForms.filter(l => l.id && !l._new).map(l => l.id)
      const toDelete = detailLines.map(l => l.id).filter(id => id && !keptIds.includes(id)) as string[]
      if (toDelete.length) await sb.from('sample_submission_lines').delete().in('id', toDelete)
      for (let idx = 0; idx < lineForms.length; idx++) {
        const l = lineForms[idx]
        const q = l.quantity == null || (l.quantity as any) === '' ? null : Number(l.quantity)
        const row: any = { sample_id: detail.id, name: (String(l.name ?? '').trim() || null), sku: (String(l.sku ?? '').trim() || null), quantity: isNaN(q as any) ? null : q, line_number: idx + 1 }
        if (l._new || !l.id) await sb.from('sample_submission_lines').insert(row)
        else await sb.from('sample_submission_lines').update(row).eq('id', l.id)
      }
      const updated = { ...detail, ...patch }
      setRows(rs => rs.map(r => r.id === detail.id ? updated : r))
      setItems(m => { const cp = { ...m }; delete cp[detail.id]; return cp })
      setDetail(updated); setEditing(false)
      await ensureLines(detail.id)
    } finally { setSaving(false) }
  }

  async function deleteRecord() {
    if (!detail) return
    if (!confirm(`Delete "${detail.name || 'this submission'}"?\n\nThis permanently removes the record, its line items, and all of its comments. This cannot be undone.`)) return
    setDeleting(true)
    try {
      await sb.from('sample_submission_lines').delete().eq('sample_id', detail.id)
      await sb.rpc('delete_record_comments', { p_record_type: 'sample_submission', p_record_id: detail.id })
      const { error } = await sb.from('sample_submissions').delete().eq('id', detail.id)
      if (error) { alert('Delete failed: ' + error.message); return }
      setRows(rs => rs.filter(r => r.id !== detail.id)); closeDetail()
    } finally { setDeleting(false) }
  }

  async function uploadRecordFile(rec: Sample, file: File) {
    setUploading(true)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `samples/${rec.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`
      const { error } = await sb.storage.from('record-board').upload(path, file)
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = sb.storage.from('record-board').getPublicUrl(path)
      const next = [...(rec.attachments || []), { name: file.name, url: data.publicUrl }]
      await sb.from('sample_submissions').update({ attachments: next }).eq('id', rec.id)
      setRows(rs => rs.map(o => o.id === rec.id ? { ...o, attachments: next } : o))
      setDetail((d: any) => (d && d.id === rec.id ? { ...d, attachments: next } : d))
    } finally { setUploading(false) }
  }
  async function removeRecordFile(rec: Sample, idx: number) {
    const next = (rec.attachments || []).filter((_: any, i: number) => i !== idx)
    await sb.from('sample_submissions').update({ attachments: next }).eq('id', rec.id)
    setRows(rs => rs.map(o => o.id === rec.id ? { ...o, attachments: next } : o))
    setDetail((d: any) => (d && d.id === rec.id ? { ...d, attachments: next } : d))
  }

  const q = search.trim().toLowerCase()
  const match = (r: Sample) => !q || [r.name, r.customer_email, r.product, r.requestor, r.tracking_number].some(v => (v || '').toLowerCase().includes(q))
  const groupRows = (key: string) => rows.filter(r => (r.group_name || '') === key && match(r)).sort((a, b) => (a.position || 0) - (b.position || 0))
  const extra = Array.from(new Set(rows.map(r => r.group_name || '').filter(k => k && !GROUPS.some(g => g.key === k))))
  const allGroups = [...GROUPS, ...extra.map(k => ({ key: k, color: '#9699A6' }))]
  // Drag a submission into another group. Dropping into "Shipped Samples" also marks it Shipped.
  async function moveToGroup(targetGroup: string) {
    const id = dragId.current; dragId.current = null
    if (!id) return
    const row = rows.find(r => r.id === id)
    if (!row || (row.group_name || '') === targetGroup) return
    const patch: any = { group_name: targetGroup, updated_at: new Date().toISOString() }
    if (targetGroup === 'Shipped Samples') { patch.status = 'Shipped'; if (!(row as any).shipped_at) patch.shipped_at = new Date().toISOString() }
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    await sb.from('sample_submissions').update(patch).eq('id', id)
  }
  const shownCount = allGroups.reduce((a, g) => a + groupRows(g.key).length, 0)

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'
  const cellCls = 'w-full bg-white border border-[#E4E6EE] rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'

  function editControl(fld: typeof FIELDS[number]) {
    if (fld.kind === 'status') return <select className={inputCls} value={form.status || ''} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}><option value="">—</option>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'group') return <select className={inputCls} value={form.group_name || ''} onChange={e => setForm((f: any) => ({ ...f, group_name: e.target.value }))}><option value="">—</option>{GROUP_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'date') return <input type="date" className={inputCls} value={form[fld.key] || ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    if (fld.kind === 'num') return <input type="number" className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    return <input className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
  }

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
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" onDragOver={e => e.preventDefault()} onDrop={() => moveToGroup(group.key)}>
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
                          <th className="text-left font-semibold px-4 py-2 min-w-[200px]">Name</th>
                          <th className="text-left font-semibold px-3 py-2 w-[170px]">Status</th>
                          <th className="text-left font-semibold px-3 py-2 min-w-[180px]">Customer</th>
                          <th className="text-left font-semibold px-3 py-2 min-w-[140px]">Product</th>
                          <th className="text-left font-semibold px-3 py-2 w-[120px]">Sample Date</th>
                          <th className="text-left font-semibold px-3 py-2 w-[120px]">Ship Due</th>
                          <th className="text-left font-semibold px-3 py-2 w-[150px]">Tracking</th>
                          <th className="text-left font-semibold px-3 py-2 w-[80px]">Files</th>
                          <th className="text-left font-semibold px-3 py-2 w-[90px]">Comments</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => {
                          const nFiles = r.attachments?.length || 0
                          const nc = commentCounts[r.id] || 0
                          return (
                            <tr key={r.id} id={'item-' + r.id} draggable onDragStart={e => { dragId.current = r.id; e.dataTransfer.effectAllowed = 'move' }} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
                              <td className="px-4 py-2.5 text-[13px] font-semibold text-[#1A1D2E]">{r.name || <span className="text-gray-300">Untitled</span>}</td>
                              <td className="px-3 py-2.5"><span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: r.status ? statusHex(r.status) : '#c4c4c4' }}>{r.status || '—'}</span></td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600 truncate max-w-[220px]">{r.customer_email || '—'}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600">{r.product || '—'}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600">{fmtD(r.sample_date)}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600">{fmtD(r.ship_due_date)}</td>
                              <td className="px-3 py-2.5 text-[13px] font-mono text-gray-500">{r.tracking_number || '—'}</td>
                              <td className="px-3 py-2.5">{nFiles ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nFiles}</span> : <span className="text-gray-300">—</span>}</td>
                              <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                            </tr>
                          )
                        })}
                        {gr.length === 0 && <tr><td colSpan={9} className="px-4 py-4 text-center text-gray-400 text-xs italic">No submissions</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={closeDetail}>
          <div className="relative w-full max-w-[860px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: statusHex(detail.status) === '#c4c4c4' ? '#0086C0' : statusHex(detail.status) }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">Sample Submission · {detail.group_name || '—'}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name || 'Untitled'}</h2>
                {detail.status && <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.25)' }}>{detail.status}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!editing && (
                  <>
                    <button onClick={() => setShipSample(detail)} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors">🚚 Ship</button>
                    <button onClick={startEdit} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors">✎ Edit</button>
                    <button onClick={deleteRecord} disabled={deleting} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-red-500 disabled:opacity-50 transition-colors">{deleting ? 'Deleting…' : '🗑 Delete'}</button>
                  </>
                )}
                <button onClick={closeDetail} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
              </div>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              <div className="-mt-1"><ShareLink id={detail.id} /></div>

              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Request Name</span><input className={inputCls} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></label>
                  {FIELDS.map(fld => (<label key={String(fld.key)} className={fld.wide ? 'col-span-2 sm:col-span-3' : ''}><span className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</span>{editControl(fld)}</label>))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  {FIELDS.map(fld => (
                    <div key={String(fld.key)} className={fld.wide ? 'col-span-2 sm:col-span-3' : ''}>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</p>
                      <p className="text-gray-800 mt-0.5 break-words">{
                        fld.kind === 'date' ? fmtD((detail as any)[fld.key])
                        : fld.kind === 'num' ? ((detail as any)[fld.key] != null ? '$' + Number((detail as any)[fld.key]).toLocaleString() : <span className="text-gray-300">—</span>)
                        : ((detail as any)[fld.key] || <span className="text-gray-300">—</span>)
                      }</p>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Sample Items</p>
                  {editing && <button onClick={addLine} className="text-xs px-2.5 py-1 rounded-lg bg-[#EAF0FC] text-[#3B6FE0] font-semibold hover:bg-[#DCE7FB]">＋ Add item</button>}
                </div>
                {editing ? (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[520px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-2 py-2">Item</th><th className="text-left px-2 py-2 w-[160px]">SKU</th><th className="text-left px-2 py-2 w-[90px]">Qty</th><th className="px-1 py-2 w-[32px]"></th></tr></thead>
                      <tbody>
                        {lineForms.map((l, idx) => (
                          <tr key={l.id || `new-${idx}`} className="border-t border-[#F0F2F6]">
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.name ?? ''} onChange={e => setLine(idx, { name: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls + ' font-mono'} value={l.sku ?? ''} onChange={e => setLine(idx, { sku: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input type="number" className={cellCls} value={l.quantity ?? ''} onChange={e => setLine(idx, { quantity: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                            <td className="px-1 py-1.5 text-center"><button onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-500 text-base leading-none" title="Remove item">×</button></td>
                          </tr>
                        ))}
                        {lineForms.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">No items. Click “＋ Add item”.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ) : detailLines.length === 0 ? <p className="text-sm text-gray-400">No sample items.</p> : (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2">SKU</th><th className="text-right px-3 py-2">Qty</th></tr></thead>
                      <tbody>
                        {detailLines.map(l => (<tr key={l.id} className="border-t border-[#F0F2F6]"><td className="px-3 py-2 text-gray-700">{l.name || '—'}</td><td className="px-3 py-2 font-mono text-emerald-600">{l.sku || '—'}</td><td className="px-3 py-2 text-right text-gray-600">{l.quantity ?? '—'}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <button onClick={deleteRecord} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete record'}</button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveRecord} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#0086C0' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Files</p>
                  <div>
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={async e => { const fs = Array.from(e.target.files || []); for (const f of fs) { await uploadRecordFile(detail, f) } if (e.target) e.target.value = '' }} />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs px-2.5 py-1.5 rounded-lg bg-[#3B6FE0] text-white font-semibold hover:opacity-90 disabled:opacity-50">{uploading ? 'Uploading…' : '＋ Upload file'}</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(detail.attachments || []).map((f: any, idx: number) => (
                    <div key={'a' + idx} className="flex items-center gap-2 text-xs bg-[#F5FBF7] border border-[#CDEBD9] rounded-lg px-3 py-2">
                      <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 hover:underline"><span className="text-emerald-600">📎</span><span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[220px]">{f.name}</span><span className="text-[10px] text-gray-400">Uploaded</span></span></a>
                      <button onClick={() => removeRecordFile(detail, idx)} className="text-gray-300 hover:text-red-500 leading-none text-base">×</button>
                    </div>
                  ))}
                  {(detail.attachments?.length || 0) === 0 && <p className="text-sm text-gray-400">No files yet — upload one above.</p>}
                </div>
              </div>

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="sample_submission" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}

      <AddSampleModal open={showAddModal} onClose={() => setShowAddModal(false)} onCreated={load} sb={sb} />
      {shipSample && <ShipConfirmModal sample={shipSample} lines={items[shipSample.id]} sb={sb} onClose={() => setShipSample(null)} onDone={load} />}
    </div>
  )
}
