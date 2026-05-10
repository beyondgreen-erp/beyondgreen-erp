'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
]


export default function CompanyPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [recordId, setRecordId] = useState<string | null>(null)
  const [form, setForm] = useState({
    company_name: 'beyondGREEN',
    industry: 'Sustainable Products / Biotech',
    website: '',
    phone: '',
    address: '',
    contact_email: '',
    timezone: 'America/Los_Angeles',
  })

  useEffect(() => {
    async function load() {
      const { data } = await sb.from('company_settings').select('*').limit(1).single()
      if (data) {
        setRecordId(data.id)
        setForm({
          company_name: data.company_name ?? 'beyondGREEN',
          industry: data.industry ?? '',
          website: data.website ?? '',
          phone: data.phone ?? '',
          address: data.address ?? '',
          contact_email: data.contact_email ?? '',
          timezone: data.timezone ?? 'America/Los_Angeles',
        })
      }
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line

  async function save() {
    setSaving(true)
    setNotice(null)
    const payload = {
      company_name: form.company_name.trim(),
      industry: form.industry.trim(),
      website: form.website.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      contact_email: form.contact_email.trim() || null,
      timezone: form.timezone,
      updated_at: new Date().toISOString(),
    }
    const { error } = recordId
      ? await sb.from('company_settings').update(payload).eq('id', recordId)
      : await sb.from('company_settings').insert(payload)
    if (error) {
      setNotice({ ok: false, msg: error.message })
    } else {
      setNotice({ ok: true, msg: 'Company profile saved.' })
    }
    setSaving(false)
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition'

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
    </div>
  )

  return (
    <div className="p-4 md:p-8 min-h-screen max-w-2xl mx-auto">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-300 border-amber-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">Company Profile</h1>
        <p className="text-gray-500 text-sm mt-0.5">Your organization details</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Company Name</label>
            <input value={form.company_name} onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Industry</label>
            <input value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} className={inp} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Website</label>
            <input value={form.website} onChange={e => setForm(p => ({ ...p, website: e.target.value }))} className={inp} placeholder="https://beyondgreenbiotech.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Phone</label>
            <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="+1 (555) 000-0000" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Address</label>
          <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className={inp} placeholder="123 Green Way, Vancouver, BC" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Contact Email</label>
            <input type="email" value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))} className={inp} placeholder="hello@beyondgreenbiotech.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Timezone</label>
            <select value={form.timezone} onChange={e => setForm(p => ({ ...p, timezone: e.target.value }))} className={inp + ' cursor-pointer'}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>

        {notice && (
          <div className={`text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
            {notice.msg}
          </div>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 disabled:text-amber-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save Company Profile'}
        </button>
      </div>
    </div>
  )
}
