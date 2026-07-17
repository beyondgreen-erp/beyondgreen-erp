'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const num = (n: any) => Number(n) || 0
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

function QR({ url, size = 150 }: { url: string; size?: number }) {
  const [d, setD] = useState('')
  useEffect(() => {
    let alive = true
    import('qrcode').then((m: any) => m.toDataURL(url, { width: size * 2, margin: 1 })).then((u: string) => { if (alive) setD(u) }).catch(() => {})
    return () => { alive = false }
  }, [url, size])
  return d ? <img src={d} width={size} height={size} alt="QR code" /> : <div style={{ width: size, height: size }} className="grid place-items-center text-xs text-gray-400 border border-dashed border-gray-300 rounded">QR…</div>
}

export default function WarehouseTicketsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [tickets, setTickets] = useState<any[]>([])
  const [containers, setContainers] = useState<any[]>([])
  const [portalToken, setPortalToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'open' | 'all' | 'completed' | 'cancelled'>('open')
  const [userEmail, setUserEmail] = useState('')
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => { if (typeof window !== 'undefined') setOrigin(window.location.origin) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: tk }, { data: c }, { data: wp }] = await Promise.all([
      sb.from('container_tickets').select('*, lines:container_ticket_lines(*)').order('created_at', { ascending: false }),
      sb.from('containers').select('id,name,label'),
      sb.from('warehouse_portal').select('token').limit(1).maybeSingle(),
    ])
    setTickets(tk || []); setContainers(c || []); setPortalToken((wp as any)?.token || ''); setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const cById = (id: string) => containers.find(c => c.id === id)
  const portalUrl = portalToken && origin ? `${origin}/w/${portalToken}` : ''

  const shown = tickets.filter(t => filter === 'all' ? true : t.status === filter)
  const openCount = tickets.filter(t => t.status === 'open').length

  async function completeTicket(id: string) {
    if (!confirm('Mark this ticket complete and update the container?')) return
    await sb.rpc('complete_container_ticket', { p_ticket: id, p_by: userEmail || null })
    await load()
  }
  async function cancelTicket(id: string) {
    if (!confirm('Cancel this ticket?')) return
    await sb.from('container_tickets').update({ status: 'cancelled' }).eq('id', id)
    await load()
  }
  async function printTicket(t: any) {
    const link = `${window.location.origin}/t/${t.token}`
    let qr = ''
    try { const m: any = await import('qrcode'); qr = await m.toDataURL(link, { width: 260, margin: 1 }) } catch (e) { /* */ }
    const cname = cById(t.container_id)?.name || ''
    const rows = (t.lines || []).map((l: any) => `<tr><td class="cb"></td><td>${esc(l.item_name || l.sku || 'Item')}${(l.sku && l.item_name) ? ` <span class="muted">${esc(l.sku)}</span>` : ''}</td><td class="r">${num(l.quantity)}</td><td>${esc(l.uom || '')}</td></tr>`).join('')
    const color = t.type === 'pull' ? '#df2f4a' : '#00854a'
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.ticket_no)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:26px}h1{font-size:22px;margin:0}.sub{color:#555;margin:4px 0 14px;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#eee}.cb{width:30px;height:36px}.r{text-align:right}.muted{color:#888}.badge{display:inline-block;padding:3px 12px;border-radius:999px;color:#fff;font-weight:bold;font-size:12px;background:${color}}.qr{margin-top:22px;display:flex;gap:16px;align-items:center}.qr .lnk{font-size:12px;color:#333;word-break:break-all}@media print{.noprint{display:none}}</style></head>
<body><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1>${t.type === 'pull' ? 'PULL' : 'ADD'} Ticket</h1><div class="sub"><span class="badge">${esc(t.ticket_no)}</span> &nbsp; Container <b>${esc(cname)}</b> &nbsp; · &nbsp; ${new Date(t.created_at).toLocaleString()}</div></div><div style="text-align:right;font-size:12px;color:#666">beyondGREEN biotech, Inc.<br>Containers</div></div>
<table><thead><tr><th style="width:30px">✓</th><th>Item</th><th class="r" style="width:70px">Qty</th><th style="width:70px">UOM</th></tr></thead><tbody>${rows}</tbody></table>
${t.note ? `<div style="margin-top:10px;font-size:13px"><b>Note:</b> ${esc(t.note)}</div>` : ''}
<div class="qr"><img src="${qr}" width="150" height="150" alt="QR"/><div><div style="font-weight:bold;margin-bottom:4px">Confirm on your phone</div><div class="lnk">Scan the QR or open:<br>${esc(link)}</div></div></div>
<div class="noprint" style="margin-top:20px"><button onclick="window.print()" style="padding:8px 16px;font-size:14px">Print</button></div>
</body></html>`
    const w = window.open('', '_blank', 'width=560,height=800'); if (!w) { alert('Allow pop-ups to print the ticket.'); return }
    w.document.write(html); w.document.close()
  }

  function copyLink() {
    if (!portalUrl) return
    navigator.clipboard?.writeText(portalUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="mb-5">
        <span className="mon-tag">🚚 Warehouse</span>
        <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Pull &amp; Add Tickets</h1>
        <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${openCount} open · ${tickets.length} total`}</p>
      </div>

      {/* Shareable portal card */}
      <div className="rounded-2xl border border-[#E4E6EE] bg-white shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-3 bg-[#00854a] text-white flex items-center justify-between">
          <span className="font-bold">Warehouse Portal — no login needed</span>
          <span className="text-[11px] bg-white/20 rounded-full px-2 py-0.5">Share once, they bookmark it</span>
        </div>
        <div className="p-5 flex flex-col sm:flex-row gap-5 items-center">
          <div className="shrink-0 bg-white p-2 border border-[#EEF0F4] rounded-lg">{portalUrl ? <QR url={portalUrl} size={150} /> : <div className="w-[150px] h-[150px] grid place-items-center text-xs text-gray-400">…</div>}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-600">The warehouse team scans this QR (or opens the link) on their phones to see every open pull/add ticket and check items off — <b>without logging into the ERP</b>. Print it and post it in the yard, or text the link once.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input readOnly value={portalUrl} className="flex-1 min-w-[200px] bg-[#F7F8FB] border border-[#E4E6EE] rounded-lg px-3 py-2 text-xs font-mono text-gray-600" />
              <button onClick={copyLink} className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#3B6FE0] text-white hover:opacity-90">{copied ? 'Copied ✓' : 'Copy link'}</button>
              {portalUrl && <a href={portalUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-700 hover:bg-gray-50">Open</a>}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3">
        {(['open', 'all', 'completed', 'cancelled'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${filter === f ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-600 border-[#E4E6EE] hover:bg-gray-50'}`}>{f[0].toUpperCase() + f.slice(1)}</button>
        ))}
      </div>

      {/* Tickets list */}
      <div className="space-y-2">
        {shown.length === 0 && <div className="rounded-xl border border-[#EEF0F4] bg-white px-4 py-10 text-center text-gray-400">No {filter === 'all' ? '' : filter} tickets.</div>}
        {shown.map(t => {
          const isPull = t.type === 'pull'
          const accent = isPull ? '#df2f4a' : '#00854a'
          const lines = t.lines || []
          const done = lines.filter((l: any) => l.done).length
          const statusColor = t.status === 'open' ? '#3B6FE0' : t.status === 'completed' ? '#00854a' : '#9aa3b2'
          return (
            <div key={t.id} className="rounded-xl border border-[#E4E6EE] bg-white overflow-hidden">
              <div className="flex items-stretch">
                <div className="w-1.5 shrink-0" style={{ background: accent }} />
                <div className="flex-1 min-w-0 px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-white rounded-full px-2 py-0.5" style={{ background: accent }}>{isPull ? 'PULL' : 'ADD'}</span>
                    <span className="font-black text-gray-800">{cById(t.container_id)?.name || 'Container'}</span>
                    <span className="text-[11px] text-gray-400">{t.ticket_no}</span>
                    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 text-white" style={{ background: statusColor }}>{t.status}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{lines.length} item{lines.length === 1 ? '' : 's'}{done ? ` · ${done} done` : ''} · {new Date(t.created_at).toLocaleDateString()}{t.note ? ` · “${t.note}”` : ''}</p>
                </div>
                <div className="shrink-0 self-center pr-3 flex items-center gap-2">
                  <button onClick={() => printTicket(t)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-700 hover:bg-gray-50">Print</button>
                  {t.status === 'open' && <>
                    <a href={`/t/${t.token}`} target="_blank" rel="noreferrer" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-700 hover:bg-gray-50">Open</a>
                    <button onClick={() => completeTicket(t.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#00854a] text-white hover:opacity-90">Complete</button>
                    <button onClick={() => cancelTicket(t.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-[#df2f4a] hover:bg-red-50">Cancel</button>
                  </>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
