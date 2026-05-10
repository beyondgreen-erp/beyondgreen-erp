'use client'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Profile {
  id: string
  email: string
  full_name: string
  display_name: string | null
  role: string
  department: string | null
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

const ROLES = ['Admin', 'Manager', 'Member']
const DEPARTMENTS = ['Management', 'Sustainability', 'Marketing', 'Sales', 'R&D', 'Finance', 'Warehouse', 'Other']

const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Manager: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Member: 'bg-gray-700/40 text-gray-400 border-gray-700',
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
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState({ role: '', department: '' })
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
    setEditForm({ role: p.role, department: p.department ?? '' })
    setNotice(null)
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    const initials = editing.full_name.trim().split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    const { error } = await sb.from('user_profiles').update({
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

  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">User Management</h1>
        <p className="text-gray-500 text-sm mt-0.5">{profiles.length} registered user{profiles.length !== 1 ? 's' : ''}</p>
      </div>

      {notice && (
        <div className={`mb-4 text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {notice.msg}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
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
              <tr className="border-b border-gray-800">
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
                  <tr key={p.id} className={`border-b border-gray-800/60 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: p.avatar_color }}
                        >
                          {p.avatar_initials ?? p.full_name[0]}
                        </div>
                        <div>
                          <p className="text-white font-medium text-sm">{p.full_name}</p>
                          <p className="text-gray-500 text-xs">{p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${roleColor}`}>{p.role}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-sm">{p.department ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_active ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 bg-gray-700/30'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{pres ? fmtDate(pres.last_seen) : '—'}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{pres ? `${pres.activity_count} actions` : '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-2.5 py-1 rounded-lg transition-colors"
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
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold">Edit User</h2>
              <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: editing.avatar_color }}>
                {editing.avatar_initials ?? editing.full_name[0]}
              </div>
              <div>
                <p className="text-white font-medium">{editing.full_name}</p>
                <p className="text-gray-500 text-xs">{editing.email}</p>
              </div>
            </div>
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
            {notice && (
              <div className={`text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                {notice.msg}
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditing(null)} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
