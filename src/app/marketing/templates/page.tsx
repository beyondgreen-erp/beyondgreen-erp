'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'

const API = '/api/site/templates'
const SITE = 'https://beyondgreen-site.vercel.app'
const CATS = ['Pet Waste Bags', 'Grocery & Produce Bags', 'Trash & Kitchen Liners', 'Paper Bags', 'SOS Paper Bags', 'Paper Cups', 'Coffee Bags', 'Pouches', 'Straw Wrappers', 'Food Trays', 'Clamshells', 'Tuck End Boxes', 'Folding Boxes', 'Tray Boxes', 'Display Boxes', 'Shipping Boxes', 'Envelopes', 'Header Cards & Labels', 'Pet & Home Packaging']
const KIND: Record<string, string> = { single: 'Single template', pack: 'Category pack', pro_month: 'Pro monthly', pro_year: 'Pro yearly' }
const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1b8a3a]/30'
const fmt = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function TemplateLibraryAdmin() {
  const [tab, setTab] = useState<'downloads' | 'members' | 'purchases' | 'prices' | 'credits' | 'templates' | 'upload'>('downloads')
  const [settings, setSettings] = useState<any>(null); const [shopOk, setShopOk] = useState(false)
  const [crEmail, setCrEmail] = useState(''); const [cr, setCr] = useState<any>(null)
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [tpl, setTpl] = useState(''); const [company, setCompany] = useState('')
  const [rows, setRows] = useState<any[]>([]); const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true); const [msg, setMsg] = useState('')
  const [up, setUp] = useState<any>({ category: CATS[0] }); const [busy, setBusy] = useState(false)

  const qs = useMemo(() => {
    const q = new URLSearchParams()
    if (from) q.set('from', from); if (to) q.set('to', to)
    if (tpl && tab === 'downloads') q.set('template', tpl); if (company) q.set('company', company)
    q.set('kind', tab === 'members' ? 'members' : tab === 'purchases' ? 'purchases' : 'downloads')
    return q.toString()
  }, [from, to, tpl, company, tab])

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`${API}/admin-data?${qs}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(j.error || 'Could not load'); setLoading(false); return }
    setRows(j.rows || []); if (j.templates) setTemplates(j.templates)
    setLoading(false)
  }, [qs])
  useEffect(() => { if (tab === 'downloads' || tab === 'members' || tab === 'purchases' || tab === 'templates') load() }, [load, tab])
  useEffect(() => { if (tab === 'prices') fetch(`${API}/admin-data?kind=settings`).then(r => r.json()).then(j => { setSettings(j.settings); setShopOk(!!j.shopify) }) }, [tab])
  async function saveSettings() {
    setBusy(true); const r = await fetch(`${API}/admin-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); const j = await r.json(); setBusy(false)
    setMsg(r.ok ? 'Prices saved. The website shows them within a minute.' : (j.error || 'Could not save')); if (r.ok) setSettings(j.settings)
  }
  async function lookupCredits() { const r = await fetch(`${API}/admin-data?kind=credits&email=${encodeURIComponent(crEmail)}`); setCr(await r.json()) }
  async function useCredit(c: any) {
    const v = prompt(`Amount of this $${Number(c.amount).toFixed(2)} credit that has been used:`, String(c.used_amount)); if (v === null) return
    await fetch(`${API}/admin-credit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, used_amount: Number(v), note: c.note }) }); lookupCredits()
  }

  const stats = useMemo(() => {
    const last7 = Date.now() - 7 * 864e5
    if (tab === 'purchases') { const paid = rows.filter(r => ['paid', 'active', 'canceled'].includes(r.status)); return [{ k: 'Paid orders', v: paid.length }, { k: 'Revenue', v: '$' + paid.reduce((a, r) => a + Number(r.amount), 0).toFixed(2) }, { k: 'Active Pro', v: rows.filter(r => r.status === 'active').length }, { k: 'Refunded', v: rows.filter(r => r.status === 'refunded').length }] }
    if (tab === 'members') return [{ k: 'Members', v: rows.length }, { k: 'Joined in 7 days', v: rows.filter(r => new Date(r.created_at).getTime() > last7).length }, { k: 'Opted in to emails', v: rows.filter(r => r.marketing_consent).length }]
    const byTpl: Record<string, number> = {}; rows.forEach(r => { byTpl[r.template_item] = (byTpl[r.template_item] || 0) + 1 })
    const top = Object.entries(byTpl).sort((a, b) => b[1] - a[1])[0]
    return [{ k: 'Downloads', v: rows.length }, { k: 'Last 7 days', v: rows.filter(r => new Date(r.created_at).getTime() > last7).length }, { k: 'Companies', v: new Set(rows.map(r => (r.company || '').toLowerCase())).size }, { k: 'Top template', v: top ? `${top[0]} (${top[1]})` : '-' }]
  }, [rows, tab])

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg('')
    const fd = new FormData(e.currentTarget)
    const r = await fetch(`${API}/admin-upload`, { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg(j.error || 'Upload failed'); return }
    setMsg(j.replaced ? 'Template replaced. It is live on the website within a minute.' : 'Template added. It is live on the website within a minute.')
    ;(e.target as HTMLFormElement).reset(); setUp({ category: up.category })
  }
  async function toggle(t: any) {
    await fetch(`${API}/admin-toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, is_active: !t.is_active }) })
    load()
  }
  function editTpl(t: any) { setUp({ category: t.category, item: t.item, size: t.size, flat_size: t.flat_size, slug: t.slug }); setTab('upload') }

  const tabBtn = (k: typeof tab, label: string) => (
    <button onClick={() => { setTab(k); setMsg('') }} className={`text-sm px-3 py-1.5 rounded-lg font-semibold ${tab === k ? 'bg-[#1b8a3a] text-white' : 'bg-white border border-[#E4E6EE] text-gray-600'}`}>{label}</button>
  )

  return (
    <div className="min-h-screen mon-page p-4 md:p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <span className="mon-tag t-green">📐 Website · Die Line Templates</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Free die line template library</h1>
          <p className="text-gray-500 text-sm mt-0.5">Who signed up, what they downloaded, and the templates on the website. <a href={`${SITE}/templates`} target="_blank" rel="noreferrer" className="text-[#1b8a3a] font-semibold">Open the library ↗</a></p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap mb-4">{tabBtn('downloads', 'Downloads')}{tabBtn('members', 'Sign-ups')}{tabBtn('purchases', 'Purchases')}{tabBtn('prices', 'Prices')}{tabBtn('credits', 'Print credits')}{tabBtn('templates', `Templates (${templates.length || '…'})`)}{tabBtn('upload', '+ Add or replace')}</div>
      {msg && <div className="mb-3 text-sm rounded-lg border border-[#9FDCB6] bg-[#E8F7EE] px-3 py-2 text-[#14532d]">{msg}</div>}

      {(tab === 'downloads' || tab === 'members' || tab === 'purchases') && (
        <>
          <div className="bg-white rounded-xl border border-[#ECEEF3] p-3 mb-3 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <label className="text-xs text-gray-500">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} /></label>
            <label className="text-xs text-gray-500">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} /></label>
            {tab === 'downloads' && <label className="text-xs text-gray-500">Template<input value={tpl} onChange={e => setTpl(e.target.value)} placeholder="e.g. 16 oz" className={inp} /></label>}
            <label className="text-xs text-gray-500">Company<input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name" className={inp} /></label>
            <a href={`${API}/admin-csv?${qs}`} className="text-sm text-center px-3 py-2 rounded-lg bg-[#1b8a3a] text-white font-semibold">Export CSV</a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            {stats.map(s => <div key={s.k} className="bg-white rounded-xl border border-[#ECEEF3] p-3"><p className="text-[10px] uppercase text-gray-400 font-semibold">{s.k}</p><p className="text-lg font-bold text-[#1A1D2E] break-words">{s.v}</p></div>)}
          </div>
          {loading ? <p className="text-gray-400 text-sm">Loading…</p> : rows.length === 0 ? <div className="bg-white rounded-xl border border-[#ECEEF3] p-8 text-center text-sm text-gray-500">Nothing yet for these filters.</div> : (
            <div className="space-y-2">
              {rows.map(r => tab === 'purchases' ? (
                <div key={r.id} className="bg-white rounded-xl border border-[#ECEEF3] p-3 text-sm">
                  <div className="flex justify-between gap-2 flex-wrap"><b className="text-[#1A1D2E]">{KIND[r.kind] || r.kind}{r.template_item ? `: ${r.template_item}` : r.category_slug && r.kind === 'pack' ? `: ${r.category_slug}` : ''}</b><span className="text-xs text-gray-400">{fmt(r.created_at)}</span></div>
                  <div className="text-gray-600 break-words">{r.company || '-'} · {r.email}</div>
                  <div className="text-xs mt-1 flex gap-2 flex-wrap items-center">
                    <b>${Number(r.amount).toFixed(2)}</b>
                    <span className={`rounded-full px-2 py-0.5 ${r.status === 'paid' || r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : r.status === 'refunded' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{r.status === 'pending' ? 'Checkout not finished' : r.status}</span>
                    {r.shopify_order_name && <span className="text-gray-500">Shopify {r.shopify_order_name} (refund it in Shopify)</span>}
                    {r.current_period_end && <span className="text-gray-500">Access to {new Date(r.current_period_end).toLocaleDateString()}</span>}
                  </div>
                </div>
              ) : tab === 'members' ? (
                <div key={r.id} className="bg-white rounded-xl border border-[#ECEEF3] p-3 text-sm">
                  <div className="flex justify-between gap-2 flex-wrap"><b className="text-[#1A1D2E]">{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email}</b><span className="text-xs text-gray-400">{fmt(r.created_at)}</span></div>
                  <div className="text-gray-600 break-words">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div>
                  <div className="text-gray-600">{r.company || '-'} · {r.business_type || 'Profile not finished'}</div>
                  <div className="text-xs mt-1 flex gap-2 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 ${r.email_verified_at ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.email_verified_at ? 'Email confirmed' : 'Not confirmed'}</span>
                    <span className={`rounded-full px-2 py-0.5 ${r.marketing_consent ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{r.marketing_consent ? 'Opted in to emails' : 'No marketing emails'}</span>
                    <span className="rounded-full px-2 py-0.5 bg-gray-100 text-gray-500">{r.provider === 'google' ? 'Google' : 'Email'}</span>
                  </div>
                </div>
              ) : (
                <div key={r.id} className="bg-white rounded-xl border border-[#ECEEF3] p-3 text-sm">
                  <div className="flex justify-between gap-2 flex-wrap"><b className="text-[#1A1D2E]">{r.template_item}</b><span className="text-xs text-gray-400">{fmt(r.created_at)}</span></div>
                  <div className="text-gray-600">{r.category}{r.kind === 'zip' ? ' · in a category zip' : ''}</div>
                  <div className="text-gray-600 break-words">{r.company || '-'} · {r.email}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'prices' && settings && (
        <div className="bg-white rounded-xl border border-[#ECEEF3] p-4 max-w-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
          <p className="sm:col-span-2 text-sm text-gray-500">Prices for editable (Pro) files. Every purchase also gives a print credit of the same amount. Checkout runs through Shopify: {shopOk ? <b className="text-emerald-700">connected</b> : <b className="text-amber-700">not connected yet (buy buttons say coming soon)</b>}.</p>
          {[['price_single', 'Single template unlock ($)'], ['price_pack', 'Category pack ($)'], ['price_pro_month', 'Pro monthly ($)'], ['price_pro_year', 'Pro yearly ($)'], ['print_credit_months', 'Print credit good for (months)']].map(([k, l]) => (
            <label key={k} className="text-xs text-gray-500">{l}<input type="number" step="0.01" min="0" value={settings[k] ?? ''} onChange={e => setSettings({ ...settings, [k]: e.target.value })} className={inp} /></label>
          ))}
          <label className="text-xs text-gray-500 flex items-center gap-2 mt-5"><input type="checkbox" checked={!!settings.checkout_enabled} onChange={e => setSettings({ ...settings, checkout_enabled: e.target.checked })} /> Selling turned on</label>
          <p className="sm:col-span-2 text-xs text-gray-400">Pro monthly and yearly prices must also match the subscription plan in the Shopify Subscriptions app.</p>
          <button onClick={saveSettings} disabled={busy} className="sm:col-span-2 text-sm px-4 py-2 rounded-lg bg-[#1b8a3a] text-white font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save prices'}</button>
        </div>
      )}

      {tab === 'credits' && (
        <div className="max-w-2xl">
          <div className="bg-white rounded-xl border border-[#ECEEF3] p-3 mb-3 flex gap-2"><input value={crEmail} onChange={e => setCrEmail(e.target.value)} placeholder="Member email" className={inp} /><button onClick={lookupCredits} className="text-sm px-4 py-2 rounded-lg bg-[#1b8a3a] text-white font-semibold">Look up</button></div>
          {cr && (!cr.member ? <div className="bg-white rounded-xl border border-[#ECEEF3] p-6 text-sm text-gray-500 text-center">No member with that email.</div> : (
            <div className="bg-white rounded-xl border border-[#ECEEF3] p-4 text-sm">
              <b className="text-[#1A1D2E]">{[cr.member.first_name, cr.member.last_name].filter(Boolean).join(' ')}</b> · {cr.member.company} · {cr.member.email}
              <p className="text-lg font-bold mt-2">Available print credit: ${Number(cr.balance || 0).toFixed(2)}</p>
              <div className="mt-2 space-y-1">{cr.credits.map((c: any) => (
                <div key={c.id} className="flex justify-between gap-2 flex-wrap border-t border-[#EEF0F4] pt-2"><span>${Number(c.amount).toFixed(2)} · used ${Number(c.used_amount).toFixed(2)} · expires {new Date(c.expires_at).toLocaleDateString()}{c.note ? ` · ${c.note}` : ''}</span><button onClick={() => useCredit(c)} className="text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-gray-600">Apply to an order</button></div>
              ))}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'templates' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {templates.map(t => (
            <div key={t.id} className={`bg-white rounded-xl border border-[#ECEEF3] overflow-hidden ${t.is_active ? '' : 'opacity-60'}`}>
              {t.thumb_url && <img src={t.thumb_url} alt={t.item} className="w-full aspect-[11/8.5] object-cover bg-[#F4F8F2]" loading="lazy" />}
              <div className="p-3 text-sm">
                <p className="text-[10px] uppercase text-[#1b8a3a] font-semibold">{t.category}</p>
                <b className="text-[#1A1D2E] block">{t.item}</b>
                <p className="text-gray-500 text-xs">{t.size} · flat {t.flat_size}</p>
                <p className={`text-[11px] mt-0.5 ${t.pro_pdf_path ? 'text-emerald-700' : 'text-amber-700'}`}>{t.pro_pdf_path ? 'Editable file uploaded' : 'No editable file yet'}</p>
                <div className="flex gap-1 mt-2">
                  <a href={`${SITE}/templates/${t.category_slug}/${t.slug}`} target="_blank" rel="noreferrer" className="text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-[#1b8a3a]">View</a>
                  <button onClick={() => editTpl(t)} className="text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-gray-600">Replace</button>
                  <button onClick={() => toggle(t)} className="text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-gray-600">{t.is_active ? 'Hide' : 'Show'}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'upload' && (
        <form onSubmit={upload} className="bg-white rounded-xl border border-[#ECEEF3] p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
          <p className="md:col-span-2 text-sm text-gray-500">Same fields as a row in template_index.csv. To replace a template, keep the category and item name the same and upload the new files. Leave a file empty to keep the current one.</p>
          <label className="text-xs text-gray-500">Category
            <select name="category" value={up.category} onChange={e => setUp({ ...up, category: e.target.value })} className={inp}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="text-xs text-gray-500">Item name<input name="item" required value={up.item || ''} onChange={e => setUp({ ...up, item: e.target.value })} placeholder="16 oz Paper Cup" className={inp} /></label>
          <label className="text-xs text-gray-500">Size<input name="size" value={up.size || ''} onChange={e => setUp({ ...up, size: e.target.value })} placeholder="10 x 7 x 12 in" className={inp} /></label>
          <label className="text-xs text-gray-500">Flat blank size<input name="flat_size" value={up.flat_size || ''} onChange={e => setUp({ ...up, flat_size: e.target.value })} placeholder="30.75 x 17.75 in" className={inp} /></label>
          {up.slug && <input type="hidden" name="slug" value={up.slug} />}
          <label className="text-xs text-gray-500">Free PDF (locked, branded)<input name="pdf" type="file" accept="application/pdf" className={inp} /></label>
          <label className="text-xs text-gray-500">Editable PDF (Pro, unlocked)<input name="pro_pdf" type="file" accept="application/pdf" className={inp} /></label>
          <label className="text-xs text-gray-500">Thumbnail (PNG or JPG)<input name="thumb" type="file" accept="image/png,image/jpeg,image/webp" className={inp} /></label>
          <div className="md:col-span-2 flex gap-2">
            <button disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-[#1b8a3a] text-white font-semibold disabled:opacity-50">{busy ? 'Uploading…' : up.slug ? 'Replace template' : 'Add template'}</button>
            {up.slug && <button type="button" onClick={() => setUp({ category: up.category })} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600">Start a new one instead</button>}
          </div>
        </form>
      )}
    </div>
  )
}
