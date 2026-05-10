'use client'
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
  avatar_color: string
  avatar_initials: string | null
  is_admin: boolean
}

const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Manager: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Member: 'bg-gray-700/40 text-gray-400 border-gray-700',
}

export default function ProfilePage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState({ full_name: '', display_name: '', department: '', phone: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [changingPw, setChangingPw] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwErr, setPwErr] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return
      const { data } = await sb.from('user_profiles').select('*').eq('email', user.email).single()
      if (data) {
        setProfile(data as Profile)
        setForm({
          full_name: data.full_name ?? '',
          display_name: data.display_name ?? '',
          department: data.department ?? '',
          phone: data.phone ?? '',
        })
      }
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line

  async function save() {
    if (!profile) return
    setSaving(true)
    setNotice(null)
    const initials = form.full_name.trim().split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    const { error } = await sb.from('user_profiles').update({
      full_name: form.full_name.trim(),
      display_name: form.display_name.trim() || null,
      department: form.department.trim() || null,
      phone: form.phone.trim() || null,
      avatar_initials: initials,
      updated_at: new Date().toISOString(),
    }).eq('id', profile.id)
    if (error) {
      setNotice({ ok: false, msg: error.message })
    } else {
      setProfile(p => p ? { ...p, ...form, avatar_initials: initials } : p)
      setNotice({ ok: true, msg: 'Profile saved.' })
    }
    setSaving(false)
  }

  async function changePassword() {
    setPwErr('')
    if (pwForm.next !== pwForm.confirm) { setPwErr('Passwords do not match.'); return }
    if (pwForm.next.length < 8) { setPwErr('Password must be at least 8 characters.'); return }
    const { error } = await sb.auth.updateUser({ password: pwForm.next })
    if (error) { setPwErr(error.message); return }
    setChangingPw(false)
    setPwForm({ current: '', next: '', confirm: '' })
    setNotice({ ok: true, msg: 'Password updated.' })
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
    </div>
  )

  if (!profile) return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-gray-500">Profile not found. Contact your administrator.</p>
    </div>
  )

  const roleColor = ROLE_COLORS[profile.role] ?? ROLE_COLORS.Member

  return (
    <div className="p-4 md:p-8 min-h-screen max-w-2xl mx-auto">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">My Profile</h1>
        <p className="text-gray-500 text-sm mt-0.5">Your beyondGREEN identity and contact info</p>
      </div>

      {/* Avatar + identity */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6 flex items-center gap-5">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
          style={{ backgroundColor: profile.avatar_color }}
        >
          {profile.avatar_initials || profile.full_name[0]}
        </div>
        <div>
          <p className="text-white text-lg font-semibold">{profile.full_name}</p>
          {profile.display_name && <p className="text-gray-400 text-sm">{profile.display_name}</p>}
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${roleColor}`}>{profile.role}</span>
            {profile.department && <span className="text-xs text-gray-500">{profile.department}</span>}
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6 space-y-4">
        <h2 className="text-white font-semibold mb-2">Edit Details</h2>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Full Name</label>
          <input value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Display Name</label>
          <input value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} className={inp} placeholder="Nickname shown in chats" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Email <span className="text-gray-600">(read only)</span></label>
          <input value={profile.email} readOnly className={inp + ' opacity-50 cursor-not-allowed'} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Department</label>
          <input value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Phone</label>
          <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="+1 (555) 000-0000" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Role <span className="text-gray-600">(set by admin)</span></label>
          <div className={`${inp} opacity-50 cursor-not-allowed`}>{profile.role}</div>
        </div>

        {notice && (
          <div className={`text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
            {notice.msg}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => setChangingPw(v => !v)}
            className="text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
          >
            Change Password
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Change password panel */}
      {changingPw && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-white font-semibold">Change Password</h2>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">New Password</label>
            <input type="password" value={pwForm.next} onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Confirm New Password</label>
            <input type="password" value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} className={inp} />
          </div>
          {pwErr && <p className="text-red-400 text-xs">{pwErr}</p>}
          <div className="flex gap-3">
            <button onClick={() => setChangingPw(false)} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={changePassword} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">Update Password</button>
          </div>
        </div>
      )}
    </div>
  )
}
