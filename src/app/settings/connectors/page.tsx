'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Settings ▸ Claude Connector — how to connect Claude to the ERP, plus who is connected (disconnect anytime). */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'

const fmt = (d?: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

export default function ClaudeConnectorSettings() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp'

  const load = () => fetch('/api/oauth/connections').then(r => r.json()).then(x => x.error ? setErr(x.error) : setD(x)).catch(() => setErr('Could not load connections'))
  useEffect(() => { load() }, [])

  async function disconnect(id: string) {
    if (!confirm('Disconnect this Claude connection? Claude will need to sign in again to use the ERP.')) return
    const r = await fetch('/api/oauth/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    const x = await r.json().catch(() => ({}))
    if (x.error) alert(x.error); load()
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Claude Connector</h1>
        <p className="text-gray-600 mt-1">Let Claude look things up and make changes in the ERP for you, using your own login and permissions.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="text-sm font-semibold text-gray-800">Connector URL</div>
        <div className="flex gap-2">
          <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 break-all">{url}</code>
          <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="px-4 rounded-lg text-white text-sm font-semibold" style={{ background: '#16803D' }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1">
          <li>In Claude, open <b>Settings ▸ Connectors</b> and choose <b>Add custom connector</b>.</li>
          <li>Name it <b>beyondGREEN ERP</b>, paste the URL above, and click <b>Add</b>.</li>
          <li>Click <b>Connect</b>. The ERP opens: sign in with your own email and password (and the emailed code if asked).</li>
          <li>Click <b>Allow</b>. You are done. Claude can now use the ERP as you.</li>
        </ol>
        <p className="text-xs text-gray-500">Claude only sees and changes what your login allows. Every change is saved under your name. On Team or Enterprise plans an organization Owner may need to add the connector first.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-800">{d?.isAdmin ? 'All connections' : 'My connections'}</div>
        {err && <div className="p-5 text-sm text-red-700">{err}</div>}
        {!d && !err && <div className="p-5 text-sm text-gray-500">Loading…</div>}
        {d && !d.connections?.length && <div className="p-5 text-sm text-gray-500">No Claude connections yet.</div>}
        {d?.connections?.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
              <th className="text-left px-5 py-2">Person</th><th className="text-left px-3 py-2">App</th><th className="text-left px-3 py-2">Connected</th>
              <th className="text-left px-3 py-2">Last used</th><th className="text-right px-3 py-2">Calls</th><th className="px-5 py-2"></th>
            </tr></thead>
            <tbody>
              {d.connections.map((c: any) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-5 py-2.5 text-gray-800">{c.email}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.client_name || 'Claude'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{fmt(c.created_at)}</td>
                  <td className="px-3 py-2.5 text-gray-600">{fmt(c.last_used_at)}{c.last_tool ? <span className="text-gray-400"> · {c.last_tool}</span> : null}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600">{c.call_count}</td>
                  <td className="px-5 py-2.5 text-right">
                    {c.revoked_at ? <span className="text-xs text-gray-400">Disconnected {fmt(c.revoked_at)}</span>
                      : <button onClick={() => disconnect(c.id)} className="text-xs font-semibold text-red-600 hover:underline">Disconnect</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
