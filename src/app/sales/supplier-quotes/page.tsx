'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
// Every supplier quote in one place: which customer quote (RFQ) it answers, who was asked,
// who has replied, what they quoted. Quotes that arrive by email are logged here by hand.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { usePermissions } from '@/lib/permissions'
import { RfqManualQuoteModal, type SendRow, type Resp } from '@/components/RfqSupplierPanel'

const BOARD = '/sales/supplier-quotes'
const ACCENT = '#1F9A3A'
interface Quote { id: string; quote_number: string | null; status: string | null; quote_date: string | null; customer_id: string | null; notes: string | null }
interface Send extends SendRow { quotation_id: string; expires_at: string | null; reminder_count: number | null }
interface Line { quotation_id: string; sku: string | null; product_name: string | null; description: string | null; quantity: number | null }
type Status = 'received' | 'waiting' | 'noreply'

const fmtD = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
const money = (n: number | null | undefined, c = 'USD') => n == null ? '—' : `${c === 'USD' ? '$' : c + ' '}${Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 4 : 2 })}`
const addDays = (s: string, d: number) => { const x = new Date(s); x.setDate(x.getDate() + d); return x.toISOString() }

export default function SupplierQuotesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const perms = usePermissions()
  const canEdit = perms.canEdit(BOARD) || perms.canEdit('/sales/quotations')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [custs, setCusts] = useState<Record<string, string>>({})
  const [sends, setSends] = useState<Send[]>([])
  const [resps, setResps] = useState<Resp[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [vendors, setVendors] = useState<{ id: string; company_name: string; email: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [quoteFilter, setQuoteFilter] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [logging, setLogging] = useState<{ send: Send; existing: Resp | null } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)   // quotation id, '' = pick one
  const [me, setMe] = useState('')

  const load = useCallback(async () => {
    setErr('')
    const [sR, rR] = await Promise.all([
      sb.from('rfq_sends').select('id,quotation_id,vendor_id,vendor_name,recipient_email,status,sent_at,opened_at,responded_at,error,expires_at,reminder_count').order('sent_at', { ascending: false }),
      sb.from('rfq_vendor_responses').select('*, rfq_response_lines(*)').order('submitted_at', { ascending: false }),
    ])
    if (sR.error) { setErr(sR.error.message); setLoading(false); return }
    const ss = (sR.data as Send[]) || []
    setSends(ss); setResps((rR.data as Resp[]) || [])
    const qids = Array.from(new Set([...ss.map(s => s.quotation_id), ...((rR.data as any[]) || []).map(r => r.quotation_id)].filter(Boolean)))
    const [qR, lR, vR] = await Promise.all([
      sb.from('quotations').select('id,quote_number,status,quote_date,customer_id,notes').order('quote_date', { ascending: false }).limit(500),
      qids.length ? sb.from('quotation_lines').select('quotation_id,sku,product_name,description,quantity').in('quotation_id', qids) : Promise.resolve({ data: [] } as any),
      sb.from('vendors').select('id,company_name,email').order('company_name').limit(2000),
    ])
    const qs = (qR.data as Quote[]) || []
    setQuotes(qs); setLines((lR.data as Line[]) || []); setVendors((vR.data as any[]) || [])
    const cids = Array.from(new Set(qs.map(x => x.customer_id).filter(Boolean))) as string[]
    const cm: Record<string, string> = {}
    for (let i = 0; i < cids.length; i += 200) {
      const { data } = await sb.from('customers').select('id,company_name').in('id', cids.slice(i, i + 200))
      for (const c of (data as any[]) || []) cm[c.id] = c.company_name
    }
    setCusts(cm); setLoading(false)
  }, [sb])
  useEffect(() => { load(); sb.auth.getUser().then(({ data }) => setMe(data.user?.email || '')) }, [load, sb])
  useEffect(() => {
    let t: any; const bump = () => { clearTimeout(t); t = setTimeout(load, 500) }
    const ch = sb.channel('supplier-quotes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfq_sends' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfq_vendor_responses' }, bump).subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load])

  const respBySend = useMemo(() => { const m: Record<string, Resp> = {}; for (const r of resps) if (r.rfq_send_id) m[r.rfq_send_id] = r; return m }, [resps])
  const now = Date.now()
  const statusOf = (s: Send): Status => respBySend[s.id] || s.status === 'Responded' ? 'received' : (s.expires_at && Date.parse(s.expires_at) < now) || Date.parse(s.sent_at) < now - 21 * 864e5 ? 'noreply' : 'waiting'
  const qById = useMemo(() => Object.fromEntries(quotes.map(x => [x.id, x])), [quotes])
  const custOf = (qid: string) => { const x = qById[qid]; return x?.customer_id ? custs[x.customer_id] || '—' : '—' }
  const itemsOf = (qid: string) => lines.filter(l => l.quotation_id === qid)

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const gm = new Map<string, Send[]>()
    for (const s of sends) {
      if (quoteFilter && s.quotation_id !== quoteFilter) continue
      if (filter !== 'all' && statusOf(s) !== filter) continue
      if (needle) {
        const hay = [s.vendor_name, s.recipient_email, qById[s.quotation_id]?.quote_number, custOf(s.quotation_id), ...itemsOf(s.quotation_id).map(l => `${l.sku} ${l.product_name || l.description || ''}`)].join(' ').toLowerCase()
        if (!hay.includes(needle)) continue
      }
      if (!gm.has(s.quotation_id)) gm.set(s.quotation_id, [])
      gm.get(s.quotation_id)!.push(s)
    }
    return Array.from(gm.entries()).sort((a, b) => Math.max(...b[1].map(s => Date.parse(s.sent_at))) - Math.max(...a[1].map(s => Date.parse(s.sent_at))))
  }, [sends, q, filter, quoteFilter, qById, custs, lines, respBySend]) // eslint-disable-line

  const counts = { all: sends.length, received: sends.filter(s => statusOf(s) === 'received').length, waiting: sends.filter(s => statusOf(s) === 'waiting').length, noreply: sends.filter(s => statusOf(s) === 'noreply').length }
  const rfqQuotes = quotes.filter(x => sends.some(s => s.quotation_id === x.id))
  const ST: Record<Status, { label: string; cls: string }> = {
    received: { label: 'Quote received', cls: 'bg-emerald-100 text-emerald-800' },
    waiting: { label: 'Waiting', cls: 'bg-amber-100 text-amber-800' },
    noreply: { label: 'No reply', cls: 'bg-gray-200 text-gray-600' },
  }

  return (
    <div className="min-h-screen mon-page py-4 sm:py-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
        <div>
          <span className="mon-tag" style={{ background: ACCENT + '1f', color: ACCENT }}>Sales · Sourcing</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Supplier Quotes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Every RFQ sent to suppliers, grouped by the customer quote it is for. Log quotes that came in by email here.</p>
        </div>
        {canEdit && <button onClick={() => setAdding('')} className="h-11 px-5 rounded-xl text-white text-sm font-bold shadow-sm" style={{ background: ACCENT }}>+ Log a supplier quote</button>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {([['all', 'Suppliers asked', '#1A1D2E'], ['received', 'Quotes received', '#037f4c'], ['waiting', 'Waiting on reply', '#b45309'], ['noreply', 'No reply (21+ days)', '#6b7280']] as const).map(([k, l, c]) => (
          <button key={k} data-ro-ok onClick={() => setFilter(k)} className={`text-left bg-white rounded-xl border px-4 py-3 ${filter === k ? 'border-[#1F9A3A] ring-2 ring-[#1F9A3A]/15' : 'border-[#ECEEF3]'}`}>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{l}</p>
            <p className="text-2xl font-extrabold" style={{ color: c }}>{counts[k]}</p>
          </button>))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search supplier, customer, quote #, SKU…" className="flex-1 h-10 rounded-lg border border-[#E4E6EE] px-3 text-sm bg-white" />
        <select value={quoteFilter} onChange={e => setQuoteFilter(e.target.value)} className="h-10 rounded-lg border border-[#E4E6EE] px-2 text-sm bg-white sm:w-72">
          <option value="">All customer quotes</option>
          {rfqQuotes.map(x => <option key={x.id} value={x.id}>{x.quote_number} · {custOf(x.id)}</option>)}
        </select>
      </div>

      {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">Could not load: {err}</div>}
      {loading ? <p className="text-sm text-gray-400 py-10 text-center">Loading…</p> : groups.length === 0 ? <p className="text-sm text-gray-400 py-10 text-center">No supplier RFQs match.</p> : (
        <div className="space-y-4">
          {groups.map(([qid, ss]) => {
            const qt = qById[qid]
            const its = itemsOf(qid)
            const got = ss.filter(s => statusOf(s) === 'received')
            const totals = got.map(s => respBySend[s.id]?.total_value).filter((v): v is number => v != null && v > 1)
            const best = totals.length ? Math.min(...totals) : null
            return (
              <div key={qid} className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] overflow-hidden">
                <div className="px-4 py-3 flex flex-wrap items-start justify-between gap-2" style={{ borderLeft: '5px solid ' + ACCENT }}>
                  <div className="min-w-0">
                    <p className="font-bold text-[#1A1D2E]">{qt?.quote_number || 'Quote'} <span className="font-normal text-gray-500">· {custOf(qid)}</span>{qt?.status ? <span className="ml-2 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[#EEF2FB] text-[#3A4A6B]">{qt.status}</span> : null}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[680px]">{its.length ? its.map(l => `${l.product_name || l.description || l.sku}${l.quantity ? ` × ${Number(l.quantity).toLocaleString()}` : ''}`).join(' · ') : 'No line items on this quote'}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{ss.length} supplier{ss.length === 1 ? '' : 's'} asked · <b className="text-emerald-700">{got.length} quoted</b>{best != null ? ` · lowest total ${money(best)}` : ''}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {canEdit && <button onClick={() => setAdding(qid)} className="text-xs font-semibold rounded-lg px-3 py-2 border" style={{ borderColor: ACCENT, color: ACCENT }}>+ Log quote</button>}
                    <a href={`/sales/quotations?item=${qid}`} className="text-xs font-semibold rounded-lg px-3 py-2 border border-[#E4E6EE] text-gray-600">Open quote ↗</a>
                  </div>
                </div>
                <div className="overflow-x-auto border-t border-[#F0F2F6]">
                  <table className="w-full text-sm min-w-[860px]">
                    <thead><tr className="text-[10px] uppercase text-gray-400 bg-[#FAFBFD]">
                      <th className="text-left px-4 py-2">Supplier</th><th className="text-left px-2 py-2">Status</th><th className="text-left px-2 py-2">Sent</th><th className="text-left px-2 py-2">Received</th>
                      <th className="text-right px-2 py-2">Quote total</th><th className="text-left px-2 py-2">Incoterm</th><th className="text-left px-2 py-2">Lead time</th><th className="text-left px-2 py-2">MOQ</th><th className="text-left px-2 py-2">Valid until</th><th className="px-3 py-2"></th>
                    </tr></thead>
                    <tbody>
                      {ss.sort((a, b) => (statusOf(a) === 'received' ? 0 : 1) - (statusOf(b) === 'received' ? 0 : 1) || (respBySend[a.id]?.total_value ?? 9e15) - (respBySend[b.id]?.total_value ?? 9e15)).map(s => {
                        const st = statusOf(s), r = respBySend[s.id], isBest = r?.total_value != null && r.total_value === best && totals.length > 1
                        const exp = r?.validity_days ? addDays(r.submitted_at, r.validity_days) : null
                        return [
                          <tr key={s.id} className={`border-t border-[#F0F2F6] ${isBest ? 'bg-emerald-50/60' : ''}`}>
                            <td className="px-4 py-2.5"><button data-ro-ok onClick={() => r && setOpen(o => ({ ...o, [s.id]: !o[s.id] }))} className="text-left"><span className="font-semibold text-[#1A1D2E]">{s.vendor_name}</span>{isBest && <span className="ml-1.5 text-[10px] font-bold text-emerald-700">LOWEST</span>}<span className="block text-[11px] text-gray-400">{r?.contact_name || s.recipient_email}{r ? ` · ${r.method === 'portal' ? 'via form' : 'logged by hand'}` : ''}{r ? (open[s.id] ? ' ▾' : ' ▸') : ''}</span></button></td>
                            <td className="px-2 py-2.5"><span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${ST[st].cls}`}>{ST[st].label}</span>{st !== 'received' && s.opened_at ? <span className="block text-[10px] text-gray-400 mt-0.5">opened {fmtD(s.opened_at)}</span> : null}</td>
                            <td className="px-2 py-2.5 text-gray-500 text-xs">{fmtD(s.sent_at)}</td>
                            <td className="px-2 py-2.5 text-gray-500 text-xs">{r ? fmtD(r.submitted_at) : '—'}</td>
                            <td className="px-2 py-2.5 text-right font-semibold">{r ? money(r.total_value, r.currency || 'USD') : ''}</td>
                            <td className="px-2 py-2.5 text-xs">{r?.incoterm || ''}</td>
                            <td className="px-2 py-2.5 text-xs">{r?.lead_time_days != null ? `${r.lead_time_days} days` : ''}</td>
                            <td className="px-2 py-2.5 text-xs max-w-[140px] truncate" title={r?.moq_note || ''}>{r?.moq_note || ''}</td>
                            <td className={`px-2 py-2.5 text-xs ${exp && Date.parse(exp) < now ? 'text-red-600 font-semibold' : ''}`}>{exp ? fmtD(exp) : ''}</td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">{canEdit && <button onClick={() => setLogging({ send: s, existing: r || null })} className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 ${r ? 'border border-[#E4E6EE] text-gray-600' : 'text-white'}`} style={r ? undefined : { background: ACCENT }}>{r ? 'Edit' : 'Log quote'}</button>}</td>
                          </tr>,
                          r && open[s.id] ? (
                            <tr key={s.id + '-d'} className="bg-[#FAFBFD]"><td colSpan={10} className="px-4 py-3">
                              {(r.rfq_response_lines || []).length > 0 && <table className="w-full text-xs mb-2"><thead><tr className="text-gray-400"><th className="text-left py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Pcs/case</th><th className="text-right">Case</th><th className="text-right">Line total</th><th className="text-left pl-3">Note</th></tr></thead><tbody>
                                {(r.rfq_response_lines || []).map(l => <tr key={l.id} className="border-t border-[#EEF0F4]"><td className="py-1">{l.description || l.sku}</td><td className="text-right">{l.quantity != null ? Number(l.quantity).toLocaleString() : ''}</td><td className="text-right font-semibold">{money(l.unit_price, r.currency || 'USD')}</td><td className="text-right">{l.pcs_per_case ?? ''}</td><td className="text-right">{l.case_price != null ? money(l.case_price, r.currency || 'USD') : ''}</td><td className="text-right">{l.quantity && l.unit_price ? money(Number(l.quantity) * Number(l.unit_price), r.currency || 'USD') : ''}</td><td className="pl-3 text-gray-500">{l.notes || ''}</td></tr>)}
                              </tbody></table>}
                              <p className="text-[11px] text-gray-600">{[r.payment_terms && `Payment: ${r.payment_terms}`, r.plate_die_charges && `Plates/dies: ${r.plate_die_charges}`, r.overrun_tolerance && `Over/under: ${r.overrun_tolerance}`, r.certifications && `Certs: ${r.certifications}`, r.sample_available != null && `Samples: ${r.sample_available ? 'yes' : 'no'}`, r.exclusions && `Exclusions: ${r.exclusions}`, r.notes && `Notes: ${r.notes}`].filter(Boolean).join(' · ') || 'No terms logged.'}</p>
                            </td></tr>) : null,
                        ]
                      })}
                    </tbody>
                  </table>
                </div>
              </div>)
          })}
        </div>
      )}

      {logging && <RfqManualQuoteModal send={logging.send} existing={logging.existing} quotationId={logging.send.quotation_id} currentUserEmail={me} onClose={() => setLogging(null)} onSaved={() => { setLogging(null); load() }} />}
      {adding !== null && <AddQuoteModal sb={sb} quotes={quotes} custOf={custOf} vendors={vendors} sends={sends} presetQuote={adding} onClose={() => setAdding(null)}
        onReady={(send) => { setAdding(null); setLogging({ send, existing: respBySend[send.id] || null }) }} />}
    </div>
  )
}

/* Pick the customer quote + supplier, then the normal quote form opens. Creates the RFQ record
   when the request went out by email outside the ERP. */
function AddQuoteModal({ sb, quotes, custOf, vendors, sends, presetQuote, onClose, onReady }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; quotes: Quote[]; custOf: (id: string) => string
  vendors: { id: string; company_name: string; email: string | null }[]; sends: Send[]; presetQuote: string
  onClose: () => void; onReady: (s: Send) => void
}) {
  const [qid, setQid] = useState(presetQuote)
  const [vendorName, setVendorName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const asked = sends.filter(s => s.quotation_id === qid)
  const vendor = vendors.find(v => v.company_name.toLowerCase() === vendorName.trim().toLowerCase())
  const existing = asked.find(s => s.vendor_name.toLowerCase() === vendorName.trim().toLowerCase() || (vendor && s.vendor_id === vendor.id))
  useEffect(() => { if (vendor?.email && !email) setEmail(vendor.email) }, [vendor]) // eslint-disable-line
  async function go() {
    setErr('')
    if (!qid) { setErr('Pick the customer quote this supplier quote is for.'); return }
    if (!vendorName.trim()) { setErr('Enter the supplier.'); return }
    if (existing) { onReady(existing); return }
    setBusy(true)
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('')
    const { data, error } = await sb.from('rfq_sends').insert({
      quotation_id: qid, vendor_id: vendor?.id || null, vendor_name: vendor?.company_name || vendorName.trim(),
      recipient_email: email.trim() || vendor?.email || '', token, status: 'Sent', subject: 'RFQ sent outside the ERP — quote logged by hand',
    }).select('id,quotation_id,vendor_id,vendor_name,recipient_email,status,sent_at,opened_at,responded_at,error,expires_at,reminder_count').single()
    setBusy(false)
    if (error) { setErr(error.message); return }
    onReady(data as Send)
  }
  const sorted = [...quotes].sort((a, b) => String(b.quote_date || '').localeCompare(String(a.quote_date || '')))
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div><h2 className="text-lg font-bold text-gray-900">Log a supplier quote</h2><p className="text-xs text-gray-500 mt-0.5">Which customer quote is it for, and who sent it?</p></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <label className="block"><span className="block text-xs font-semibold text-gray-500 mb-1">Customer quote (RFQ)</span>
            <select value={qid} onChange={e => setQid(e.target.value)} className="w-full h-10 rounded-lg border border-gray-300 px-2 text-sm bg-white">
              <option value="">Choose…</option>
              {sorted.map(x => <option key={x.id} value={x.id}>{x.quote_number} · {custOf(x.id)}{x.status ? ` · ${x.status}` : ''}</option>)}
            </select></label>
          <label className="block"><span className="block text-xs font-semibold text-gray-500 mb-1">Supplier</span>
            <input list="sq-vendors" value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Start typing a supplier…" className="w-full h-10 rounded-lg border border-gray-300 px-3 text-sm" />
            <datalist id="sq-vendors">{asked.map(s => <option key={'a' + s.id} value={s.vendor_name}>already asked on this RFQ</option>)}{vendors.map(v => <option key={v.id} value={v.company_name} />)}</datalist>
            {existing ? <span className="block text-[11px] text-emerald-700 mt-1">Already on this RFQ — their quote form opens.</span> : vendorName.trim() && !vendor ? <span className="block text-[11px] text-amber-700 mt-1">Not in Vendors — it will be logged under this name.</span> : null}
          </label>
          {!existing && <label className="block"><span className="block text-xs font-semibold text-gray-500 mb-1">Supplier email (optional)</span>
            <input value={email} onChange={e => setEmail(e.target.value)} className="w-full h-10 rounded-lg border border-gray-300 px-3 text-sm" /></label>}
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 text-sm text-gray-600">Cancel</button>
          <button onClick={go} disabled={busy} className="h-10 px-5 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: ACCENT }}>{busy ? 'Opening…' : 'Next: enter the quote'}</button>
        </div>
      </div>
    </div>)
}
