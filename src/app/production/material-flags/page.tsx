'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

/**
 * Material Red Flags — every open order whose material could be late.
 *
 * Flags come from v_material_red_flags and are logged in material_red_flag_log, so a flag
 * stays RED until its cause is fixed (BOM finished, resin ordered, etc). New flags email the
 * people under "Who gets alerts" within 15 minutes; open RED FLAGS repeat every weekday morning.
 *
 * Long-lead items (resin and anything else ticked below) are flagged the moment they are on
 * a BOM, even a partial one, and are not ordered. A BOM stays flagged until someone marks it
 * complete on the product's BOM screen.
 */

const sb = createSupabaseBrowserClient()

interface Flag {
  flag_key: string
  order_id: string | null
  order_number: string | null
  sku: string | null
  component_sku: string | null
  kind: string
  severity: string | null
  detail: string | null
  required_ship_date: string | null
  order_by_date: string | null
  first_seen: string
}
interface LongLead { id: string; sku: string; product_name: string | null; category: string | null; is_long_lead: boolean; lead_time_days: number | null }
interface Recipient { id: string; user_email: string; email: boolean; in_app: boolean }

const KIND_LABEL: Record<string, string> = {
  LONG_LEAD: 'Long-lead item not ordered',
  NO_BOM: 'No BOM',
  BOM_INCOMPLETE: 'BOM incomplete',
  BOM_UNCONFIRMED: 'BOM not marked complete',
  COMPONENT_MISSING: 'Component not in Inventory',
  NOT_ORDERED: 'Not on purchasing board',
  NOT_PLACED: 'Requested, not ordered',
  CANT_SIZE: 'Cannot size material',
  CHECK_SIZE: 'Check material math',
}

const fmtDate = (d: string | null) => (d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
const daysOpen = (d: string) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000))

