'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Prefs {
  tagged_email: boolean
  tagged_inapp: boolean
  new_order_inapp: boolean
  invoice_overdue_email: boolean
  invoice_overdue_inapp: boolean
  low_stock_inapp: boolean
  machine_down_email: boolean
  machine_down_inapp: boolean
  cert_expiring_email: boolean
  cert_expiring_inapp: boolean
  berg_alert_inapp: boolean
  new_chat_inapp: boolean
}

const DEFAULT_PREFS: Prefs = {
  tagged_email: true,
  tagged_inapp: true,
  new_order_inapp: true,
  invoice_overdue_email: true,
  invoice_overdue_inapp: true,
  low_stock_inapp: true,
  machine_down_email: true,
  machine_down_inapp: true,
  cert_expiring_email: true,
  cert_expiring_inapp: true,
  berg_alert_inapp: true,
  new_chat_inapp: true,
}

const NOTIFICATION_ROWS: { label: string; description: string; emailKey?: keyof Prefs; inappKey?: keyof Prefs }[] = [
  { label: 'Tagged by teammate', description: 'When someone @mentions you in a note', emailKey: 'tagged_email', inappKey: 'tagged_inapp' },
  { label: 'New sales order', description: 'When a new order is created', inappKey: 'new_order_inapp' },
  { label: 'Invoice overdue', description: 'When a payment is past due', emailKey: 'invoice_overdue_email', inappKey: 'invoice_overdue_inapp' },
  { label: 'Low stock alert', description: 'When inventory falls below reorder point', inappKey: 'low_stock_inapp' },
  { label: 'Machine down', description: 'When a machine status changes to Down', emailKey: 'machine_down_email', inappKey: 'machine_down_inapp' },
  { label: 'Certification expiring', description: 'When a cert is within 90 days of expiry', emailKey: 'cert_expiring_email', inappKey: 'cert_expiring_inapp' },
  { label: 'BERG web alert', description: 'New intelligence from BERG monitoring', inappKey: 'berg_alert_inapp' },
  { label: 'New chat message', description: 'When you receive a direct message', inappKey: 'new_chat_inapp' },
]

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${on ? 'bg-emerald-600' : 'bg-gray-700'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function NotificationsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [profileId, setProfileId] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return
      const { data } = await sb.from('user_profiles').select('id,notification_prefs').eq('email', user.email).single()
      if (data) {
        setProfileId(data.id)
        if (data.notification_prefs && Object.keys(data.notification_prefs).length > 0) {
          setPrefs({ ...DEFAULT_PREFS, ...data.notification_prefs })
        }
      }
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line

  function set<K extends keyof Prefs>(key: K, val: boolean) {
    setPrefs(p => ({ ...p, [key]: val }))
  }

  async function save() {
    if (!profileId) return
    setSaving(true)
    setNotice(null)
    const { error } = await sb.from('user_profiles').update({
      notification_prefs: prefs,
      updated_at: new Date().toISOString(),
    }).eq('id', profileId)
    if (error) {
      setNotice({ ok: false, msg: error.message })
    } else {
      setNotice({ ok: true, msg: 'Preferences saved.' })
    }
    setSaving(false)
  }

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
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-cyan-500/20 text-cyan-300 border-cyan-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">Notifications</h1>
        <p className="text-gray-500 text-sm mt-0.5">Choose how you want to be notified</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        <div className="grid grid-cols-[1fr_auto_auto] px-5 py-3 border-b border-gray-800 text-xs font-semibold text-gray-500 gap-6">
          <span>Event</span>
          <span className="text-center w-12">Email</span>
          <span className="text-center w-12">In-app</span>
        </div>
        {NOTIFICATION_ROWS.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-[1fr_auto_auto] items-center px-5 py-4 gap-6 border-b border-gray-800/60 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}
          >
            <div>
              <p className="text-white text-sm font-medium">{row.label}</p>
              <p className="text-gray-500 text-xs mt-0.5">{row.description}</p>
            </div>
            <div className="flex items-center justify-center w-12">
              {row.emailKey ? (
                <Toggle on={prefs[row.emailKey] as boolean} onChange={v => set(row.emailKey!, v)} />
              ) : (
                <span className="text-gray-700 text-xs">—</span>
              )}
            </div>
            <div className="flex items-center justify-center w-12">
              {row.inappKey ? (
                <Toggle on={prefs[row.inappKey] as boolean} onChange={v => set(row.inappKey!, v)} />
              ) : (
                <span className="text-gray-700 text-xs">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {notice && (
        <div className={`mb-4 text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {notice.msg}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:bg-cyan-900 disabled:text-cyan-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Save Preferences'}
      </button>
    </div>
  )
}
