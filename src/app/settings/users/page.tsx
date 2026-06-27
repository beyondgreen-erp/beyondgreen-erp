'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Profile {
  id: string
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

const ROLES = ['Admin', 'Manager', 'Member', 'Viewer']
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
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">User Management</h1>
        <p className="text-gray-500 text-sm mt-0.5">{profiles.length} registered user{profiles.length !== 1 ? 's' : ''}</p>
      </div>

      {notice && (
        <div className={`mb-4 text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {notice.msg}
        </div>
      )}

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
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${p.is_active ? 'text-red-400 border-red-500/30 hover:bg-red-500/10' : 'text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10'}`}
                        >
                          {p.is_active ? 'Deactivate' : 'Restore'}
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
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-6 w-full max-w-lg space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[#1A1D2E] font-semibold">Edit User</h2>
              {editing && <ShareLink id={editing.id} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-2.5 py-1.5 rounded-lg transition-colors shrink-0" />}
              <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
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
            {notice && (
              <div className={`text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                {notice.msg}
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditing(null)} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
