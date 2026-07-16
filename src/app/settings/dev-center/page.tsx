'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useBoards, groupBoards, GROUP_ORDER, boardsChanged, Board, BoardColumn } from '@/lib/boards'
import { accentColor } from '@/lib/statusColors'

const COL_TYPES: { v: BoardColumn['type']; label: string }[] = [
  { v: 'text', label: 'Text' }, { v: 'longtext', label: 'Long text' }, { v: 'number', label: 'Number' },
  { v: 'date', label: 'Date' }, { v: 'status', label: 'Status' }, { v: 'link', label: 'Link' }, { v: 'person', label: 'Person' },
]
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'

function Stat({ label, value, c }: { label: string; value: string | number; c?: string }) {
  return (
    <div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

export default function DevCenterPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const { boards, reload } = useBoards()
  const pwRef = useRef<HTMLInputElement>(null)

  const [unlocked, setUnlocked] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = sessionStorage.getItem('devcenter_pw')
    if (saved) { setPw(saved); setUnlocked(true) }
  }, [])

  async function tryUnlock(e: React.FormEvent) {
    e.preventDefault()
    const candidate = (pwRef.current?.value ?? pw).trim()
    if (!candidate) { setPwErr('Enter the password.'); return }
    setChecking(true); setPwErr('')
    const { data, error } = await sb.rpc('verify_vault_password', { pw: candidate })
    setChecking(false)
    if (!error && data === true) { setPw(candidate); setUnlocked(true); sessionStorage.setItem('devcenter_pw', candidate) }
    else setPwErr('Incorrect password.')
  }

  // ── Board builder state ──
  const [nLabel, setNLabel] = useState('')
  const [nIcon, setNIcon] = useState('ti-layout-board')
  const [nGroup, setNGroup] = useState('Business')
  const [nColor, setNColor] = useState('#00A84F')
  const [nGroups, setNGroups] = useState('Items')
  const [nCols, setNCols] = useState<{ label: string; type: BoardColumn['type'] }[]>([{ label: 'Name', type: 'text' }, { label: 'Status', type: 'status' }, { label: 'Notes', type: 'longtext' }])
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState('')

  async function createBoard() {
    if (!nLabel.trim()) { setMsg('Give the board a name.'); return }
    setCreating(true); setMsg('')
    const columns: BoardColumn[] = nCols.filter(c => c.label.trim()).map(c => ({ key: slug(c.label), label: c.label.trim(), type: c.type }))
    const groups = nGroups.split(',').map(s => s.trim()).filter(Boolean)
    const builder_config = { columns: columns.length ? columns : [{ key: 'name', label: 'Name', type: 'text' }], groups: groups.length ? groups : ['Items'], primary: (columns[0]?.key || 'name'), color: nColor }
    const { error } = await sb.rpc('create_board', { p_pw: pw, p_label: nLabel.trim(), p_icon: nIcon.trim() || 'ti-layout-board', p_nav_group: nGroup.trim() || 'Business', p_builder_config: builder_config })
    setCreating(false)
    if (error) { setMsg('Could not create board: ' + error.message); return }
    setMsg('Board created ✓'); setNLabel(''); boardsChanged(); reload()
  }

  // ── Manage boards ──
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const allGroups = useMemo(() => groupBoards(boards, { includeHidden: true }), [boards])
  const groupOptions = useMemo(() => Array.from(new Set([...GROUP_ORDER, ...boards.map(b => b.nav_group)])), [boards])
  const q = search.trim().toLowerCase()
  const shownGroups = useMemo(() => allGroups
    .map(s => ({ ...s, items: s.items.filter(b => !q || b.label.toLowerCase().includes(q) || b.nav_group.toLowerCase().includes(q)) }))
    .filter(s => s.items.length), [allGroups, q])

  async function meta(b: Board, patch: Partial<Board>) {
    const { error } = await sb.rpc('update_board_meta', {
      p_pw: pw, p_key: b.board_key,
      p_label: patch.label ?? b.label,
      p_icon: patch.icon ?? b.icon ?? null,
      p_nav_group: patch.nav_group ?? b.nav_group,
      p_sort_order: patch.sort_order ?? b.sort_order,
      p_is_hidden: patch.is_hidden ?? b.is_hidden ?? false,
    })
    if (!error) { boardsChanged(); reload() }
  }
  const groupKeys = (group: string) => (allGroups.find(g => g.group === group)?.items || []).map(b => b.board_key)
  // Rewrite the whole group's sort_order to sequential 0..n (deterministic — fixes duplicate/tied sort values),
  // and re-home any board dragged in from another group. One refresh at the end.
  async function persistOrder(group: string, orderedKeys: string[]) {
    for (let i = 0; i < orderedKeys.length; i++) {
      const b = boards.find(x => x.board_key === orderedKeys[i])
      if (!b) continue
      if (b.sort_order !== i || b.nav_group !== group) {
        await sb.rpc('update_board_meta', {
          p_pw: pw, p_key: b.board_key, p_label: b.label, p_icon: b.icon ?? null,
          p_nav_group: group, p_sort_order: i, p_is_hidden: b.is_hidden ?? false,
        })
      }
    }
    boardsChanged(); reload()
  }
  function moveBoard(group: string, idx: number, dir: -1 | 1) {
    const keys = groupKeys(group)
    const j = idx + dir; if (j < 0 || j >= keys.length) return
    const tmp = keys[idx]; keys[idx] = keys[j]; keys[j] = tmp
    persistOrder(group, keys)
  }
  function onDropRow(group: string, targetKey: string | null) {
    const from = dragKey; setDragKey(null); setDragOverKey(null)
    if (!from) return
    const keys = groupKeys(group).filter(k => k !== from)
    let to = targetKey ? keys.indexOf(targetKey) : keys.length
    if (to < 0) to = keys.length
    keys.splice(to, 0, from)
    persistOrder(group, keys)
  }
  async function removeBoard(b: Board) {
    if (!b.is_custom) return
    if (!confirm(`Delete the board "${b.label}"? Its entries will be removed. This cannot be undone.`)) return
    const { error } = await sb.rpc('delete_board', { p_pw: pw, p_key: b.board_key })
    if (!error) { boardsChanged(); reload() }
  }

  const inp = 'bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#A25DDC]/30'

  if (!unlocked) {
    return (
      <div className="min-h-screen mon-page flex items-center justify-center p-6">
        <form onSubmit={tryUnlock} className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#ECEEF3] overflow-hidden">
          <div className="mon-modal-head h-purple"><div><h2 className="text-lg">🛠️ Dev Center</h2><p className="text-white/80 text-xs mt-0.5">Build the ERP · password protected</p></div></div>
          <div className="p-6 space-y-3">
            <p className="text-xs text-gray-500">Enter the password to add boards and change the ERP structure.</p>
            <input ref={pwRef} type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} onInput={e => setPw((e.target as HTMLInputElement).value)} placeholder="Password" className={inp + ' w-full'} />
            {pwErr && <p className="text-xs text-red-600">{pwErr}</p>}
            <button type="submit" disabled={checking} className="mon-btn w-full justify-center !py-2.5" style={{ background: '#A25DDC', borderColor: '#6C2FA0' }}>{checking ? 'Checking…' : 'Unlock Dev Center'}</button>
            <Link href="/settings" className="block text-center text-xs text-gray-400 hover:text-gray-600">← Back to Settings</Link>
          </div>
        </form>
      </div>
    )
  }

  const totalBoards = boards.length
  const customBoards = boards.filter(b => b.is_custom).length
  const hiddenBoards = boards.filter(b => b.is_hidden).length

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-purple">🛠️ Dev Center</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Dev Center</h1>
          <p className="text-gray-500 text-sm mt-0.5">Add boards and manage the ERP structure — like building in Monday.com.</p>
        </div>
        <button onClick={() => { sessionStorage.removeItem('devcenter_pw'); setUnlocked(false); setPw('') }} className="text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E] shrink-0"><i className="ti ti-lock text-sm mr-1" />Lock</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Total Boards" value={totalBoards} c="#A25DDC" />
        <Stat label="Custom Boards" value={customBoards} c="#00A84F" />
        <Stat label="Nav Groups" value={allGroups.length} c="#0086C0" />
        <Stat label="Hidden" value={hiddenBoards} c="#9699A6" />
      </div>

      {/* Create a board */}
      <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm p-5 mb-6">
        <h2 className="font-bold text-[#1A1D2E] mb-3 flex items-center gap-2"><i className="ti ti-plus text-[#A25DDC]" />Create a new board</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">Board name</label><input value={nLabel} onChange={e => setNLabel(e.target.value)} placeholder="e.g. Marketing Campaigns" className={inp + ' w-full'} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Nav group</label>
            <input list="dc-groups" value={nGroup} onChange={e => setNGroup(e.target.value)} className={inp + ' w-full'} />
            <datalist id="dc-groups">{groupOptions.map(g => <option key={g} value={g} />)}</datalist>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Icon (Tabler name)</label><input value={nIcon} onChange={e => setNIcon(e.target.value)} placeholder="ti-layout-board" className={inp + ' w-full'} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Accent color</label>
            <div className="flex items-center gap-2"><input type="color" value={nColor} onChange={e => setNColor(e.target.value)} className="w-10 h-9 rounded border border-[#E4E6EE] bg-white" /><input value={nColor} onChange={e => setNColor(e.target.value)} className={inp + ' flex-1'} /></div>
          </div>
          <div className="md:col-span-2"><label className="block text-xs text-gray-500 mb-1">Groups (comma-separated)</label><input value={nGroups} onChange={e => setNGroups(e.target.value)} placeholder="To Do, In Progress, Done" className={inp + ' w-full'} /></div>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-gray-500 mb-1.5">Columns</label>
          <div className="space-y-2">
            {nCols.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={c.label} onChange={e => setNCols(cs => cs.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))} placeholder="Column name" className={inp + ' flex-1'} />
                <select value={c.type} onChange={e => setNCols(cs => cs.map((x, xi) => xi === i ? { ...x, type: e.target.value as BoardColumn['type'] } : x))} className={inp}>
                  {COL_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
                <button onClick={() => setNCols(cs => cs.filter((_, xi) => xi !== i))} className="w-9 h-9 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-red-600 shrink-0"><i className="ti ti-trash text-sm" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setNCols(cs => [...cs, { label: '', type: 'text' }])} className="mt-2 text-xs text-[#A25DDC] font-semibold">+ Add column</button>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={createBoard} disabled={creating} className="mon-btn !py-2" style={{ background: '#A25DDC', borderColor: '#6C2FA0' }}>{creating ? 'Creating…' : 'Create Board'}</button>
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">The board’s connection key never changes when you rename it — links and data stay intact.</p>
      </div>

      {/* Manage existing boards */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="font-bold text-[#1A1D2E] flex items-center gap-2 mr-2"><i className="ti ti-adjustments text-[#A25DDC]" />Manage boards</h2>
        <input placeholder="Search boards…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[200px] max-w-xs bg-white border border-[#E4E6EE] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#A25DDC]/30" />
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(allGroups.map(g => [g.group, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      <div className="space-y-2.5 mb-6">
        {shownGroups.map(section => {
          const c = accentColor(section.group).solid
          const isCol = collapsed[section.group]
          const fullItems = allGroups.find(g => g.group === section.group)?.items || []
          return (
            <div key={section.group} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
              <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: c + '14', borderLeft: '5px solid ' + c }} onClick={() => setCollapsed(cc => ({ ...cc, [section.group]: !cc[section.group] }))}>
                <span className="text-[10px]" style={{ color: c, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                <span className="font-bold text-sm" style={{ color: c }}>{section.group}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: c + '26', color: c }}>{section.items.length}</span>
              </div>
              {!isCol && (
                <div className="divide-y divide-[#EAECF2]" onDragOver={e => e.preventDefault()} onDrop={() => onDropRow(section.group, null)}>
                  {section.items.map((b, idx) => {
                    const realIdx = fullItems.findIndex(x => x.board_key === b.board_key)
                    return (
                      <div key={b.board_key}
                        onDragOver={e => { e.preventDefault(); if (dragKey && dragOverKey !== b.board_key) setDragOverKey(b.board_key) }}
                        onDrop={() => onDropRow(section.group, b.board_key)}
                        className={`group mon-row flex items-center gap-2 px-3 py-2.5 ${idx % 2 ? 'bg-[#F6F8FB]' : 'bg-white'} ${dragKey && dragOverKey === b.board_key ? 'ring-2 ring-inset ring-[#A25DDC]/50' : ''}`}>
                        <span draggable onDragStart={() => setDragKey(b.board_key)} onDragEnd={() => { setDragKey(null); setDragOverKey(null) }} className="cursor-grab active:cursor-grabbing text-gray-300 group-hover:text-gray-500 select-none shrink-0 px-0.5" title="Drag to reorder">&#8942;&#8942;</span>
                        <i className={`ti ${b.icon || 'ti-layout-board'} text-base w-5 text-center shrink-0`} style={{ color: c }} />
                        <input defaultValue={b.label} onBlur={e => { const v = e.target.value.trim(); if (v && v !== b.label) meta(b, { label: v }) }} className={inp + ' flex-1 min-w-0'} />
                        <select value={b.nav_group} onChange={e => meta(b, { nav_group: e.target.value })} className={inp + ' hidden sm:block'}>
                          {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => moveBoard(section.group, realIdx, -1)} className="w-8 h-8 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-[#1A1D2E]" title="Move up"><i className="ti ti-arrow-up text-sm" /></button>
                          <button onClick={() => moveBoard(section.group, realIdx, 1)} className="w-8 h-8 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-[#1A1D2E]" title="Move down"><i className="ti ti-arrow-down text-sm" /></button>
                          <button onClick={() => meta(b, { is_hidden: !b.is_hidden })} className="w-8 h-8 rounded-lg border border-[#E4E6EE] shrink-0" style={{ color: b.is_hidden ? '#9CA3AF' : '#00A84F' }} title={b.is_hidden ? 'Hidden — click to show' : 'Visible — click to hide'}>
                            <i className={`ti ${b.is_hidden ? 'ti-eye-off' : 'ti-eye'} text-sm`} />
                          </button>
                          {b.is_custom
                            ? <button onClick={() => removeBoard(b)} className="w-8 h-8 rounded-lg border border-red-200 text-red-500 hover:bg-red-50" title="Delete board"><i className="ti ti-trash text-sm" /></button>
                            : <span className="w-8 h-8 flex items-center justify-center text-[9px] text-gray-300" title="Built-in board">CORE</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {shownGroups.length === 0 && <p className="text-gray-400 text-sm px-1">No boards match “{search}”.</p>}
      </div>
    </div>
  )
}
