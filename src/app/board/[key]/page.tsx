'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { accentColor, statusColor } from '@/lib/statusColors'
import { Board, BoardColumn, BuilderConfig } from '@/lib/boards'
import Comments from '@/components/Comments'

interface Row { id: string; board_id: string; group_name: string | null; data: Record<string, any>; sort_order: number; created_at?: string }

const DEFAULT_COLS: BoardColumn[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'status', label: 'Status', type: 'status' },
  { key: 'notes', label: 'Notes', type: 'longtext' },
]

export default function DynamicBoardPage() {
  const params = useParams()
  const key = String(params?.key || '')
  const sb = useMemo(() => createSupabaseBrowserClient(), [])

  const [board, setBoard] = useState<Board | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [userEmail, setUserEmail] = useState('')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})
  const [grp, setGrp] = useState('')
  const [saving, setSaving] = useState(false)

  const cfg: BuilderConfig = useMemo(() => {
    const c = (board?.builder_config || {}) as BuilderConfig
    return { columns: c.columns?.length ? c.columns : DEFAULT_COLS, groups: c.groups?.length ? c.groups : ['Items'], primary: c.primary || (c.columns?.[0]?.key ?? 'name'), color: c.color || '#00A84F' }
  }, [board])
  const primaryKey = cfg.primary || 'name'

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [sb])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: b } = await sb.from('boards').select('*').eq('board_key', key).maybeSingle()
    if (!b) { setNotFound(true); setLoading(false); return }
    setBoard(b as Board)
    const { data: r } = await sb.from('custom_board_items').select('*').eq('board_id', (b as Board).id).order('sort_order', { ascending: true }).order('created_at', { ascending: true })
    setRows((r as Row[]) || [])
    setLoading(false)
  }, [sb, key])
  useEffect(() => { if (key) load() }, [key, load])

  const matches = (r: Row) => {
    const q = search.toLowerCase().trim(); if (!q) return true
    return Object.values(r.data || {}).some(v => String(v ?? '').toLowerCase().includes(q)) || (r.group_name || '').toLowerCase().includes(q)
  }
  const grouped = useMemo(() => {
    const m: Record<string, Row[]> = {}
    for (const g of cfg.groups) m[g] = []
    rows.filter(matches).forEach(r => { const g = r.group_name || cfg.groups[0] || 'Items'; (m[g] ||= []).push(r) })
    return Object.entries(m)
  }, [rows, search, cfg]) // eslint-disable-line

  function openEdit(r: Row) { setEditing(r); setForm({ ...(r.data || {}) }); setGrp(r.group_name || cfg.groups[0] || 'Items'); setOpen(true) }
  function openAdd(g?: string) { setEditing(null); setForm({}); setGrp(g || cfg.groups[0] || 'Items'); setOpen(true) }
  function close() { setOpen(false); setTimeout(() => { setEditing(null); setForm({}) }, 150) }

  async function save() {
    setSaving(true)
    if (editing?.id) await sb.from('custom_board_items').update({ data: form, group_name: grp, updated_at: new Date().toISOString() }).eq('id', editing.id)
    else { const { data } = await sb.from('custom_board_items').insert({ board_id: board!.id, data: form, group_name: grp, created_by: userEmail }).select('*').single(); if (data) setEditing(data as Row) }
    setSaving(false); await load()
    if (!editing?.id) close()
  }
  async function del() {
    if (!editing?.id) return
    if (!confirm('Delete this entry? This cannot be undone.')) return
    await sb.from('custom_board_items').delete().eq('id', editing.id); await load(); close()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A84F]/30'

  if (notFound) return <div className="min-h-screen mon-page flex items-center justify-center"><p className="text-gray-400 text-sm">This board doesn’t exist. It may have been deleted in the Dev Center.</p></div>

  const accent = cfg.color || accentColor(key).solid
  const secondaryCols = cfg.columns.filter(c => c.key !== primaryKey).slice(0, 3)

  return (
    <div className="min-h-screen mon-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag" style={{ background: accent + '1A', color: accent }}>{board?.label || 'Board'}</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">{board?.label || 'Board'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`} · Custom board</p>
        </div>
        <button onClick={() => openAdd()} className="mon-btn self-start" style={{ background: accent, borderColor: accent }}>+ New Entry</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search this board…" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A84F]/30" />
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-8">
          {grouped.map(([g, items]) => {
            const c = accentColor(g); const isColl = collapsed[g]
            return (
              <div key={g} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: c.solid + '14', borderLeft: '5px solid ' + c.solid }} onClick={() => setCollapsed(s => ({ ...s, [g]: !s[g] }))}>
                  <span className="text-[10px]" style={{ color: c.solid, transform: isColl ? 'none' : 'rotate(90deg)', display: 'inline-block' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: c.solid }}>{g}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: c.solid + '26', color: c.solid }}>{items.length}</span>
                  <button onClick={e => { e.stopPropagation(); openAdd(g) }} className="ml-auto text-xs text-gray-400 hover:text-[#1A1D2E]">+ Add</button>
                </div>
                {!isColl && (
                  <div className="divide-y divide-[#F4F5F8]">
                    {items.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">No entries yet.</p>}
                    {items.map(it => (
                      <div key={it.id} onClick={() => openEdit(it)} className="flex items-center gap-3 px-4 py-2.5 mon-row cursor-pointer">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1A1D2E] truncate">{String(it.data?.[primaryKey] ?? '(untitled)') || '(untitled)'}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {secondaryCols.map(col => it.data?.[col.key] ? `${col.label}: ${it.data[col.key]}` : '').filter(Boolean).join('  ·  ')}
                          </p>
                        </div>
                        {cfg.columns.some(c => c.type === 'status') && (() => {
                          const sc = cfg.columns.find(c => c.type === 'status'); const val = sc ? it.data?.[sc.key] : ''
                          if (!val) return null; const col = statusColor(String(val))
                          return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: col.bg, color: col.fg }}>{String(val)}</span>
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <div className="mon-backdrop" onClick={close}>
          <div className="mon-modal mon-pop" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="mon-modal-head" style={{ background: accent }}>
              <div className="min-w-0">
                <h2 className="text-lg truncate">{editing ? (form[primaryKey] || 'Entry') : 'New Entry'}</h2>
                <p className="text-white/80 text-xs mt-0.5">{board?.label}</p>
              </div>
              <button onClick={close} className="mon-modal-close" aria-label="Close">×</button>
            </div>
            <div className="mon-modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Group</label>
                  <select value={grp} onChange={e => setGrp(e.target.value)} className={inp}>
                    {cfg.groups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                {cfg.columns.map(col => (
                  <div key={col.key} className={col.type === 'longtext' ? 'col-span-2' : ''}>
                    <label className="block text-xs text-gray-500 mb-1">{col.label}</label>
                    {col.type === 'longtext'
                      ? <textarea rows={2} value={form[col.key] || ''} onChange={e => setForm(f => ({ ...f, [col.key]: e.target.value }))} className={inp + ' resize-none'} />
                      : <input type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'} value={form[col.key] || ''} onChange={e => setForm(f => ({ ...f, [col.key]: e.target.value }))} className={inp} />}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-4">
                {editing && <button onClick={del} className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100">Delete</button>}
                <button onClick={close} className="ml-auto text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E]">Cancel</button>
                <button onClick={save} disabled={saving} className="mon-btn !py-2" style={{ background: accent, borderColor: accent }}>{saving ? 'Saving…' : (editing ? 'Save' : 'Create Entry')}</button>
              </div>
              {editing?.id && (
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <Comments recordType={`board:${key}`} recordId={editing.id} currentUserEmail={userEmail} title="Comments & Activity" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
