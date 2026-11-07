'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { accentColor, statusColor } from '@/lib/statusColors'
import { Board, BoardColumn, BuilderConfig } from '@/lib/boards'
import Comments from '@/components/Comments'
import ItemHistory from '@/components/ItemHistory'
import FileUpload from '@/components/FileUpload'
import Link from 'next/link'
import ComplianceBoardPanel from '@/components/ComplianceBoardPanel'
import { RULE_BY_KEY, evaluateBoard, STATE_STYLE } from '@/lib/compliance'
import { useEmployees, directoryHref, peopleOf } from '@/lib/useEmployees'

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
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
  const [activeSites, setActiveSites] = useState<string[]>(['SNA'])
  const employees = useEmployees()
  const rule = RULE_BY_KEY[key]

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
    // File counts per entry (paperclip badge). Paged so large boards are counted fully.
    const counts: Record<string, number> = {}
    for (let from = 0; ; from += 1000) {
      const { data: f } = await sb.from('file_attachments').select('record_id').eq('record_type', `board:${key}`).range(from, from + 999)
      ;(f || []).forEach((x: any) => { counts[x.record_id] = (counts[x.record_id] || 0) + 1 })
      if (!f || f.length < 1000) break
    }
    setFileCounts(counts)
    if (RULE_BY_KEY[key]) {
      const { data: c } = await sb.from('erp_config').select('value').eq('key', 'compliance_active_sites').maybeSingle()
      if (c?.value) setActiveSites(String(c.value).split(',').map((x: string) => x.trim()).filter(Boolean))
    }
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
  function openAdd(g?: string, prefill?: Record<string, any>) { setEditing(null); setForm({ ...(prefill || {}) }); setGrp(g || cfg.groups[0] || 'Items'); setOpen(true) }
  function openById(id: string) { const r = rows.find(x => x.id === id); if (r) openEdit(r) }

  // Deep links: ?item=<id> opens an entry, ?new=1 opens a blank one
  const [deepDone, setDeepDone] = useState(false)
  useEffect(() => {
    if (deepDone || loading || !board) return
    const p = new URLSearchParams(window.location.search)
    const id = p.get('item'); if (id) openById(id)
    if (p.get('new')) openAdd()
    if (id || p.get('new')) window.history.replaceState({}, '', window.location.pathname)
    setDeepDone(true)
  }, [loading, board, deepDone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Due status per entry for compliance boards
  const dueById = useMemo(() => {
    const m: Record<string, string> = {}
    if (!rule) return m
    evaluateBoard(rule, board?.label || '', rows, fileCounts, activeSites).rows.forEach(r => { if (r.itemId && rule.mode === 'entry') m[r.itemId] = r.state })
    return m
  }, [rule, board, rows, fileCounts, activeSites])
  const statusOptions = useMemo(() => {
    const m: Record<string, string[]> = {}
    cfg.columns.filter(c => c.type === 'status').forEach(c => { m[c.key] = Array.from(new Set(rows.map(r => String(r.data?.[c.key] || '')).filter(Boolean))).sort() })
    return m
  }, [rows, cfg])
  function close() { setOpen(false); setTimeout(() => { setEditing(null); setForm({}) }, 150) }

  async function save() {
    setSaving(true)
    if (editing?.id) {
      const { error } = await sb.from('custom_board_items').update({ data: form, group_name: grp, updated_at: new Date().toISOString() }).eq('id', editing.id)
      if (error) { setSaving(false); alert('Could not save: ' + error.message); return }
    } else {
      const { data, error } = await sb.from('custom_board_items').insert({ board_id: board!.id, data: form, group_name: grp, created_by: userEmail }).select('*').single()
      if (error) { setSaving(false); alert('Could not save: ' + error.message); return }
      if (data) setEditing(data as Row)
    }
    setSaving(false); await load()
    if (!editing?.id) close()
  }
  async function del() {
    if (!editing?.id) return
    if (!confirm('Delete this entry? This cannot be undone.')) return
    const { error } = await sb.from('custom_board_items').delete().eq('id', editing.id)
    if (error) { alert('Could not delete: ' + error.message); return }
    await load(); close()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A84F]/30'

  if (notFound) return <div className="min-h-screen mon-page flex items-center justify-center"><p className="text-gray-400 text-sm">This board doesn’t exist. It may have been deleted in the Dev Center.</p></div>

  const accent = cfg.color || accentColor(key).solid
  const secondaryCols = cfg.columns.filter(c => c.key !== primaryKey).slice(0, 3)

  return (
    <div className="min-h-screen mon-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          {rule ? <Link href="/compliance" className="text-xs font-semibold text-emerald-700 hover:underline">&larr; Compliance Dashboard · {rule.program}</Link>
            : <span className="mon-tag" style={{ background: accent + '1A', color: accent }}>{board?.label || 'Board'}</span>}
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">{board?.label || 'Board'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`}{rule ? ` · ${rule.task}` : ''}</p>
        </div>
        <button onClick={() => openAdd()} className="mon-btn self-start" style={{ background: accent, borderColor: accent }}>+ New Entry</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search this board…" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A84F]/30" />
      </div>

      {!loading && rule && board && (
        <ComplianceBoardPanel rule={rule} label={board.label} rows={rows} fileCounts={fileCounts} activeSites={activeSites} onOpen={openById} onAdd={openAdd} />
      )}

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-8">
              <div className="mb-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — notes &amp; comments sync two-way across the record boards.</div>
                        {grouped.map(([g, items]) => {
            const c = accentColor(g); const isColl = collapsed[g]
            return (
              <div key={g} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + c.solid }} onClick={() => setCollapsed(s => ({ ...s, [g]: !s[g] }))}>
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
                          <p className="text-sm font-semibold text-[#1A1D2E] break-words">{String(it.data?.[primaryKey] ?? '(untitled)') || '(untitled)'}{it.data?.title && primaryKey !== 'title' ? <span className="font-normal text-gray-600"> · {String(it.data.title).slice(0, 120)}</span> : null}</p>
                          <p className="text-xs text-gray-500 break-words">
                            {secondaryCols.map(col => it.data?.[col.key] ? `${col.label}: ${it.data[col.key]}` : '').filter(Boolean).join('  ·  ')}
                          </p>
                        </div>
                        {rule && it.data?.site && !activeSites.includes(String(it.data.site)) ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: STATE_STYLE.archive.bg, color: STATE_STYLE.archive.fg }}>{String(it.data.site)} archive</span>
                          : rule && dueById[it.id] && dueById[it.id] !== 'ok' ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: STATE_STYLE[dueById[it.id] as keyof typeof STATE_STYLE].bg, color: STATE_STYLE[dueById[it.id] as keyof typeof STATE_STYLE].fg }}>{STATE_STYLE[dueById[it.id] as keyof typeof STATE_STYLE].label}</span> : null}
                        {fileCounts[it.id] ? <span className="text-[11px] text-gray-500 shrink-0 flex items-center gap-0.5" title="Attached files"><i className="ti ti-paperclip" />{fileCounts[it.id]}</span> : null}
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
        <div className="mon-backdrop" >
          <div className="mon-modal mon-pop" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="mon-modal-head" style={{ background: accent }}>
              <div className="min-w-0">
                <h2 className="text-lg truncate">{editing ? (form[primaryKey] || 'Entry') : 'New Entry'}</h2>
                <p className="text-white/80 text-xs mt-0.5">{board?.label}</p>
              </div>
              <button onClick={close} className="mon-modal-close" aria-label="Close">×</button>
            </div>
            <div className="mon-modal-body">
              <datalist id="board-employees">{employees.map(e => <option key={e.id} value={e.name}>{e.job_description || e.department || ''}</option>)}</datalist>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Group</label>
                  <select value={grp} onChange={e => setGrp(e.target.value)} className={inp}>
                    {cfg.groups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                {cfg.columns.map(col => (
                  <div key={col.key} className={col.type === 'longtext' ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs text-gray-500 mb-1">{col.label}</label>
                    {col.type === 'longtext'
                      ? <textarea rows={2} value={form[col.key] || ''} onChange={e => setForm(f => ({ ...f, [col.key]: e.target.value }))} className={inp + ' resize-none'} />
                      : col.type === 'person' ? <>
                          <input list="board-employees" placeholder="Pick from the Team Directory" value={form[col.key] || ''} onChange={e => setForm(f => ({ ...f, [col.key]: e.target.value }))} className={inp} />
                          {peopleOf(form[col.key]).length > 0 && <div className="flex flex-wrap gap-x-2 mt-1">{peopleOf(form[col.key]).map(n => <Link key={n} href={directoryHref(n)} className="text-[11px] text-[#0B6E99] hover:underline">{n}</Link>)}</div>}
                        </>
                      : col.type === 'status' ? <>
                          <input list={`status-${col.key}`} value={form[col.key] || ''} onChange={e => setForm(f => ({ ...f, [col.key]: e.target.value }))} className={inp} />
                          <datalist id={`status-${col.key}`}>{(statusOptions[col.key] || []).map(o => <option key={o} value={o} />)}</datalist>
                        </>
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
                  <p className="text-xs font-semibold text-gray-500 mb-2">Files</p>
                  <FileUpload supabase={sb} recordType={`board:${key}`} recordId={editing.id} currentUserEmail={userEmail} multiple />
                </div>
              )}
              {!editing?.id && <p className="text-xs text-gray-400 mt-3">Save the entry first, then you can attach files to it.</p>}
              {editing?.id && (
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <Comments recordType={`board:${key}`} recordId={editing.id} currentUserEmail={userEmail} title="Comments & Activity" />
                  <ItemHistory recordId={editing.id} recordType={`board:${key}`} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
