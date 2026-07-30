'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const num = (n: any) => Number(n) || 0
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

// ── QR image (lazy-loads the qrcode lib) ──
function QR({ url, size = 170 }: { url: string; size?: number }) {
  const [d, setD] = useState('')
  useEffect(() => {
    let alive = true
    import('qrcode').then((m: any) => m.toDataURL(url, { width: size * 2, margin: 1 })).then((u: string) => { if (alive) setD(u) }).catch(() => {})
    return () => { alive = false }
  }, [url, size])
  return d ? <img src={d} width={size} height={size} alt="QR code" /> : <div style={{ width: size, height: size }} className="grid place-items-center text-xs text-gray-400 border border-dashed border-gray-300 rounded">QR…</div>
}

// ── Product typeahead ──
function ProductPicker({ products, onPick }: { products: any[]; onPick: (p: any) => void }) {
  const [q, setQ] = useState('')
  const matches = q.length > 0 ? products.filter(p => (p.sku || '').toLowerCase().includes(q.toLowerCase()) || (p.product_name || '').toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []
  return (
    <div className="relative">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search product / SKU…" className="w-full bg-white border border-[#E4E6EE] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
      {matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-52 overflow-auto bg-white border border-[#E4E6EE] rounded-lg shadow-xl">
          {matches.map(p => (
            <button key={p.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onPick(p); setQ('') }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50">
              <span className="font-mono text-emerald-600">{p.sku}</span> <span className="text-gray-700">{p.product_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ContainersPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [containers, setContainers] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [tickets, setTickets] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [ticketView, setTicketView] = useState<any | null>(null)
  const [builder, setBuilder] = useState<{ type: 'pull' | 'add'; containerId: string } | null>(null)
  const [showTickets, setShowTickets] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: c }, { data: it }, { data: tk }, { data: p }] = await Promise.all([
      sb.from('containers').select('*').order('position', { nullsFirst: false }),
      sb.from('container_items').select('*').order('position', { nullsFirst: false }),
      sb.from('container_tickets').select('*, lines:container_ticket_lines(*)').order('created_at', { ascending: false }),
      sb.from('products').select('id,sku,product_name,unit_of_measure').eq('is_active', true).order('sku').limit(3000),
    ])
    setContainers(c || []); setItems(it || []); setTickets(tk || []); setProducts(p || []); setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const itemsOf = (cid: string) => items.filter(i => i.container_id === cid)
  const containerById = (cid: string | null) => containers.find(c => c.id === cid)
  const openTickets = tickets.filter(t => t.status === 'open')

  async function addItem(cid: string, obj: any) {
    const { data } = await sb.from('container_items').insert({ container_id: cid, ...obj }).select('*').single()
    if (data) setItems(x => [...x, data])
  }
  async function updateItem(id: string, obj: any) {
    setItems(x => x.map(i => i.id === id ? { ...i, ...obj } : i))
    await sb.from('container_items').update({ ...obj, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function removeItem(id: string) {
    setItems(x => x.filter(i => i.id !== id))
    await sb.from('container_items').delete().eq('id', id)
  }
  async function renameContainer(id: string, patch: any) {
    setContainers(x => x.map(c => c.id === id ? { ...c, ...patch } : c))
    await sb.from('containers').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function createTicket(type: 'pull' | 'add', containerId: string, lines: any[], note: string) {
    const clean = lines.filter(l => (l.item_name || l.product_id) && num(l.quantity) > 0)
    if (clean.length === 0) { alert('Add at least one item with a quantity.'); return }
    const { data: t, error } = await sb.from('container_tickets').insert({ type, container_id: containerId, note: note || null, created_by: userEmail || null }).select('*').single()
    if (error || !t) { alert('Could not create ticket: ' + (error?.message || '')); return }
    await sb.from('container_ticket_lines').insert(clean.map(l => ({ ticket_id: t.id, source: l.source, product_id: l.product_id || null, item_name: l.item_name || null, sku: l.sku || null, uom: l.uom || null, quantity: num(l.quantity) })))
    await load()
    const { data: full } = await sb.from('container_tickets').select('*, lines:container_ticket_lines(*)').eq('id', t.id).single()
    setBuilder(null); setTicketView(full)
  }
  async function completeTicket(id: string) {
    await sb.rpc('complete_container_ticket', { p_ticket: id, p_by: userEmail || null })
    await load()
    const { data: full } = await sb.from('container_tickets').select('*, lines:container_ticket_lines(*)').eq('id', id).single()
    setTicketView(full)
  }
  async function cancelTicket(id: string) {
    if (!confirm('Cancel this ticket?')) return
    await sb.from('container_tickets').update({ status: 'cancelled' }).eq('id', id)
    await load(); setTicketView(null)
  }

  async function printTicket(t: any) {
    const link = `${location.origin}/t/${t.token}`
    let qr = ''
    try { const m: any = await import('qrcode'); qr = await m.toDataURL(link, { width: 260, margin: 1 }) } catch (e) { /* */ }
    const cname = containerById(t.container_id)?.name || ''
    const rows = (t.lines || []).map((l: any) => `<tr><td class="cb"></td><td>${esc(l.item_name || l.sku || 'Item')}${(l.sku && l.item_name) ? ` <span class="muted">${esc(l.sku)}</span>` : ''}</td><td class="r">${num(l.quantity)}</td><td>${esc(l.uom || '')}</td></tr>`).join('')
    const color = t.type === 'pull' ? '#df2f4a' : '#00854a'
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.ticket_no)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:26px}h1{font-size:22px;margin:0}.sub{color:#555;margin:4px 0 14px;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#eee}.cb{width:30px;height:36px}.r{text-align:right}.muted{color:#888}.badge{display:inline-block;padding:3px 12px;border-radius:999px;color:#fff;font-weight:bold;font-size:12px;background:${color}}.qr{margin-top:22px;display:flex;gap:16px;align-items:center}.qr .lnk{font-size:12px;color:#333;word-break:break-all}.note{margin-top:10px;font-size:13px;color:#333}@media print{.noprint{display:none}}</style></head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1>${t.type === 'pull' ? 'PULL' : 'ADD'} Ticket</h1><div class="sub"><span class="badge">${esc(t.ticket_no)}</span> &nbsp; Container <b>${esc(cname)}</b> &nbsp; · &nbsp; ${new Date(t.created_at).toLocaleString()}</div></div><div style="text-align:right;font-size:12px;color:#666">beyondGREEN biotech, Inc.<br>Containers</div></div>
<table><thead><tr><th style="width:30px">✓</th><th>Item</th><th class="r" style="width:70px">Qty</th><th style="width:70px">UOM</th></tr></thead><tbody>${rows}</tbody></table>
${t.note ? `<div class="note"><b>Note:</b> ${esc(t.note)}</div>` : ''}
<div class="qr"><img src="${qr}" width="150" height="150" alt="QR"/><div><div style="font-weight:bold;margin-bottom:4px">Confirm on your phone</div><div class="lnk">Scan the QR or open:<br>${esc(link)}</div></div></div>
<div class="noprint" style="margin-top:20px"><button onclick="window.print()" style="padding:8px 16px;font-size:14px">Print</button></div>
</body></html>`
    const w = window.open('', '_blank', 'width=560,height=800'); if (!w) { alert('Allow pop-ups to print the ticket.'); return }
    w.document.write(html); w.document.close()
  }

  const totalItems = items.length
  const totalQty = items.reduce((a, i) => a + num(i.quantity), 0)

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag">📦 Containers</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Containers — Yard</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${containers.length} × 40' containers · ${totalItems} item lines · ${totalQty.toLocaleString()} units`}</p>
        </div>
        <button onClick={() => setShowTickets(true)} className="mon-btn !bg-[#3B6FE0]">Tickets{openTickets.length ? ` · ${openTickets.length} open` : ''}</button>
      </div>

      {/* Yard top-view */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {containers.map(c => {
          const its = itemsOf(c.id)
          const qty = its.reduce((a, i) => a + num(i.quantity), 0)
          const open = tickets.filter(t => t.container_id === c.id && t.status === 'open').length
          const fill = Math.min(100, its.length * 12)
          return (
            <button key={c.id} onClick={() => setOpenId(c.id)} className="text-left group">
              <div className="rounded-xl border-2 border-[#c9cfda] bg-gradient-to-b from-[#eef1f6] to-[#dfe4ec] shadow-sm hover:shadow-md hover:border-[#3B6FE0] transition-all overflow-hidden">
                {/* container "roof" */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#3B6FE0] text-white">
                  <span className="font-extrabold tracking-wide">{c.name}</span>
                  <span className="text-[11px] font-semibold bg-white/20 rounded-full px-2 py-0.5">40&#39;</span>
                </div>
                {/* corrugated body */}
                <div className="px-4 py-4" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#e6eaf1 0px,#e6eaf1 6px,#dbe0e9 6px,#dbe0e9 12px)' }}>
                  {c.label ? <p className="text-xs text-gray-600 mb-2 truncate">{c.label}</p> : null}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-3xl font-black text-[#1A1D2E] leading-none">{its.length}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">item lines</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-[#1A1D2E] leading-none">{qty.toLocaleString()}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">units</p>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-white/70 overflow-hidden"><div className="h-full bg-[#00854a]" style={{ width: fill + '%' }} /></div>
                  {open ? <p className="mt-2 text-[11px] font-semibold text-[#df2f4a]">● {open} open ticket{open > 1 ? 's' : ''}</p> : null}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {openId && <ContainerModal
        container={containerById(openId)}
        items={itemsOf(openId)}
        products={products}
        onClose={() => setOpenId(null)}
        onAdd={(obj: any) => addItem(openId, obj)}
        onUpdate={updateItem}
        onRemove={removeItem}
        onRename={(patch: any) => renameContainer(openId, patch)}
        onPull={() => { setBuilder({ type: 'pull', containerId: openId }) }}
        onAddTicket={() => { setBuilder({ type: 'add', containerId: openId }) }}
      />}

      {builder && <TicketBuilder
        type={builder.type}
        container={containerById(builder.containerId)}
        items={itemsOf(builder.containerId)}
        products={products}
        onClose={() => setBuilder(null)}
        onCreate={(lines: any[], note: string) => createTicket(builder.type, builder.containerId, lines, note)}
      />}

      {ticketView && <TicketViewModal
        ticket={ticketView}
        container={containerById(ticketView.container_id)}
        onClose={() => setTicketView(null)}
        onPrint={() => printTicket(ticketView)}
        onComplete={() => completeTicket(ticketView.id)}
        onCancel={() => cancelTicket(ticketView.id)}
      />}

      {showTickets && <TicketsPanel tickets={tickets} containers={containers} onClose={() => setShowTickets(false)} onOpen={(t: any) => { setShowTickets(false); setTicketView(t) }} />}
    </div>
  )
}

// ─────────── Container detail ───────────
function ContainerModal({ container, items, products, onClose, onAdd, onUpdate, onRemove, onRename, onPull, onAddTicket }: any) {
  const [mode, setMode] = useState<'inventory' | 'manual'>('inventory')
  const [manualName, setManualName] = useState('')
  const [qty, setQty] = useState('')
  const [uom, setUom] = useState('')
  const [picked, setPicked] = useState<any | null>(null)
  if (!container) return null
  const qtyNum = Number(qty) || 0
  function submit() {
    if (mode === 'inventory') {
      if (!picked || qtyNum <= 0) return
      onAdd({ source: 'inventory', product_id: picked.id, item_name: picked.product_name, sku: picked.sku, uom: uom || picked.unit_of_measure || null, quantity: qtyNum })
    } else {
      if (!manualName.trim() || qtyNum <= 0) return
      onAdd({ source: 'manual', item_name: manualName.trim(), uom: uom || null, quantity: qtyNum })
    }
    setPicked(null); setManualName(''); setQty(''); setUom('')
  }
  const total = items.reduce((a: number, i: any) => a + (Number(i.quantity) || 0), 0)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} >
      <div className="relative w-full max-w-[720px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 bg-[#3B6FE0] text-white">
          <div className="min-w-0">
            <input defaultValue={container.name} onBlur={e => e.target.value.trim() && e.target.value !== container.name && onRename({ name: e.target.value.trim() })} className="bg-transparent text-xl font-bold outline-none border-b border-transparent focus:border-white/60 w-40" />
            <input defaultValue={container.label || ''} placeholder="Add a description…" onBlur={e => onRename({ label: e.target.value.trim() || null })} className="block bg-transparent text-xs text-white/80 outline-none border-b border-transparent focus:border-white/40 mt-1 w-full placeholder-white/50" />
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Contents · {items.length} lines · {total.toLocaleString()} units</p>
            <div className="flex gap-2">
              <button onClick={onPull} className="text-xs px-3 py-1.5 rounded-lg bg-[#df2f4a] text-white font-semibold hover:opacity-90">Create Pull Ticket</button>
              <button onClick={onAddTicket} className="text-xs px-3 py-1.5 rounded-lg bg-[#00854a] text-white font-semibold hover:opacity-90">Create Add Ticket</button>
            </div>
          </div>
          <div className="border border-[#EEF0F4] rounded-lg overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2 w-[90px]">Source</th><th className="text-right px-3 py-2 w-[90px]">Qty</th><th className="text-left px-3 py-2 w-[70px]">UOM</th><th className="w-8" /></tr></thead>
              <tbody className="divide-y divide-[#EEF0F4]">
                {items.map((i: any) => (
                  <tr key={i.id} className="group">
                    <td className="px-3 py-2"><span className="text-gray-800">{i.item_name || '—'}</span>{i.sku ? <span className="ml-1 font-mono text-[11px] text-gray-400">{i.sku}</span> : null}</td>
                    <td className="px-3 py-2"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${i.source === 'inventory' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{i.source === 'inventory' ? 'Inventory' : 'Manual'}</span></td>
                    <td className="px-3 py-2 text-right"><input defaultValue={i.quantity} onBlur={e => onUpdate(i.id, { quantity: Number(e.target.value) || 0 })} className="w-16 text-right bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none" /></td>
                    <td className="px-3 py-2"><input defaultValue={i.uom || ''} onBlur={e => onUpdate(i.id, { uom: e.target.value.trim() || null })} className="w-14 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none text-xs" /></td>
                    <td className="px-2 text-center"><button onClick={() => onRemove(i.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100">&times;</button></td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-xs">Empty container — add items below.</td></tr>}
              </tbody>
            </table>
          </div>
          {/* add row */}
          <div className="bg-[#F9FAFB] border border-[#E4E6EE] rounded-lg p-3">
            <div className="inline-flex rounded-lg border border-[#E4E6EE] p-0.5 mb-2 bg-white">
              <button onClick={() => setMode('inventory')} className={`text-xs px-3 py-1 rounded-md ${mode === 'inventory' ? 'bg-[#00854a] text-white' : 'text-gray-500'}`}>From inventory</button>
              <button onClick={() => setMode('manual')} className={`text-xs px-3 py-1 rounded-md ${mode === 'manual' ? 'bg-amber-500 text-white' : 'text-gray-500'}`}>Manual item</button>
            </div>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                {mode === 'inventory'
                  ? (picked ? <div className="flex items-center gap-2 bg-white border border-[#E4E6EE] rounded px-2 py-1.5 text-xs"><span className="font-mono text-emerald-600">{picked.sku}</span><span className="truncate">{picked.product_name}</span><button onClick={() => setPicked(null)} className="ml-auto text-gray-400">&times;</button></div> : <ProductPicker products={products} onPick={setPicked} />)
                  : <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Item name (e.g. Straw machine motor)" className="w-full bg-white border border-[#E4E6EE] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />}
              </div>
              <input value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty" inputMode="decimal" className="w-20 bg-white border border-[#E4E6EE] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <input value={uom} onChange={e => setUom(e.target.value)} placeholder="UOM" className="w-20 bg-white border border-[#E4E6EE] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={submit} className="text-xs px-3 py-1.5 rounded-lg bg-[#3B6FE0] text-white font-semibold whitespace-nowrap">Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────── Ticket builder ───────────
function TicketBuilder({ type, container, items, products, onClose, onCreate }: any) {
  const [note, setNote] = useState('')
  const [pullSel, setPullSel] = useState<Record<string, string>>({})
  const [addLines, setAddLines] = useState<any[]>([{ _k: Math.random(), source: 'inventory', product_id: null, item_name: '', sku: '', uom: '', quantity: '' }])
  const isPull = type === 'pull'
  function buildLines(): any[] {
    if (isPull) {
      return items.filter((i: any) => Number(pullSel[i.id]) > 0).map((i: any) => ({ source: i.source, product_id: i.product_id, item_name: i.item_name, sku: i.sku, uom: i.uom, quantity: Number(pullSel[i.id]) }))
    }
    return addLines.map(l => ({ source: l.source, product_id: l.product_id, item_name: l.item_name, sku: l.sku, uom: l.uom, quantity: l.quantity }))
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.55)' }} >
      <div className="relative w-full max-w-[620px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 text-white" style={{ background: isPull ? '#df2f4a' : '#00854a' }}>
          <h2 className="text-lg font-bold">{isPull ? 'Pull' : 'Add'} Ticket · {container?.name}</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {isPull ? (
            <>
              <p className="text-xs text-gray-500">Select what to pull and how many.</p>
              {items.length === 0 && <p className="text-sm text-gray-400">This container has no items.</p>}
              {items.map((i: any) => (
                <div key={i.id} className="flex items-center gap-3 border border-[#EEF0F4] rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0"><span className="text-sm text-gray-800">{i.item_name}</span>{i.sku ? <span className="ml-1 font-mono text-[11px] text-gray-400">{i.sku}</span> : null}<span className="ml-2 text-[11px] text-gray-400">in container: {i.quantity} {i.uom || ''}</span></div>
                  <input value={pullSel[i.id] ?? ''} onChange={e => setPullSel(s => ({ ...s, [i.id]: e.target.value }))} placeholder="0" inputMode="decimal" className="w-20 text-right bg-white border border-[#E4E6EE] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">List the items being added to {container?.name}.</p>
              {addLines.map((l, idx) => (
                <div key={l._k} className="flex gap-2 items-start border border-[#EEF0F4] rounded-lg p-2">
                  <div className="flex-1 space-y-1">
                    <div className="inline-flex rounded border border-[#E4E6EE] p-0.5 bg-white text-[11px]">
                      <button onClick={() => setAddLines(a => a.map((x, i) => i === idx ? { ...x, source: 'inventory' } : x))} className={`px-2 py-0.5 rounded ${l.source === 'inventory' ? 'bg-[#00854a] text-white' : 'text-gray-500'}`}>Inventory</button>
                      <button onClick={() => setAddLines(a => a.map((x, i) => i === idx ? { ...x, source: 'manual' } : x))} className={`px-2 py-0.5 rounded ${l.source === 'manual' ? 'bg-amber-500 text-white' : 'text-gray-500'}`}>Manual</button>
                    </div>
                    {l.source === 'inventory'
                      ? (l.product_id ? <div className="flex items-center gap-2 bg-white border border-[#E4E6EE] rounded px-2 py-1 text-xs"><span className="font-mono text-emerald-600">{l.sku}</span><span className="truncate">{l.item_name}</span><button onClick={() => setAddLines(a => a.map((x, i) => i === idx ? { ...x, product_id: null, item_name: '', sku: '' } : x))} className="ml-auto text-gray-400">&times;</button></div>
                        : <ProductPicker products={products} onPick={(p: any) => setAddLines(a => a.map((x, i) => i === idx ? { ...x, product_id: p.id, item_name: p.product_name, sku: p.sku, uom: x.uom || p.unit_of_measure || '' } : x))} />)
                      : <input value={l.item_name} onChange={e => setAddLines(a => a.map((x, i) => i === idx ? { ...x, item_name: e.target.value } : x))} placeholder="Item name" className="w-full bg-white border border-[#E4E6EE] rounded px-2 py-1 text-xs" />}
                  </div>
                  <input value={l.quantity} onChange={e => setAddLines(a => a.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} placeholder="Qty" inputMode="decimal" className="w-16 bg-white border border-[#E4E6EE] rounded px-2 py-1 text-xs" />
                  <input value={l.uom} onChange={e => setAddLines(a => a.map((x, i) => i === idx ? { ...x, uom: e.target.value } : x))} placeholder="UOM" className="w-16 bg-white border border-[#E4E6EE] rounded px-2 py-1 text-xs" />
                  <button onClick={() => setAddLines(a => a.filter((_, i) => i !== idx))} className="text-gray-300 hover:text-red-500 pt-1">&times;</button>
                </div>
              ))}
              <button onClick={() => setAddLines(a => [...a, { _k: Math.random(), source: 'inventory', product_id: null, item_name: '', sku: '', uom: '', quantity: '' }])} className="text-xs text-[#3B6FE0] font-semibold">+ Add another item</button>
            </>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note for the warehouse (optional)" className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
        </div>
        <div className="px-6 py-3 border-t border-[#E4E6EE] flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
          <button onClick={() => onCreate(buildLines(), note)} className="text-sm px-4 py-2 rounded-lg text-white font-semibold" style={{ background: isPull ? '#df2f4a' : '#00854a' }}>Create ticket &amp; print</button>
        </div>
      </div>
    </div>
  )
}

// ─────────── Ticket view (QR + print) ───────────
function TicketViewModal({ ticket, container, onClose, onPrint, onComplete, onCancel }: any) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/t/${ticket.token}` : ''
  const isPull = ticket.type === 'pull'
  const done = (ticket.lines || []).filter((l: any) => l.done).length
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.55)' }} >
      <div className="relative w-full max-w-[560px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 text-white" style={{ background: isPull ? '#df2f4a' : '#00854a' }}>
          <div>
            <p className="text-white/80 text-xs">{isPull ? 'Pull' : 'Add'} Ticket · {container?.name}</p>
            <h2 className="text-lg font-bold">{ticket.ticket_no}</h2>
          </div>
          <span className="text-[11px] font-bold bg-white/20 rounded-full px-2.5 py-1 uppercase">{ticket.status}</span>
        </div>
        <div className="px-6 py-4">
          <div className="border border-[#EEF0F4] rounded-lg overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2 w-[70px]">Qty</th><th className="px-3 py-2 w-[60px]">Done</th></tr></thead>
              <tbody className="divide-y divide-[#EEF0F4]">
                {(ticket.lines || []).map((l: any) => (
                  <tr key={l.id}><td className="px-3 py-2">{l.item_name || l.sku}{l.sku && l.item_name ? <span className="ml-1 font-mono text-[11px] text-gray-400">{l.sku}</span> : null}</td><td className="px-3 py-2 text-right">{Number(l.quantity)} {l.uom || ''}</td><td className="px-3 py-2 text-center">{l.done ? <span className="text-emerald-600">✓</span> : <span className="text-gray-300">—</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {ticket.note ? <p className="text-sm text-gray-600 mb-3"><span className="font-semibold">Note:</span> {ticket.note}</p> : null}
          {ticket.status !== 'completed' && (
            <div className="flex items-center gap-4 bg-[#F9FAFB] border border-[#E4E6EE] rounded-lg p-3 mb-3">
              <QR url={link} size={120} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1A1D2E]">Send to the warehouse</p>
                <p className="text-xs text-gray-500 mt-0.5">Print the ticket, or have them scan this QR on their phone to confirm items as they pull/add. {done ? `(${done}/${(ticket.lines || []).length} confirmed)` : ''}</p>
                <p className="text-[11px] text-gray-400 break-all mt-1">{link}</p>
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            {ticket.status !== 'completed' && <button onClick={onCancel} className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-500">Cancel ticket</button>}
            <button onClick={onPrint} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-700 font-semibold">Print</button>
            {ticket.status !== 'completed'
              ? <button onClick={onComplete} className="text-sm px-4 py-2 rounded-lg bg-[#3B6FE0] text-white font-semibold">Mark complete &amp; update container</button>
              : <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg bg-[#3B6FE0] text-white font-semibold">Done</button>}
          </div>
          {ticket.status === 'completed' && <p className="text-xs text-emerald-600 mt-2 text-right">Completed — container contents updated.</p>}
        </div>
      </div>
    </div>
  )
}

// ─────────── Tickets list ───────────
function TicketsPanel({ tickets, containers, onClose, onOpen }: any) {
  const cname = (id: string) => containers.find((c: any) => c.id === id)?.name || ''
  const hex: Record<string, string> = { open: '#fdab3d', completed: '#00c875', cancelled: '#9699a6' }
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} >
      <div className="relative w-full max-w-[640px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E6EE]"><h2 className="text-lg font-semibold text-[#1A1D2E]">Pull / Add Tickets</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button></div>
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-[#EEF0F4]">
          {tickets.length === 0 && <p className="px-6 py-6 text-sm text-gray-400 text-center">No tickets yet.</p>}
          {tickets.map((t: any) => (
            <button key={t.id} onClick={() => onOpen(t)} className="w-full text-left px-6 py-3 hover:bg-[#F6F8FB] flex items-center gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded text-white" style={{ background: t.type === 'pull' ? '#df2f4a' : '#00854a' }}>{t.type === 'pull' ? 'PULL' : 'ADD'}</span>
              <span className="font-mono text-sm text-gray-700">{t.ticket_no}</span>
              <span className="text-xs text-gray-500">{cname(t.container_id)}</span>
              <span className="text-[11px] text-gray-400 ml-auto">{new Date(t.created_at).toLocaleDateString()}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white uppercase" style={{ background: hex[t.status] || '#9699a6' }}>{t.status}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
