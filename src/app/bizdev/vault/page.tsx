'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { accentColor } from '@/lib/statusColors'
import Comments from '@/components/Comments'

interface VaultItem {
  id: string
  group_name: string | null
  name: string | null
  people_with_access: string | null
  username: string | null
  password: string | null
  website_link: string | null
  pin: string | null
  account_number: string | null
  security_question: string | null
  board_position: number | null
  created_at: string | null
}

const EMPTY: Partial<VaultItem> = { group_name: '', name: '', people_with_access: '', username: '', password: '', website_link: '', pin: '', account_number: '', security_question: '' }

export default function VaultPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [unlocked, setUnlocked] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [checking, setChecking] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const pwRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<VaultItem[]>([])

  // Deep-link: open the item referenced by ?item=<id> in the URL (used by @mention notifications).
  const deepLinkOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const openId = new URLSearchParams(window.location.search).get('item')
    if (!openId || deepLinkOpenedRef.current === openId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (rows as any[]).find((x) => x && x.id === openId)
    if (target) { deepLinkOpenedRef.current = openId; openEdit(target) }
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<VaultItem | null>(null)
  const [form, setForm] = useState<Partial<VaultItem>>(EMPTY)
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('vault_ok') === '1') setUnlocked(true)
    sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || ''))
  }, []) // eslint-disable-line

  async function tryUnlock(e: React.FormEvent) {
    e.preventDefault()
    const candidate = (pwRef.current?.value ?? pw).trim()
    if (!candidate) { setPwErr('Enter the Vault password.'); return }
    setChecking(true); setPwErr('')
    const { data, error } = await sb.rpc('verify_vault_password', { pw: candidate })
    setChecking(false)
    if (!error && data === true) { setUnlocked(true); sessionStorage.setItem('vault_ok', '1'); setPw(''); if (pwRef.current) pwRef.current.value = '' }
    else setPwErr('Incorrect password.')
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('vault_items').select('*').order('group_name', { ascending: true }).order('name', { ascending: true })
    setRows((data as VaultItem[]) || [])
    setLoading(false)
  }, [sb])
  useEffect(() => { if (unlocked) load() }, [unlocked, load])

  const groupsList = useMemo(() => Array.from(new Set(rows.map(r => r.group_name || 'Others'))).sort(), [rows])

  const matches = (r: VaultItem) => {
    const q = search.toLowerCase().trim(); if (!q) return true
    return [r.name, r.username, r.website_link, r.account_number, r.people_with_access, r.group_name].some(v => (v || '').toLowerCase().includes(q))
  }
  const grouped = useMemo(() => {
    const m: Record<string, VaultItem[]> = {}
    rows.filter(matches).forEach(r => { const g = r.group_name || 'Others'; (m[g] ||= []).push(r) })
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length)
  }, [rows, search]) // eslint-disable-line

  function openEdit(it: VaultItem) { setEditing(it); setForm({ ...it }); setShowPw(false); setOpen(true) }
  function openAdd() { setEditing(null); setForm({ ...EMPTY }); setShowPw(false); setOpen(true) }
  function close() { setOpen(false); setTimeout(() => { setEditing(null); setForm(EMPTY) }, 150) }

  async function save() {
    setSaving(true)
    const payload: any = {
      group_name: form.group_name || 'Others', name: form.name || null, people_with_access: form.people_with_access || null,
      username: form.username || null, password: form.password || null, website_link: form.website_link || null,
      pin: form.pin || null, account_number: form.account_number || null, security_question: form.security_question || null,
      updated_at: new Date().toISOString(),
    }
    if (editing?.id) await sb.from('vault_items').update(payload).eq('id', editing.id)
    else { const { data } = await sb.from('vault_items').insert({ ...payload, created_by: userEmail }).select('*').single(); if (data) setEditing(data as VaultItem) }
    setSaving(false); await load()
    if (!editing?.id) close()
  }
  async function del() {
    if (!editing?.id) return
    if (!confirm(`Delete "${editing.name || 'this entry'}" from the Vault? This cannot be undone.`)) return
    await sb.from('vault_items').delete().eq('id', editing.id)
    await load(); close()
  }
  function copy(v: string | null | undefined) { if (v) navigator.clipboard?.writeText(v).catch(() => {}) }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#A25DDC]/40'

  // ── Password gate ──────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="min-h-screen mon-page flex items-center justify-center p-6">
        <form onSubmit={tryUnlock} className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#ECEEF3] overflow-hidden">
          <div className="mon-modal-head h-purple"><div><h2 className="text-lg">🔒 The Vault</h2><p className="text-white/80 text-xs mt-0.5">Leadership only · password protected</p></div></div>
          <div className="p-6 space-y-3">
            <p className="text-xs text-gray-500">Enter the Vault password to view secure credentials.</p>
            <input ref={pwRef} type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} onInput={e => setPw((e.target as HTMLInputElement).value)} placeholder="Password" className={inp} />
            {pwErr && <p className="text-xs text-red-600">{pwErr}</p>}
            <button type="submit" disabled={checking} className="mon-btn w-full justify-center !py-2.5" style={{ background: '#A25DDC', borderColor: '#6C2FA0' }}>{checking ? 'Checking…' : 'Unlock Vault'}</button>
          </div>
        </form>
      </div>
    )
  }

  // ── Vault board ────────────────────────────────────────────────
  return (
    <div className="min-h-screen mon-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-purple">🔒 Vault</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">The Vault</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} secure entries`} · Leadership only</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { sessionStorage.removeItem('vault_ok'); setUnlocked(false) }} className="text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E]">Lock</button>
          <button onClick={openAdd} className="mon-btn" style={{ background: '#A25DDC', borderColor: '#6C2FA0' }}>+ New Entry</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <input placeholder="Search name, username, website, account…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#A25DDC]/40" />
        </div>
        <span className="text-xs text-gray-400 ml-auto">{grouped.reduce((s, [, v]) => s + v.length, 0)} shown</span>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : grouped.length === 0 ? <p className="text-center text-gray-400 py-16 text-sm">No entries match.</p> : (
        <div className="space-y-2.5 mb-8">
          <div className="mb-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — notes &amp; comments sync two-way across the record boards.</div>{grouped.map(([grp, items]) => {
            const c = accentColor(grp); const isColl = collapsed[grp]
            return (
              <div key={grp} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + c.solid }} onClick={() => setCollapsed(s => ({ ...s, [grp]: !s[grp] }))}>
                  <span className="text-[10px]" style={{ color: c.solid, transform: isColl ? 'none' : 'rotate(90deg)', display: 'inline-block' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: c.solid }}>{grp}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: c.solid + '26', color: c.solid }}>{items.length}</span>
                </div>
                {!isColl && (
                  <div className="divide-y divide-[#F4F5F8]">
                    {items.map(it => (
                      <div key={it.id} onClick={() => openEdit(it)} className="flex items-center gap-3 px-4 py-2.5 mon-row">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1A1D2E] truncate">{it.name || '(untitled)'}</p>
                          <p className="text-xs text-gray-500 truncate">{it.username ? '👤 ' + it.username : ''}{it.username && it.website_link ? ' · ' : ''}{it.website_link ? '🔗 ' + it.website_link.replace(/^https?:\/\//, '') : ''}</p>
                        </div>
                        {it.people_with_access && <span className="text-[11px] text-gray-400 hidden md:block truncate max-w-[180px]">{it.people_with_access}</span>}
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200">••••••</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Edit / Add pop-up ── */}
      {open && (
        <div className="mon-backdrop" onClick={close}>
          <div className="mon-modal mon-pop" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="mon-modal-head h-purple">
              <div className="min-w-0">
                <h2 className="text-lg truncate">{editing ? (form.name || 'Entry') : 'New Vault Entry'}</h2>
                <p className="text-white/80 text-xs mt-0.5">{form.group_name || 'Others'}</p>
              </div>
              <button onClick={close} className="mon-modal-close" aria-label="Close">×</button>
            </div>
            <div className="mon-modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Name</label>
                  <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Group</label>
                  <input list="vault-groups" value={form.group_name || ''} onChange={e => setForm(f => ({ ...f, group_name: e.target.value }))} className={inp} />
                  <datalist id="vault-groups">{groupsList.map(g => <option key={g} value={g} />)}</datalist>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">People With Access</label>
                  <input value={form.people_with_access || ''} onChange={e => setForm(f => ({ ...f, people_with_access: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Username</label>
                  <div className="flex gap-1">
                    <input value={form.username || ''} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className={inp} />
                    <button type="button" onClick={() => copy(form.username)} className="shrink-0 px-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-[#1A1D2E]" title="Copy">⧉</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Password</label>
                  <div className="flex gap-1">
                    <input type={showPw ? 'text' : 'password'} value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={inp} />
                    <button type="button" onClick={() => setShowPw(s => !s)} className="shrink-0 px-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-[#1A1D2E]" title={showPw ? 'Hide' : 'Show'}>{showPw ? '🙈' : '👁'}</button>
                    <button type="button" onClick={() => copy(form.password)} className="shrink-0 px-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-[#1A1D2E]" title="Copy">⧉</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Website Link</label>
                  <input value={form.website_link || ''} onChange={e => setForm(f => ({ ...f, website_link: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">PIN</label>
                  <input value={form.pin || ''} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Account #</label>
                  <input value={form.account_number || ''} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} className={inp} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Security Question</label>
                  <textarea rows={2} value={form.security_question || ''} onChange={e => setForm(f => ({ ...f, security_question: e.target.value }))} className={inp + ' resize-none'} />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                {editing && <button onClick={del} className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100">Delete</button>}
                <button onClick={close} className="ml-auto text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E]">Cancel</button>
                <button onClick={save} disabled={saving} className="mon-btn !py-2" style={{ background: '#A25DDC', borderColor: '#6C2FA0' }}>{saving ? 'Saving…' : (editing ? 'Save' : 'Create Entry')}</button>
              </div>

              {editing?.id && (
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <Comments recordType="vault_item" recordId={editing.id} currentUserEmail={userEmail} title="Comments & Activity" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
