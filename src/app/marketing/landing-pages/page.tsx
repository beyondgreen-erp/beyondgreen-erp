'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface LP {
  id: string; slug: string; category: string; title: string; headline: string; subhead: string | null
  hero_image_url: string | null; benefits: { title: string; desc: string }[]
  cta_label: string; cta_url: string; is_published: boolean
  body_html: string | null; created_at: string; updated_at: string
}
interface View { slug: string; recipient_id: string | null; utm_campaign: string | null; referrer: string | null; viewed_at: string; session_id: string | null }

const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/30'

export default function LandingPagesAdminPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [pages, setPages] = useState<LP[]>([])
  const [viewCounts, setViewCounts] = useState<Record<string, { total: number; last7: number; unique: number }>>({})
  const [recentViews, setRecentViews] = useState<View[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<LP | null>(null)
  const [form, setForm] = useState<any>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: v }] = await Promise.all([
      sb.from('landing_pages').select('*').order('created_at', { ascending: false }),
      sb.from('landing_page_views').select('slug,recipient_id,utm_campaign,referrer,viewed_at,session_id').order('viewed_at', { ascending: false }).limit(500),
    ])
    setPages((p as LP[]) || [])
    const now = Date.now(); const cut = now - 7 * 86400 * 1000
    const agg: Record<string, { total: number; last7: number; sessions: Set<string> }> = {}
    ;((v as View[]) || []).forEach(x => {
      const a = (agg[x.slug] ||= { total: 0, last7: 0, sessions: new Set() })
      a.total++
      if (new Date(x.viewed_at).getTime() >= cut) a.last7++
      if (x.session_id) a.sessions.add(x.session_id)
    })
    const c: Record<string, { total: number; last7: number; unique: number }> = {}
    Object.entries(agg).forEach(([k, a]) => { c[k] = { total: a.total, last7: a.last7, unique: a.sessions.size } })
    setViewCounts(c)
    setRecentViews(((v as View[]) || []).slice(0, 25))
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null)
    setForm({ slug: '', category: 'general', title: '', headline: '', subhead: '', hero_image_url: '', cta_label: 'Visit our full website', cta_url: '', is_published: true, benefits: [{ title: '', desc: '' }] })
  }
  function openEdit(p: LP) {
    setEditing(p)
    setForm({ ...p, benefits: p.benefits && p.benefits.length ? p.benefits : [{ title: '', desc: '' }] })
  }
  function close() { setEditing(null); setForm({}) }

  async function save() {
    if (!form.slug || !form.title || !form.headline || !form.cta_url) { alert('Slug, title, headline, and CTA URL are required.'); return }
    setBusy(true)
    const payload = {
      slug: form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      category: form.category || 'general',
      title: form.title, headline: form.headline, subhead: form.subhead || null,
      hero_image_url: form.hero_image_url || null,
      benefits: (form.benefits || []).filter((b: any) => b.title || b.desc),
      cta_label: form.cta_label || 'Visit our full website',
      cta_url: form.cta_url,
      is_published: !!form.is_published,
      body_html: form.body_html || null,
      updated_at: new Date().toISOString(),
    }
    if (editing) {
      await sb.from('landing_pages').update(payload).eq('id', editing.id)
    } else {
      await sb.from('landing_pages').insert(payload)
    }
    setBusy(false); close(); load()
  }
  async function del(p: LP) {
    if (!confirm(`Delete landing page "${p.title}"? This will also delete its view history.`)) return
    await sb.from('landing_page_views').delete().eq('slug', p.slug)
    await sb.from('landing_pages').delete().eq('id', p.id)
    load()
  }

  const publicUrl = (slug: string, r?: string, campaign?: string) => {
    const base = typeof window !== 'undefined' ? `${window.location.origin}/lp/${slug}` : `/lp/${slug}`
    const qs = new URLSearchParams()
    if (r) qs.set('r', r)
    if (campaign) { qs.set('utm_source', 'email'); qs.set('utm_medium', 'sequence'); qs.set('utm_campaign', campaign) }
    return qs.toString() ? `${base}?${qs}` : base
  }

  return (
    <div className="min-h-screen mon-page p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <span className="mon-tag t-purple">📢 Marketing · Landing Pages</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Public landing pages</h1>
          <p className="text-gray-500 text-sm mt-0.5">Sits outside the ERP auth. Link from sequence emails and track how many recipients click through.</p>
        </div>
        <button onClick={openNew} className="text-sm px-4 py-2 rounded-lg bg-[#3B6FE0] text-white hover:bg-[#2E5CC7] font-semibold">+ New Landing Page</button>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-3">
          {pages.length === 0 && <div className="bg-white rounded-xl border border-[#ECEEF3] p-8 text-center text-sm text-gray-500">No landing pages yet.</div>}
          {pages.map(p => {
            const c = viewCounts[p.slug] || { total: 0, last7: 0, unique: 0 }
            return (
              <div key={p.id} className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EEF0F4] bg-[#F8FAFF]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[#1A1D2E] truncate">{p.title}</p>
                      <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${p.is_published ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{p.is_published ? 'Published' : 'Draft'}</span>
                      <span className="text-[10px] rounded-full px-2 py-0.5 bg-purple-100 text-purple-700 font-semibold uppercase">{p.category}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">/lp/{p.slug} · Links out to <span className="text-[#3B6FE0]">{p.cta_url}</span></p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-center"><p className="text-lg font-bold text-[#0F1C2E]">{c.total}</p><p className="text-[10px] uppercase text-gray-400">Total views</p></div>
                    <div className="text-center"><p className="text-lg font-bold text-emerald-600">{c.last7}</p><p className="text-[10px] uppercase text-gray-400">Last 7d</p></div>
                    <div className="text-center"><p className="text-lg font-bold text-indigo-600">{c.unique}</p><p className="text-[10px] uppercase text-gray-400">Unique</p></div>
                  </div>
                  <div className="flex items-center gap-1">
                    <a href={publicUrl(p.slug)} target="_blank" rel="noreferrer" className="text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-[#3B6FE0] hover:bg-[#F2F6FF]">Open</a>
                    <button onClick={() => openEdit(p)} className="text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Edit</button>
                    <button onClick={() => del(p)} className="text-[11px] px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">Delete</button>
                  </div>
                </div>
                <div className="px-4 py-3 border-b border-[#EEF0F4] text-xs">
                  <p className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Copy this URL into a sequence step body (adds tracking):</p>
                  <code className="block bg-[#F5F7FA] border border-[#EEF0F4] rounded px-2 py-1.5 text-[11px] break-all">{publicUrl(p.slug) + '?r={{customer_id}}&utm_source=email&utm_medium=sequence&utm_campaign=' + p.slug}</code>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recent visits */}
      {recentViews.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-[#ECEEF3] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#EEF0F4] bg-[#F8FAFF]"><p className="text-xs font-bold text-[#1A1D2E]">Recent visits (last 25)</p></div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Page</th>
                <th className="text-left px-3 py-2">Recipient</th>
                <th className="text-left px-3 py-2">Campaign</th>
                <th className="text-left px-3 py-2">Referrer</th>
              </tr>
            </thead>
            <tbody>
              {recentViews.map((v, i) => (
                <tr key={i} className="border-b border-[#EEF0F4] last:border-0">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(v.viewed_at).toLocaleString()}</td>
                  <td className="px-3 py-2 font-semibold text-[#3B6FE0]">{v.slug}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono truncate max-w-[220px]">{v.recipient_id || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{v.utm_campaign || '—'}</td>
                  <td className="px-3 py-2 text-gray-500 truncate max-w-[240px]">{v.referrer || 'direct'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit/new sidebar */}
      {(editing !== null || Object.keys(form).length > 0) && form.slug !== undefined && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={close}>
          <div className="w-[720px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#EEF0F4] px-5 py-3 flex items-center justify-between z-10">
              <h2 className="font-bold text-[#1A1D2E]">{editing ? 'Edit landing page' : 'New landing page'}</h2>
              <div className="flex gap-2">
                <button onClick={close} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
                <button onClick={save} disabled={busy} className="text-sm px-4 py-1.5 rounded-lg bg-[#3B6FE0] text-white">{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs text-gray-500 mb-1">Slug (URL path)</label><input value={form.slug || ''} onChange={e => setForm((f: any) => ({ ...f, slug: e.target.value }))} placeholder="gov-pet-waste-bags" className={inp} /></div>
                <div><label className="block text-xs text-gray-500 mb-1">Category / industry tag</label><input value={form.category || ''} onChange={e => setForm((f: any) => ({ ...f, category: e.target.value }))} placeholder="government, hospitality, retail…" className={inp} /></div>
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Page title (browser tab)</label><input value={form.title || ''} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} className={inp} /></div>
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Big headline</label><input value={form.headline || ''} onChange={e => setForm((f: any) => ({ ...f, headline: e.target.value }))} className={inp} /></div>
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Subhead / one-liner</label><input value={form.subhead || ''} onChange={e => setForm((f: any) => ({ ...f, subhead: e.target.value }))} className={inp} /></div>
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Hero image URL (optional)</label><input value={form.hero_image_url || ''} onChange={e => setForm((f: any) => ({ ...f, hero_image_url: e.target.value }))} placeholder="https://byndgrn.com/cdn/shop/files/…" className={inp} /></div>
                <div><label className="block text-xs text-gray-500 mb-1">CTA button label</label><input value={form.cta_label || ''} onChange={e => setForm((f: any) => ({ ...f, cta_label: e.target.value }))} className={inp} /></div>
                <div><label className="block text-xs text-gray-500 mb-1">CTA URL (external website)</label><input value={form.cta_url || ''} onChange={e => setForm((f: any) => ({ ...f, cta_url: e.target.value }))} className={inp} /></div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Benefit tiles</label>
                <div className="space-y-2">
                  {(form.benefits || []).map((b: any, i: number) => (
                    <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
                      <input value={b.title} onChange={e => setForm((f: any) => ({ ...f, benefits: f.benefits.map((x: any, j: number) => j === i ? { ...x, title: e.target.value } : x) }))} placeholder="Title" className={inp} />
                      <input value={b.desc} onChange={e => setForm((f: any) => ({ ...f, benefits: f.benefits.map((x: any, j: number) => j === i ? { ...x, desc: e.target.value } : x) }))} placeholder="One-line description" className={inp} />
                      <button onClick={() => setForm((f: any) => ({ ...f, benefits: f.benefits.filter((_: any, j: number) => j !== i) }))} className="text-red-400 hover:text-red-600 text-sm px-2">×</button>
                    </div>
                  ))}
                  <button onClick={() => setForm((f: any) => ({ ...f, benefits: [...(f.benefits || []), { title: '', desc: '' }] }))} className="text-xs text-[#3B6FE0] font-semibold">+ Add benefit</button>
                </div>
              </div>

              <div><label className="block text-xs text-gray-500 mb-1">Extra body HTML (optional)</label><textarea rows={6} value={form.body_html || ''} onChange={e => setForm((f: any) => ({ ...f, body_html: e.target.value }))} className={inp + ' font-mono text-xs resize-y'} /></div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.is_published} onChange={e => setForm((f: any) => ({ ...f, is_published: e.target.checked }))} className="accent-[#3B6FE0]" />
                Published (visitors can reach it)
              </label>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 text-xs text-gray-400">
        <Link href="/sales/sequences" className="text-[#3B6FE0] hover:underline">← Back to Sequences</Link>
      </div>
    </div>
  )
}
