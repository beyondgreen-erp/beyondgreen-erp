'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { DesignRow } from '@/lib/packaging/doc'
import type { EditorHandle } from './Editor'
import { logActivity } from '@/lib/packaging/activity'
import type { PkgComment } from './CommentsPanel'

interface LinkRow {
  id: string; design_id: string; token: string; printer_company: string | null; printer_contact: string | null; printer_email: string | null
  message: string | null; allow_download: boolean; allow_comments: boolean; expires_at: string | null; revoked_at: string | null
  created_by: string | null; created_at: string; last_viewed_at: string | null; view_count: number
}

export const PROOF_ORIGIN = (process.env.NEXT_PUBLIC_PROOF_ORIGIN || 'https://beyondgreen-proofs.vercel.app').replace(/\/$/, '')
export const proofUrl = (token: string) => `${PROOF_ORIGIN}/proof/${token}`

function newToken() {
  const b = new Uint8Array(24); crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...Array.from(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export default function ShareTab({ design, editor, user, onDesign, onOpenComment }: {
  design: DesignRow; editor: React.RefObject<EditorHandle>; user: { email: string; name: string }
  onDesign: (p: Partial<DesignRow>) => Promise<void>; onOpenComment: (id: string) => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [links, setLinks] = useState<LinkRow[]>([])
  const [comments, setComments] = useState<PkgComment[]>([])
  const [form, setForm] = useState({ printer_company: '', printer_contact: '', printer_email: '', message: '', allow_download: true, allow_comments: true, expires: '30' })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [{ data: l }, { data: c }] = await Promise.all([
      sb.from('packaging_share_links').select('*').eq('design_id', design.id).order('created_at', { ascending: false }),
      sb.from('packaging_comments').select('*').eq('design_id', design.id).eq('author_type', 'printer').order('created_at', { ascending: false }),
    ])
    setLinks((l || []) as LinkRow[]); setComments((c || []) as PkgComment[])
  }, [sb, design.id])
  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!form.printer_company.trim()) { setErr('Enter the printer / company name'); return }
    setBusy(true); setErr('')
    await editor.current?.saveNow() // printer always sees the latest working file
    const days = Number(form.expires)
    const { data, error } = await sb.from('packaging_share_links').insert({
      design_id: design.id, token: newToken(), printer_company: form.printer_company.trim(), printer_contact: form.printer_contact.trim() || null,
      printer_email: form.printer_email.trim() || null, message: form.message.trim() || null, allow_download: form.allow_download, allow_comments: form.allow_comments,
      expires_at: days ? new Date(Date.now() + days * 864e5).toISOString() : null, created_by: user.email,
    }).select().single()
    setBusy(false)
    if (error) { setErr(error.message); return }
    logActivity(sb, design.id, user, 'link_created', { printer: (data as any).printer_company, email: (data as any).printer_email }, (data as any).id)
    if (['Draft', 'In Review'].includes(design.status)) await onDesign({ status: 'Printer Review' })
    setForm({ ...form, printer_contact: '', printer_email: '', message: '' })
    await load()
    copy((data as any).token)
  }
  const copy = async (token: string) => { try { await navigator.clipboard.writeText(proofUrl(token)); setCopied(token); setTimeout(() => setCopied(null), 2000) } catch { prompt('Copy this link', proofUrl(token)) } }
  const revoke = async (l: LinkRow, on: boolean) => { await sb.from('packaging_share_links').update({ revoked_at: on ? new Date().toISOString() : null }).eq('id', l.id); logActivity(sb, design.id, user, on ? 'link_revoked' : 'link_created', { printer: l.printer_company }, l.id); load() }
  const patch = async (l: LinkRow, p: Partial<LinkRow>) => { await sb.from('packaging_share_links').update(p).eq('id', l.id); if ('expires_at' in p) logActivity(sb, design.id, user, 'link_extended', { printer: l.printer_company, expires_at: p.expires_at }, l.id); load() }
  const mailto = (l: LinkRow) => {
    const subject = `Proof for review: ${design.name}`
    const body = `Hi ${l.printer_contact || ''},\n\nPlease review the packaging proof for "${design.name}"${design.sku ? ` (${design.sku})` : ''}:\n${proofUrl(l.token)}\n\nYou can click any part of the artwork to leave a comment or question${l.allow_download ? ', and download the print files from the same page' : ''}.\n\n${l.message ? l.message + '\n\n' : ''}Thank you,\n${user.name}\nbeyondGREEN biotech`
    window.location.href = `mailto:${encodeURIComponent(l.printer_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  const state = (l: LinkRow) => l.revoked_at ? { t: 'Revoked', c: 'bg-gray-200 text-gray-600' } : l.expires_at && new Date(l.expires_at) < new Date() ? { t: 'Expired', c: 'bg-red-100 text-red-700' } : { t: 'Active', c: 'bg-emerald-100 text-emerald-700' }
  const threads = comments.filter(c => !c.parent_id)

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6FA]">
      <div className="max-w-5xl mx-auto p-6 grid lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Share with a printer</h2>
              <p className="text-sm text-gray-500">Creates a private link to a separate proof portal — outside the ERP. The printer sees the live working file, can click or drag on any part of the packaging to comment or ask a question, and can download the files. Nothing else in the ERP is reachable from it.</p>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-sm"><span className="text-gray-600">Printer / company *</span><input value={form.printer_company} onChange={e => setForm({ ...form, printer_company: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
              <label className="text-sm"><span className="text-gray-600">Contact name</span><input value={form.printer_contact} onChange={e => setForm({ ...form, printer_contact: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
              <label className="text-sm"><span className="text-gray-600">Contact email</span><input value={form.printer_email} onChange={e => setForm({ ...form, printer_email: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
            </div>
            <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={2} placeholder="Message shown at the top of the proof page (optional) — e.g. Please confirm bleed and dieline tolerances." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.allow_comments} onChange={e => setForm({ ...form, allow_comments: e.target.checked })} /> Allow comments</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.allow_download} onChange={e => setForm({ ...form, allow_download: e.target.checked })} /> Allow downloads</label>
              <label className="flex items-center gap-2">Expires
                <select value={form.expires} onChange={e => setForm({ ...form, expires: e.target.value })} className="border border-gray-300 rounded px-2 py-1">
                  <option value="7">in 7 days</option><option value="30">in 30 days</option><option value="90">in 90 days</option><option value="0">never</option>
                </select>
              </label>
              <button disabled={busy} onClick={create} className="ml-auto px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-60" style={{ background: '#3B6FE0' }}>
                {busy ? 'Creating…' : <><i className="ti ti-link-plus" /> Create external link</>}
              </button>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-gray-900">External links</h3>
            {!links.length && <p className="text-sm text-gray-500 bg-white rounded-xl border border-dashed border-gray-300 p-4">No links yet. This design is only visible inside the ERP.</p>}
            {links.map(l => {
              const s = state(l)
              const n = threads.filter(c => c.share_link_id === l.id).length
              return (
                <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{l.printer_company}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${s.c}`}>{s.t}</span>
                    <span className="text-xs text-gray-500">{[l.printer_contact, l.printer_email].filter(Boolean).join(' · ')}</span>
                    <span className="ml-auto text-[11px] text-gray-400">{l.view_count} view{l.view_count === 1 ? '' : 's'}{l.last_viewed_at ? ` · last ${new Date(l.last_viewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''} · {n} comment{n === 1 ? '' : 's'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-gray-700">{proofUrl(l.token)}</code>
                    <button onClick={() => copy(l.token)} className="text-xs px-2.5 py-1.5 rounded border border-gray-300 hover:bg-gray-50 whitespace-nowrap">{copied === l.token ? '✓ Copied' : <><i className="ti ti-copy" /> Copy</>}</button>
                    <a href={proofUrl(l.token)} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1.5 rounded border border-gray-300 hover:bg-gray-50"><i className="ti ti-external-link" /></a>
                    <button onClick={() => mailto(l)} className="text-xs px-2.5 py-1.5 rounded border border-gray-300 hover:bg-gray-50" title="Email the link"><i className="ti ti-mail" /></button>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={l.allow_comments} onChange={e => patch(l, { allow_comments: e.target.checked })} /> Comments</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={l.allow_download} onChange={e => patch(l, { allow_download: e.target.checked })} /> Downloads</label>
                    <span>{l.expires_at ? `Expires ${new Date(l.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Never expires'}</span>
                    <button onClick={() => patch(l, { expires_at: new Date(Date.now() + 30 * 864e5).toISOString() } as any)} className="text-[#3B6FE0] hover:underline">Extend 30 days</button>
                    <button onClick={() => revoke(l, !l.revoked_at)} className={`ml-auto ${l.revoked_at ? 'text-emerald-700' : 'text-red-600'} hover:underline`}>{l.revoked_at ? 'Re-activate link' : 'Revoke link'}</button>
                  </div>
                </div>
              )
            })}
          </section>
        </div>

        <aside className="space-y-3">
          <h3 className="text-sm font-bold text-gray-900">Printer feedback</h3>
          {!threads.length && <p className="text-sm text-gray-500 bg-white rounded-xl border border-dashed border-gray-300 p-4">Printer comments will appear here and as purple pins on the artwork.</p>}
          {threads.map(c => (
            <button key={c.id} onClick={() => onOpenComment(c.id)} className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 hover:border-gray-400">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full rounded-bl-none bg-violet-500 text-white text-[10px] font-bold grid place-items-center">{c.pin_no}</span>
                <span className="font-semibold text-gray-800">{c.author_name || 'Printer'}</span>
                <span className={`ml-auto px-1.5 rounded ${c.status === 'open' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
              </div>
              <p className="text-sm text-gray-700 mt-1 line-clamp-3">{c.body}</p>
              <p className="text-[11px] text-gray-400 mt-1">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · open on artwork →</p>
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}