export default function MaterialFlagsPage() {
  const [tab, setTab] = useState<'flags' | 'longlead' | 'alerts'>('flags')
  const [flags, setFlags] = useState<Flag[]>([])
  const [items, setItems] = useState<LongLead[]>([])
  const [recips, setRecips] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showWarnings, setShowWarnings] = useState(true)
  const [newEmail, setNewEmail] = useState('')

  async function load() {
    setLoading(true)
    const [f, p, r] = await Promise.all([
      sb.from('material_red_flag_log').select('*').is('resolved_at', null).order('required_ship_date', { ascending: true, nullsFirst: false }),
      sb.from('products').select('id, sku, product_name, category, is_long_lead, lead_time_days')
        .or('is_long_lead.eq.true,category.in.("Raw Material","Additives","Component","Print Plates","Packaging")')
        .eq('is_active', true).order('is_long_lead', { ascending: false }).order('sku'),
      sb.from('notification_settings').select('id, user_email, email, in_app').eq('notification_type', 'material_red_flag').order('user_email'),
    ])
    setFlags((f.data || []) as Flag[])
    setItems((p.data || []) as LongLead[])
    setRecips((r.data || []) as Recipient[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function recheck() {
    setBusy('recheck'); setMsg(null)
    const { data, error } = await sb.rpc('material_red_flags_sync', { p_send: true })
    setMsg(error ? `Could not re-check: ${error.message}` : data ? `${data} new flag${data === 1 ? '' : 's'} found and sent to the team.` : 'Re-checked. Nothing new.')
    await load(); setBusy(null)
  }

  async function saveItem(it: LongLead, patch: Partial<LongLead>) {
    setBusy(it.id)
    const { error } = await sb.from('products').update(patch).eq('id', it.id)
    if (!error) setItems(xs => xs.map(x => (x.id === it.id ? { ...x, ...patch } : x)))
    else setMsg(`Could not save ${it.sku}: ${error.message}`)
    setBusy(null)
  }

  async function addRecipient() {
    const e = newEmail.trim().toLowerCase()
    if (!e.includes('@')) return
    setBusy('recip')
    const { error } = await sb.from('notification_settings').insert({ notification_type: 'material_red_flag', user_email: e, email: true, in_app: true })
    if (error) setMsg(`Could not add ${e}: ${error.message}`)
    setNewEmail(''); await load(); setBusy(null)
  }
  async function removeRecipient(id: string) {
    setBusy(id)
    await sb.from('notification_settings').delete().eq('id', id)
    await load(); setBusy(null)
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return flags
      .filter(f => showWarnings || f.severity === 'critical')
      .filter(f => !q || [f.order_number, f.sku, f.component_sku, f.detail].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1)
        || (a.order_by_date || a.required_ship_date || '9999').localeCompare(b.order_by_date || b.required_ship_date || '9999'))
  }, [flags, search, showWarnings])

  const nCritical = flags.filter(f => f.severity === 'critical').length
  const longLeadCount = items.filter(i => i.is_long_lead).length

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-500/15 text-red-700 border-red-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Material Red Flags</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${nCritical} red flag${nCritical === 1 ? '' : 's'} · ${flags.length - nCritical} to check · each stays open until its cause is fixed`}
          </p>
        </div>
        <button onClick={recheck} disabled={busy === 'recheck'}
          className="self-start sm:self-auto bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
          {busy === 'recheck' ? 'Checking…' : 'Re-check now'}
        </button>
      </div>

      {msg && <div className="mb-4 text-sm rounded-lg border border-[#E4E6EE] bg-white px-3 py-2 text-[#1A1D2E]">{msg}</div>}

      <div className="flex items-center gap-1 mb-4 border-b border-[#E4E6EE] overflow-x-auto">
        {([['flags', `Open flags (${flags.length})`], ['longlead', `Long-lead items (${longLeadCount})`], ['alerts', `Who gets alerts (${recips.length})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === k ? 'border-red-600 text-[#1A1D2E]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'flags' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
            <input placeholder="Search order, SKU or material…" value={search} onChange={e => setSearch(e.target.value)}
              className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-red-500" />
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showWarnings} onChange={e => setShowWarnings(e.target.checked)} className="w-4 h-4 accent-red-600" />
              Show items to check (not just red flags)
            </label>
          </div>
          {!loading && shown.length === 0 && (
            <div className="rounded-xl border border-[#E4E6EE] bg-white p-6 text-sm text-gray-500 text-center">No open material flags.</div>
          )}
          <div className="grid gap-3">
            {shown.map(f => {
              const red = f.severity === 'critical'
              const late = f.order_by_date && f.order_by_date < new Date().toISOString().slice(0, 10)
              return (
                <div key={f.flag_key} className={`rounded-xl border bg-white p-4 ${red ? 'border-red-300 border-l-4 border-l-red-600' : 'border-[#E4E6EE] border-l-4 border-l-amber-400'}`}>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`text-[11px] font-bold rounded px-2 py-0.5 ${red ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}`}>{red ? 'RED FLAG' : 'CHECK'}</span>
                    <span className="text-sm font-semibold text-[#1A1D2E]">{KIND_LABEL[f.kind] || f.kind}</span>
                    <span className="text-xs text-gray-400 ml-auto">open {daysOpen(f.first_seen)} day{daysOpen(f.first_seen) === 1 ? '' : 's'}</span>
                  </div>
                  <p className="text-sm text-gray-700 break-words">{f.detail}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                    {f.order_number && (
                      <Link href={f.order_id ? `/sales/orders?item=${f.order_id}` : '/sales/orders'} className="text-emerald-700 font-medium underline">Order {f.order_number}</Link>
                    )}
                    {f.sku && <span>Product <span className="font-mono text-[#1A1D2E]">{f.sku}</span></span>}
                    {f.component_sku && <span>Material <span className="font-mono text-[#1A1D2E]">{f.component_sku}</span></span>}
                    {f.required_ship_date && <span>Ship {fmtDate(f.required_ship_date)}</span>}
                    {f.order_by_date && <span className={`font-semibold ${late ? 'text-red-700' : 'text-[#1A1D2E]'}`}>Order by {fmtDate(f.order_by_date)}{late ? ' (past due)' : ''}</span>}
                    {f.kind === 'LONG_LEAD' && !f.order_by_date && <span className="text-amber-700">Lead time not set, order now</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {tab === 'longlead' && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Ticked items are long lead or critical. They are red-flagged the moment they are on any BOM, even one that is only partly filled in, and not ordered.
            Add a lead time so the flag shows the order-by date.
          </p>
          <div className="grid gap-2">
            {items.map(it => (
              <div key={it.id} className={`rounded-xl border bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-2 ${it.is_long_lead ? 'border-red-200' : 'border-[#E4E6EE]'}`}>
                <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                  <input type="checkbox" checked={it.is_long_lead} disabled={busy === it.id}
                    onChange={e => saveItem(it, { is_long_lead: e.target.checked })} className="w-5 h-5 mt-0.5 accent-red-600 shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-mono text-sm text-[#1A1D2E] break-all">{it.sku}</span>
                    <span className="block text-xs text-gray-500 break-words">{it.product_name} {it.category ? `· ${it.category}` : ''}</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 pl-8 sm:pl-0">
                  Lead time
                  <input type="number" min={0} defaultValue={it.lead_time_days ?? ''} placeholder="days"
                    onBlur={e => { const v = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10)); if (v !== it.lead_time_days) saveItem(it, { lead_time_days: v }) }}
                    className="w-20 bg-white border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                  days
                </label>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'alerts' && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            These people get an email and an ERP notification within 15 minutes of a new flag, and an email every weekday at 7:05am listing every RED FLAG still open.
          </p>
          <div className="grid gap-2 mb-4">
            {recips.map(r => (
              <div key={r.id} className="rounded-xl border border-[#E4E6EE] bg-white p-3 flex items-center gap-3">
                <span className="text-sm text-[#1A1D2E] break-all flex-1">{r.user_email}</span>
                <button onClick={() => removeRecipient(r.id)} disabled={busy === r.id} className="text-sm text-red-600 hover:underline disabled:opacity-50">Remove</button>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="email" placeholder="name@beyondgreenbiotech.com" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-red-500" />
            <button onClick={addRecipient} disabled={busy === 'recip' || !newEmail.includes('@')}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">Add person</button>
          </div>
        </>
      )}
    </div>
  )
}
