'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useBoards, groupBoards } from '@/lib/boards'

interface Profile {
  id: string
  user_id: string
  email: string
  full_name: string
  display_name: string | null
  role: string
  department: string | null
  phone: string | null
  job_title: string | null
  avatar_color: string
  avatar_initials: string | null
  is_admin: boolean
  is_active: boolean
}

interface Presence {
  email: string
  last_seen: string
  activity_count: number
}

const ROLES = ['Admin', 'Manager', 'Member', 'Viewer', 'Production']
const DEPARTMENTS = ['Management', 'Sustainability', 'Marketing', 'Sales', 'R&D', 'Finance', 'Warehouse', 'Other']

const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Manager: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Member: 'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]',
  Viewer: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
}

function fmtDate(d: string) {
  const date = new Date(d)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function UsersPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [profiles, setProfiles] = useState<Profile[]>([])
  useItemDeepLink(profiles, openEdit)
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', phone: '', job_title: '', role: '', department: '' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [meId, setMeId] = useState<string | null>(null)
  const [del, setDel] = useState<Profile | null>(null)
  const [delText, setDelText] = useState('')
  const [delBusy, setDelBusy] = useState(false)
  const [pw, setPw] = useState('')
  const [pwShow, setPwShow] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  // Invite teammate
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ full_name: '', email: '', role: 'Member', department: '' })
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteErr, setInviteErr] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null)) }, [sb])

  const iAmAdmin = useMemo(() => profiles.some(p => p.user_id === meId && p.is_admin), [profiles, meId])

  async function setPassword() {
    if (!editing || pw.length < 8) return
    setPwBusy(true)
    try {
      const res = await fetch('/api/users/set-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, password: pw, requesterId: meId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed to set password')
      setNotice({ ok: true, msg: `Password updated for ${editing.email}.` })
      setPw(''); setPwShow(false)
    } catch (e) {
      setNotice({ ok: false, msg: (e as Error).message })
    }
    setPwBusy(false)
  }

  async function sendInvite() {
    setInviteErr('')
    const name = inviteForm.full_name.trim()
    const email = inviteForm.email.trim().toLowerCase()
    if (!name || !email) { setInviteErr('Full name and email are required.'); return }
    setInviteBusy(true)
    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inviteForm, full_name: name, email, requesterId: meId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Invite failed')
      setNotice({ ok: true, msg: `Invite sent to ${email}. They'll set their own password from the email link.` })
      setInviteOpen(false); setInviteForm({ full_name: '', email: '', role: 'Member', department: '' })
      load()
    } catch (e) {
      setInviteErr((e as Error).message)
    }
    setInviteBusy(false)
  }

  async function confirmDelete() {
    if (!del) return
    setDelBusy(true)
    try {
      const res = await fetch('/api/users/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: del.id, requesterId: meId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Delete failed')
      setNotice({ ok: true, msg: `Deleted ${del.email}.` })
      setDel(null); setDelText(''); load()
    } catch (e) {
      setNotice({ ok: false, msg: (e as Error).message })
    }
    setDelBusy(false)
  }

  async function load() {
    const [{ data: pData }, { data: presData }] = await Promise.all([
      sb.from('user_profiles').select('*').order('full_name'),
      sb.from('user_presence').select('email,last_seen,activity_count').order('last_seen', { ascending: false }),
    ])
    if (pData) setProfiles(pData as Profile[])
    if (presData) {
      const map: Record<string, Presence> = {}
      for (const p of presData as Presence[]) map[p.email] = p
      setPresence(map)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  function openEdit(p: Profile) {
    setEditing(p)
    const parts = p.full_name.trim().split(' ')
    setEditForm({
      first_name: parts[0] ?? '',
      last_name: parts.slice(1).join(' '),
      phone: p.phone ?? '',
      job_title: p.job_title ?? '',
      role: p.role,
      department: p.department ?? '',
    })
    setPw(''); setPwShow(false)
    setNotice(null)
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    const full_name = [editForm.first_name, editForm.last_name].filter(Boolean).join(' ').trim() || editing.full_name
    const initials = full_name.trim().split(' ').filter(Boolean).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    const { error } = await sb.from('user_profiles').update({
      full_name,
      phone: editForm.phone || null,
      job_title: editForm.job_title || null,
      role: editForm.role,
      department: editForm.department || null,
      avatar_initials: initials,
      is_admin: editForm.role === 'Admin',
      updated_at: new Date().toISOString(),
    }).eq('id', editing.id)
    if (error) {
      setNotice({ ok: false, msg: error.message })
    } else {
      setNotice({ ok: true, msg: 'User updated.' })
      setEditing(null)
      load()
    }
    setSaving(false)
  }

  async function toggleActive(p: Profile) {
    await sb.from('user_profiles').update({ is_active: !p.is_active, updated_at: new Date().toISOString() }).eq('id', p.id)
    load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="mb-8 flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">SETTINGS</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">User Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">{profiles.length} registered user{profiles.length !== 1 ? 's' : ''}</p>
        </div>
        {iAmAdmin && (
          <button onClick={() => { setInviteErr(''); setInviteOpen(true) }}
            className="shrink-0 inline-flex items-center gap-1.5 bg-[#00863F] hover:bg-[#0b7a3d] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
            + Invite teammate
          </button>
        )}
      </div>

      {notice && (
        <div className={`mb-4 text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {notice.msg}
        </div>
      )}

      {iAmAdmin && <WorkNetworkCard />}

      <div className="bg-white border border-[#E4E6EE] rounded-xl overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : (
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-[#E4E6EE]">
                {['User', 'Role', 'Department', 'Status', 'Last Seen', 'Activity', ''].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p, i) => {
                const pres = presence[p.email]
                const roleColor = ROLE_COLORS[p.role] ?? ROLE_COLORS.Member
                return (
                  <tr key={p.id} className={`border-b border-[#E4E6EE]/60 last:border-0 ${i % 2 === 0 ? '' : 'bg-[#F5F6FA]/10'}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[#1A1D2E] text-xs font-bold shrink-0"
                          style={{ backgroundColor: p.avatar_color }}
                        >
                          {p.avatar_initials ?? p.full_name[0]}
                        </div>
                        <div>
                          <p className="text-[#1A1D2E] font-medium text-sm">{p.full_name}</p>
                          <p className="text-gray-500 text-xs">{p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${roleColor}`}>{p.role}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-sm">{p.department ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_active ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 bg-[#F5F6FA]/30'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{pres ? fmtDate(pres.last_seen) : '—'}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{pres ? `${pres.activity_count} actions` : '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-xs text-gray-400 hover:text-gray-700 border border-[#E4E6EE] hover:border-gray-500 px-2.5 py-1 rounded-lg transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(p)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${p.is_active ? 'text-amber-500 border-amber-500/30 hover:bg-amber-500/10' : 'text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10'}`}
                        >
                          {p.is_active ? 'Deactivate' : 'Restore'}
                        </button>
                        <button
                          onClick={() => { setDel(p); setDelText(''); setNotice(null) }}
                          disabled={!!meId && p.user_id === meId}
                          title={!!meId && p.user_id === meId ? "You can't delete your own account" : 'Delete user'}
                          className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E4E6EE] rounded-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#E4E6EE] shrink-0">
              <h2 className="text-[#1A1D2E] font-semibold">Edit User</h2>
              {editing && <ShareLink id={editing.id} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-2.5 py-1.5 rounded-lg transition-colors shrink-0" />}
              <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-[#1A1D2E] font-bold" style={{ backgroundColor: editing.avatar_color }}>
                {editing.avatar_initials ?? editing.full_name[0]}
              </div>
              <div>
                <p className="text-[#1A1D2E] font-medium">{editing.full_name}</p>
                <p className="text-gray-500 text-xs">{editing.email}</p>
              </div>
            </div>
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">First Name</label>
                <input value={editForm.first_name} onChange={e => setEditForm(p => ({ ...p, first_name: e.target.value }))} className={inp} placeholder="First"/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Last Name</label>
                <input value={editForm.last_name} onChange={e => setEditForm(p => ({ ...p, last_name: e.target.value }))} className={inp} placeholder="Last"/>
              </div>
            </div>
            {/* Email (readonly) */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Email</label>
              <input value={editing.email} readOnly className={inp + ' opacity-60 cursor-not-allowed bg-[#F5F6FA]'}/>
            </div>
            {/* Phone + Job Title */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Phone</label>
                <input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="+1 (555) 000-0000"/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Job Title</label>
                <input value={editForm.job_title} onChange={e => setEditForm(p => ({ ...p, job_title: e.target.value }))} className={inp} placeholder="e.g. Sales Manager"/>
              </div>
            </div>
            {/* Role + Department */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Role</label>
                {editForm.role === 'Production' && <p className="text-[11px] mb-1.5 text-amber-500">Scan-only access: this user can only reach Production Scan + scan history. No other ERP access.</p>}
                <select value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))} className={inp + ' cursor-pointer'}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Department</label>
                <select value={editForm.department} onChange={e => setEditForm(p => ({ ...p, department: e.target.value }))} className={inp + ' cursor-pointer'}>
                  <option value="">— None —</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            {iAmAdmin && <OffsiteAccess email={editing.email} />}
            {/* Board access (admins only; Admin/Owner users see everything so nothing to set) */}
            {iAmAdmin && !['Admin','Owner'].includes(editForm.role) && (
              <div className="pt-3 border-t border-[#E4E6EE]">
                <BoardAccess email={editing.email} />
              </div>
            )}
            {iAmAdmin && ['Admin','Owner'].includes(editForm.role) && (
              <div className="pt-3 border-t border-[#E4E6EE]">
                <p className="text-xs text-gray-500"><span className="font-semibold text-[#1A1D2E]">{editForm.role}s see and edit every board.</span> Switch the role to Member to set board-by-board access.</p>
              </div>
            )}
            {/* Reset password (admins only) */}
            {iAmAdmin && (
              <div className="pt-3 border-t border-[#E4E6EE]">
                <label className="block text-xs text-gray-400 mb-1.5">Reset Password <span className="text-gray-400/70">— set a new password for this user</span></label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={pwShow ? 'text' : 'password'}
                      value={pw}
                      onChange={e => setPw(e.target.value)}
                      placeholder="New password (min 8 characters)"
                      autoComplete="new-password"
                      className={inp + ' pr-16'}
                    />
                    <button type="button" onClick={() => setPwShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                      {pwShow ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <button
                    onClick={setPassword}
                    disabled={pwBusy || pw.length < 8}
                    className="text-sm px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium whitespace-nowrap transition-colors"
                  >
                    {pwBusy ? 'Setting…' : 'Set password'}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">The user can sign in with this new password immediately. Share it with them securely.</p>
              </div>
            )}
            {notice && (
              <div className={`text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                {notice.msg}
              </div>
            )}
        </div>
            <div className="flex gap-3 px-6 py-4 border-t border-[#E4E6EE] shrink-0 bg-white">
              <button onClick={() => setEditing(null)} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {del && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" >
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <div>
                <h2 className="text-[#1A1D2E] font-semibold">Delete user</h2>
                <p className="text-gray-500 text-xs">This can’t be undone.</p>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              This permanently removes <strong className="text-[#1A1D2E]">{del.full_name}</strong> (<span className="font-mono">{del.email}</span>) — their login and profile will be deleted. Historical records they created are not affected.
            </p>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Type <span className="font-mono text-[#1A1D2E]">{del.email}</span> to confirm</label>
              <input autoFocus value={delText} onChange={e => setDelText(e.target.value)} className={inp} placeholder={del.email} />
            </div>
            {notice && !notice.ok && (
              <div className="text-xs px-3 py-2.5 rounded-lg border bg-red-500/10 text-red-500 border-red-500/20">{notice.msg}</div>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setDel(null)} disabled={delBusy} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={delBusy || delText.trim().toLowerCase() !== del.email.toLowerCase()}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
              >
                {delBusy ? 'Deleting…' : 'Delete user'}
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 sm:p-6" onClick={() => !inviteBusy && setInviteOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-[440px] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E6EE]">
              <h2 className="text-base font-semibold text-[#1A1D2E]">Invite teammate</h2>
              <button onClick={() => !inviteBusy && setInviteOpen(false)} className="text-gray-400 hover:text-gray-700"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500">They&apos;ll get an email invite and set their own password. Email must be @beyondgreenbiotech.com or @byndgrn.com.</p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Full name</label>
                <input value={inviteForm.full_name} onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))} placeholder="e.g. Yahir Leon" className={inp} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="name@beyondgreenbiotech.com" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Role</label>
                  <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))} className={inp + ' cursor-pointer'}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Department</label>
                  <select value={inviteForm.department} onChange={e => setInviteForm(f => ({ ...f, department: e.target.value }))} className={inp + ' cursor-pointer'}>
                    <option value="">—</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              {inviteErr && <div className="text-xs px-3 py-2 rounded-lg border bg-red-500/10 text-red-500 border-red-500/20">{inviteErr}</div>}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setInviteOpen(false)} disabled={inviteBusy} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
                <button onClick={sendInvite} disabled={inviteBusy || !inviteForm.full_name.trim() || !inviteForm.email.trim()} className="flex-1 bg-[#00863F] hover:bg-[#0b7a3d] disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">{inviteBusy ? 'Sending…' : 'Send invite'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Per-board View / Edit matrix for one user (admin only) ───────────────── */
function BoardAccess({ email }: { email: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const { boards } = useBoards()
  const [grants, setGrants] = useState<Record<string, { can_view: boolean; can_edit: boolean }>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => { let ok = true; (async () => {
    setLoading(true)
    const { data } = await sb.rpc('erp_list_user_permissions', { p_email: email })
    if (!ok) return
    const m: Record<string, { can_view: boolean; can_edit: boolean }> = {}
    for (const r of ((data as any[]) || [])) m[r.board_key] = { can_view: !!r.can_view, can_edit: !!r.can_edit }
    setGrants(m); setLoading(false)
  })(); return () => { ok = false } }, [sb, email])

  const groups = useMemo(() => groupBoards(boards).filter(g => g.items.length), [boards])

  async function set(key: string, view: boolean, edit: boolean) {
    setErr(''); setBusy(key)
    const prev = grants[key]
    setGrants(g => ({ ...g, [key]: { can_view: view, can_edit: view && edit } }))
    const { error } = await sb.rpc('erp_set_board_permission', { p_email: email, p_board_key: key, p_view: view, p_edit: view && edit })
    if (error) { setErr(error.message); setGrants(g => ({ ...g, [key]: prev || { can_view: false, can_edit: false } })) }
    setBusy(null)
  }
  async function setGroup(keys: string[], view: boolean, edit: boolean) {
    for (const k of keys) await set(k, view, edit)
  }
  const allKeys = groups.flatMap(g => g.items.map(i => i.board_key))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs text-gray-400">Board access <span className="text-gray-400/70">— what this user can see and change</span></label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setGroup(allKeys, true, true)} className="text-[11px] px-2 py-1 rounded bg-[#DDF3E8] text-[#0F7A4E] hover:bg-[#C9EBD9]">All boards: view + edit</button>
          <button type="button" onClick={() => setGroup(allKeys, true, false)} className="text-[11px] px-2 py-1 rounded bg-[#EEF2FB] text-[#3A4A6B] hover:bg-[#DCE3F2]">All: view only</button>
          <button type="button" onClick={() => setGroup(allKeys, false, false)} className="text-[11px] px-2 py-1 rounded bg-[#FBE9E9] text-[#B3261E] hover:bg-[#F6D5D5]">Revoke all</button>
        </div>
      </div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {loading ? <p className="text-xs text-gray-400">Loading access…</p> : (
        <div className="max-h-[340px] overflow-y-auto rounded-xl border border-[#E4E6EE]">
          {groups.map(g => {
            const keys = g.items.map(i => i.board_key)
            return (
              <div key={g.group}>
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#F5F6FA] text-[11px] font-semibold uppercase tracking-wide text-gray-500 sticky top-0">
                  <span>{g.group}</span>
                  <span className="flex gap-3 font-normal normal-case tracking-normal">
                    <button type="button" onClick={() => setGroup(keys, true, true)} className="hover:text-[#0F7A4E]">edit all</button>
                    <button type="button" onClick={() => setGroup(keys, true, false)} className="hover:text-[#0F7A4E]">view all</button>
                    <button type="button" onClick={() => setGroup(keys, false, false)} className="hover:text-red-600">none</button>
                  </span>
                </div>
                {g.items.map(b => {
                  const gr = grants[b.board_key] || { can_view: false, can_edit: false }
                  const k = b.board_key
                  return (
                    <div key={k} className={`flex items-center px-3 py-1.5 border-t border-[#F0F1F5] text-sm ${busy === k ? 'opacity-60' : ''}`}>
                      <span className="flex-1 text-[#1A1D2E]">{b.label}</span>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 mr-4 cursor-pointer">
                        <input type="checkbox" checked={gr.can_view} onChange={e => set(k, e.target.checked, gr.can_edit)} className="accent-emerald-600" /> View
                      </label>
                      <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${gr.can_view ? 'text-gray-600' : 'text-gray-300'}`}>
                        <input type="checkbox" disabled={!gr.can_view} checked={gr.can_view && gr.can_edit} onChange={e => set(k, true, e.target.checked)} className="accent-emerald-600" /> Edit
                      </label>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-2">Changes save instantly. The user sees the new access the next time they load a page.</p>
    </div>
  )
}


/* ── Off-site lock: where the ERP may be used from when NOT on the work network ─────────────
   Enforced by database policies (the request's real IP reaches Postgres), the UI just mirrors it. */
const OFFSITE_MODES: { v: string; label: string; help: string }[] = [
  { v: 'full', label: 'Full access anywhere', help: 'No restriction off the work WiFi.' },
  { v: 'readonly', label: 'View only off-site', help: 'Can look, cannot change anything until back on the facility network.' },
  { v: 'chat_only', label: 'Chat only off-site', help: 'Boards and records lock off-site; team chat stays open on their phone.' },
  { v: 'blocked', label: 'Blocked off-site', help: 'The ERP only works from the facility network for this user.' },
]

function WorkNetworkCard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [nets, setNets] = useState<string[]>([])
  const [me, setMe] = useState<{ ip: string | null; onsite: boolean; gate_active: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [{ data: n }, { data: a }] = await Promise.all([sb.rpc('erp_work_networks'), sb.rpc('erp_my_access')])
    setNets(Array.isArray(n) ? (n as string[]) : [])
    setMe(a ? { ip: (a as any).ip ?? null, onsite: !!(a as any).onsite, gate_active: !!(a as any).gate_active } : null)
  }, [sb])
  useEffect(() => { load() }, [load])
  async function save(next: string[]) {
    setBusy(true); setErr('')
    const { data, error } = await sb.rpc('erp_set_work_networks', { p_networks: next })
    setBusy(false)
    if (error) { setErr(error.message.replace(/^.*?:\s*/, '') || 'Could not save'); return }
    setNets(Array.isArray(data) ? (data as string[]) : next); setDraft(''); load()
  }
  const myNet = me?.ip ? (me.ip.includes(':') ? me.ip.replace(/:[^:]*:[^:]*:[^:]*:[^:]*$/, '::') + '/64' : me.ip + '/32') : null
  return (
    <div className="mb-5 bg-white border border-[#E4E6EE] rounded-xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-[#1A1D2E]">📍 Work network (off-site lock)</p>
          <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">Add the facility&apos;s public internet address(es). Users whose <b>Off-site access</b> is not &quot;Full&quot; get locked down the moment they are not on one of these networks — enforced in the database, not just on screen. With no networks listed, the lock is off for everyone.</p>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${me?.gate_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>{me?.gate_active ? 'LOCK ON' : 'LOCK OFF'}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {nets.map(n => (
          <span key={n} className="inline-flex items-center gap-2 bg-[#F6F7FB] border border-[#E4E6EE] rounded-lg px-3 py-1.5 text-sm font-mono text-[#1A1D2E]">{n}{me?.onsite && myNet && n === myNet && <span className="text-[10px] font-sans font-bold text-emerald-600">you are here</span>}<button onClick={() => { if (confirm(`Remove ${n} from the work network list?`)) save(nets.filter(x => x !== n)) }} disabled={busy} className="text-gray-400 hover:text-red-600">×</button></span>
        ))}
        {nets.length === 0 && <span className="text-xs text-gray-400">No work networks yet.</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. 203.0.113.7 or 203.0.113.0/24" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm font-mono w-64 focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/30" />
        <button onClick={() => draft.trim() && save([...nets, draft.trim()])} disabled={busy || !draft.trim()} className="text-sm font-semibold text-white rounded-lg px-3 py-2 disabled:opacity-50" style={{ background: '#0F7A4E' }}>Add</button>
        {me?.ip && myNet && !nets.includes(myNet) && <button onClick={() => save([...nets, myNet])} disabled={busy} className="text-sm font-semibold rounded-lg px-3 py-2 border border-[#E4E6EE] hover:bg-[#F6F7FB] disabled:opacity-50">+ Add the network I&apos;m on now ({me.ip})</button>}
        {me?.ip && <span className="text-[11px] text-gray-400">Your current address: <span className="font-mono">{me.ip}</span>{me.gate_active ? me.onsite ? ' · recognised as on-site' : ' · currently off-site' : ''}</span>}
      </div>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      <p className="text-[11px] text-gray-400 mt-3">Tip: add the facility network while you are physically there, then set each floor account&apos;s off-site access below. Your own account defaults to Full access so you cannot lock yourself out.</p>
    </div>
  )
}

function OffsiteAccess({ email }: { email: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [mode, setMode] = useState<string>('full')
  const [busy, setBusy] = useState(false)
  useEffect(() => { sb.from('user_profiles').select('offsite_access').eq('email', email).maybeSingle().then(({ data }: any) => setMode(data?.offsite_access || 'full')) }, [sb, email])
  async function set(v: string) {
    setBusy(true)
    const { error } = await sb.rpc('erp_set_offsite_access', { p_email: email, p_mode: v })
    setBusy(false)
    if (error) alert(error.message); else setMode(v)
  }
  const cur = OFFSITE_MODES.find(m => m.v === mode) || OFFSITE_MODES[0]
  return (
    <div className="pt-3 border-t border-[#E4E6EE]">
      <label className="block text-xs text-gray-400 mb-1.5">Off-site access <span className="text-gray-300">· what this person can do when not on the work WiFi</span></label>
      <select value={mode} onChange={e => set(e.target.value)} disabled={busy} className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/30">
        {OFFSITE_MODES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
      </select>
      <p className="text-[11px] text-gray-400 mt-1">{cur.help} Saves immediately.</p>
    </div>
  )
}
