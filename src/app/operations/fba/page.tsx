'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Row {
  id: string; name: string | null; channel: string | null; status: string | null; ship_date: string | null
  inbound_shipment_id: string | null; quantity_requested: number | null; quantity_shipped: number | null
  comments: string | null; position: number | null
}

// Status labels + colors mirror the Monday.com FBA/WFS board.
const STATUSES = [
  { label: 'Ready to Ship', hex: '#00c875' },
  { label: 'Pallet Prep', hex: '#cab641' },
  { label: 'Waiting LTL Pickup', hex: '#333333' },
  { label: 'Shipped', hex: '#037f4c' },
  { label: 'HOLD', hex: '#579bfc' },
  { label: 'Low Stock', hex: '#fdab3d' },
  { label: 'Out of Stock', hex: '#df2f4a' },
  { label: 'Inactive SKU', hex: '#9d50dd' },
]
const statusHex = (s: string | null) => STATUSES.find(x => x.label === s)?.hex || '#c4c4c4'
const GROUPS = [
  { key: 'FBA Shipments', color: '#0086C0' },
  { key: 'WFS Shipment', color: '#A25DDC' },
  { key: 'Shipped', color: '#00A84F' },
]

export default function FbaBoard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [edit, setEdit] = useState<{ id: string; field: string } | null>(null)
  const [statusOpen, setStatusOpen] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('fba_shipments').select('*').order('position', { ascending: true, nullsFirst: false })
    setRows((data as Row[]) || [])
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const match = (r: Row) => !q || [r.name, r.inbound_shipment_id, r.status, r.comments].some(v => (v || '').toLowerCase().includes(q))
  const groupRows = (key: string) => rows.filter(r => (r.channel || '') === key && match(r)).sort((a, b) => (a.position || 0) - (b.position || 0))
  const extraGroups = Array.from(new Set(rows.map(r => r.channel || '').filter(k => k && !GROUPS.some(g => g.key === k))))
  const allGroups = [...GROUPS, ...extraGroups.map(k => ({ key: k, color: '#9CA3AF' }))]

  async function patch(id: string, obj: Partial<Row>) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    await sb.from('fba_shipments').update({ ...obj, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function addItem(channel: string) {
    const max = Math.max(0, ...rows.filter(r => r.channel === channel).map(r => r.position || 0))
    const { data } = await sb.from('fba_shipments').insert({ channel, name: '', status: null, position: max + 1000 }).select('*').single()
    if (data) { setRows(rs => [...rs, data as Row]); setEdit({ id: (data as any).id, field: 'name' }) }
  }
  async function del(id: string) {
    if (!confirm('Delete this item?')) return
    setRows(rs => rs.filter(r => r.id !== id))
    await sb.from('fba_shipments').delete().eq('id', id)
  }
  function onDrop(targetChannel: string, beforeId: string | null) {
    const id = dragId.current; dragId.current = null; setDropHint(null)
    if (!id) return
    const list = rows.filter(r => r.channel === targetChannel && r.id !== id).sort((a, b) => (a.position || 0) - (b.position || 0))
    let idx = beforeId ? list.findIndex(r => r.id === beforeId) : list.length
    if (idx < 0) idx = list.length
    const prev = list[idx - 1]?.position, next = list[idx]?.position
    let pos: number
    if (prev != null && next != null) pos = (prev + next) / 2
    else if (prev != null) pos = prev + 1000
    else if (next != null) pos = next - 1000
    else pos = 1000
    patch(id, { channel: targetChannel, position: pos })
  }

  const inp = 'w-full bg-white border border-[#0086C0] rounded px-2 py-1 text-[13px] focus:outline-none'
  const cellCls = 'px-2 py-2 text-[13px] text-[#1A1D2E] align-middle'

  // ── editable cell renderers ──
  const TextCell = ({ r, field, mono, ph }: { r: Row; field: keyof Row; mono?: boolean; ph?: string }) => {
    const editing = edit?.id === r.id && edit?.field === field
    const val = (r as any)[field]
    if (editing) return <input autoFocus defaultValue={val ?? ''} onBlur={e => { patch(r.id, { [field]: e.target.value.trim() || null } as any); setEdit(null) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null) }} className={inp} />
    return <div onClick={() => setEdit({ id: r.id, field })} className={`cursor-text min-h-[22px] rounded px-1 hover:bg-[#F0F4F9] ${mono ? 'font-mono text-xs' : ''}`}>{val || <span className="text-gray-300">{ph || '+'}</span>}</div>
  }
  const NumCell = ({ r, field }: { r: Row; field: keyof Row }) => {
    const editing = edit?.id === r.id && edit?.field === field
    const val = (r as any)[field]
    if (editing) return <input type="number" autoFocus defaultValue={val ?? ''} onBlur={e => { patch(r.id, { [field]: e.target.value === '' ? null : Number(e.target.value) } as any); setEdit(null) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null) }} className={inp + ' text-right'} />
    return <div onClick={() => setEdit({ id: r.id, field })} className="cursor-text min-h-[22px] rounded px-1 text-right hover:bg-[#F0F4F9] tabular-nums">{val == null ? <span className="text-gray-300">+</span> : Number(val).toLocaleString()}</div>
  }
  const DateCell = ({ r }: { r: Row }) => {
    const editing = edit?.id === r.id && edit?.field === 'ship_date'
    if (editing) return <input type="date" autoFocus defaultValue={r.ship_date ?? ''} onBlur={e => { patch(r.id, { ship_date: e.target.value || null }); setEdit(null) }} onKeyDown={e => { if (e.key === 'Escape') setEdit(null) }} className={inp} />
    return <div onClick={() => setEdit({ id: r.id, field: 'ship_date' })} className="cursor-text min-h-[22px] rounded px-1 hover:bg-[#F0F4F9]">{r.ship_date ? new Date(r.ship_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="text-gray-300">+</span>}</div>
  }
  const StatusCell = ({ r }: { r: Row }) => (
    <div className="relative">
      <button onClick={() => setStatusOpen(statusOpen === r.id ? null : r.id)} className="w-full text-white text-[12px] font-semibold rounded px-2 py-1.5 text-center truncate" style={{ background: r.status ? statusHex(r.status) : '#c4c4c4' }}>{r.status || '—'}</button>
      {statusOpen === r.id && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(null)} />
          <div className="absolute z-20 mt-1 left-0 w-48 bg-white rounded-lg shadow-xl border border-[#E4E6EE] p-1">
            {STATUSES.map(s => <button key={s.label} onClick={() => { patch(r.id, { status: s.label }); setStatusOpen(null) }} className="block w-full text-white text-[12px] font-semibold rounded px-2 py-1.5 mb-1 text-center" style={{ background: s.hex }}>{s.label}</button>)}
            <button onClick={() => { patch(r.id, { status: null }); setStatusOpen(null) }} className="block w-full text-gray-500 text-[12px] rounded px-2 py-1.5 hover:bg-gray-100">Clear</button>
          </div>
        </>
      )}
    </div>
  )

  const cols = [
    { h: 'Item', w: 'min-w-[260px]' }, { h: 'Status', w: 'w-[150px]' }, { h: 'Ship Date', w: 'w-[120px]' },
    { h: 'Inbound Shipment ID', w: 'w-[170px]' }, { h: 'Qty Requested', w: 'w-[110px]' }, { h: 'Qty Shipped', w: 'w-[110px]' },
    { h: 'Comments', w: 'min-w-[160px]' },
  ]

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#F5F6FA' }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-[11px] font-semibold text-orange-600 uppercase tracking-widest">FULFILLMENT</p>
          <h1 className="text-2xl font-bold text-[#1A1D2E]">FBA / WFS</h1>
          <p className="text-gray-500 text-xs">{loading ? 'Loading…' : `${rows.length} items`}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg pl-9 pr-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-[#0086C0]/30" />
          </div>
          <button onClick={() => addItem('FBA Shipments')} className="text-sm px-3 py-2 rounded-lg bg-[#0086C0] text-white hover:bg-[#0074a6] font-medium whitespace-nowrap">+ New item</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-6">
          {allGroups.map(group => {
            const gr = groupRows(group.key)
            const isCol = collapsed[group.key]
            const totReq = gr.reduce((a, r) => a + (r.quantity_requested || 0), 0)
            const totShip = gr.reduce((a, r) => a + (r.quantity_shipped || 0), 0)
            return (
              <div key={group.key}>
                <div className="flex items-center gap-2 mb-1" onDragOver={e => { e.preventDefault(); setDropHint(group.key) }} onDrop={() => onDrop(group.key, null)}>
                  <button onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))} className="text-gray-400 hover:text-gray-700 w-5"><i className={`ti ti-chevron-${isCol ? 'right' : 'down'}`} /></button>
                  <span className="font-bold text-[15px]" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-xs text-gray-400">{gr.length}</span>
                </div>
                {!isCol && (
                  <div className="rounded-lg overflow-x-auto bg-white shadow-sm" style={{ borderLeft: `4px solid ${group.color}`, border: '1px solid #E4E6EE', borderLeftWidth: 4 }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400">
                          <th className="w-6" />
                          {cols.map(c => <th key={c.h} className={`text-left font-semibold px-2 py-2 ${c.w}`}>{c.h}</th>)}
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {gr.map(r => (
                          <tr key={r.id} className="hover:bg-[#FAFBFC] group/row" onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, r.id)}>
                            <td className="text-center text-gray-300 group-hover/row:text-gray-500 cursor-grab" draggable onDragStart={() => { dragId.current = r.id }}><i className="ti ti-grip-vertical" /></td>
                            <td className={cellCls + ' font-medium'}><TextCell r={r} field="name" ph="Item name" /></td>
                            <td className="px-2 py-1.5 w-[150px]"><StatusCell r={r} /></td>
                            <td className={cellCls}><DateCell r={r} /></td>
                            <td className={cellCls}><TextCell r={r} field="inbound_shipment_id" mono ph="—" /></td>
                            <td className={cellCls}><NumCell r={r} field="quantity_requested" /></td>
                            <td className={cellCls}><NumCell r={r} field="quantity_shipped" /></td>
                            <td className={cellCls}><TextCell r={r} field="comments" ph="—" /></td>
                            <td className="text-center"><button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover/row:opacity-100"><i className="ti ti-trash text-sm" /></button></td>
                          </tr>
                        ))}
                        {gr.length === 0 && <tr><td colSpan={9} className="px-4 py-3 text-center text-gray-300 text-xs">Drop items here or add one below</td></tr>}
                        <tr>
                          <td />
                          <td colSpan={8} className="px-2 py-2"><button onClick={() => addItem(group.key)} className="text-[13px] text-gray-400 hover:text-[#0086C0]">+ Add item</button></td>
                        </tr>
                        {(totReq > 0 || totShip > 0) && (
                          <tr className="bg-[#FBFCFE] text-[12px] text-gray-500 font-semibold">
                            <td /><td className="px-2 py-1.5">Totals</td><td /><td />
                            <td className="px-2 py-1.5 text-right">{totReq.toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right">{totShip.toLocaleString()}</td>
                            <td colSpan={3} />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
