'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Alert { id: string; alert_type: string; title: string; summary: string | null; url: string | null; source: string | null; sentiment: string | null; is_read: boolean; created_at: string }

function SentimentBadge({ s }: { s: string | null }) {
  if (!s) return null
  const cfg = s === 'positive'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
    : s === 'negative'
    ? 'bg-red-500/15 text-red-400 border-red-500/20'
    : 'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]'
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${cfg}`}>{s}</span>
}

export default function BergAlertsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await sb
      .from('berg_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setAlerts(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  async function markRead(id: string) {
    await sb.from('berg_alerts').update({ is_read: true }).eq('id', id)
    setAlerts(a => a.map(x => x.id === id ? { ...x, is_read: true } : x))
  }

  async function markAllRead() {
    await sb.from('berg_alerts').update({ is_read: true }).eq('is_read', false)
    setAlerts(a => a.map(x => ({ ...x, is_read: true })))
  }

  async function runMonitor() {
    setRunning(true)
    setRunMsg('')
    try {
      const res = await fetch('/api/berg/monitor')
      const json = await res.json()
      setRunMsg(json.ok ? `Monitor ran — ${json.saved} new alert${json.saved !== 1 ? 's' : ''} found.` : `Error: ${json.error}`)
      await load()
    } catch (e) {
      setRunMsg(String(e))
    }
    setRunning(false)
  }

  const unread = alerts.filter(a => !a.is_read).length

  return (
    <div className="p-4 md:p-8 min-h-screen max-w-4xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">SETTINGS</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">BERG Alerts</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}${unread > 0 ? ` • ${unread} unread` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button onClick={markAllRead} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">
              Mark all read
            </button>
          )}
          <button
            onClick={runMonitor}
            disabled={running}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <svg className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {running ? 'Scanning…' : 'Run Monitor Now'}
          </button>
        </div>
      </div>

      {runMsg && (
        <div className="mb-4 px-3 py-2.5 rounded-lg border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-sm">
          {runMsg}
        </div>
      )}

      <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="text-gray-500 text-sm">No alerts yet.</p>
            <p className="text-gray-600 text-xs">Click &quot;Run Monitor Now&quot; to search for beyondGREEN mentions.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {alerts.map(a => (
              <div key={a.id} className={`px-5 py-4 ${a.is_read ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${a.is_read ? 'bg-[#F5F6FA]' : 'bg-emerald-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[#1A1D2E] text-sm font-medium">{a.title}</span>
                      <SentimentBadge s={a.sentiment} />
                    </div>
                    {a.summary && <p className="text-gray-400 text-sm leading-relaxed mb-2">{a.summary}</p>}
                    <div className="flex flex-wrap items-center gap-3">
                      {a.source && <span className="text-gray-600 text-xs">{a.source}</span>}
                      <span className="text-gray-700 text-xs">
                        {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {a.url && (
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400 text-xs transition-colors">
                          View article →
                        </a>
                      )}
                      {!a.is_read && (
                        <button onClick={() => markRead(a.id)} className="text-gray-600 hover:text-gray-400 text-xs transition-colors">
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-gray-600 text-xs mt-4 text-center">
        Monitor runs automatically every hour via Vercel Cron.
      </p>
    </div>
  )
}
