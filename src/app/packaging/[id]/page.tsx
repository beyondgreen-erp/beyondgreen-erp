'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import nextDynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { BUCKET, STATUSES, STATUS_COLORS, newDoc, type DesignDoc, type DesignRow } from '@/lib/packaging/doc'
import type { EditorHandle, SaveState } from '@/components/packaging/Editor'

const Editor = nextDynamic(() => import('@/components/packaging/Editor'), { ssr: false, loading: () => <div className="flex-1 grid place-items-center text-gray-400">Loading editor…</div> })
const FinalFilesTab = nextDynamic(() => import('@/components/packaging/FinalFilesTab'), { ssr: false })
const ShareTab = nextDynamic(() => import('@/components/packaging/ShareTab'), { ssr: false })
const VersionsTab = nextDynamic(() => import('@/components/packaging/VersionsTab'), { ssr: false })
const ApprovalsTab = nextDynamic(() => import('@/components/packaging/ApprovalsTab'), { ssr: false })

type Tab = 'design' | 'files' | 'share' | 'approvals' | 'versions'

export default function PackagingWorkspace() {
  const params = useParams()
  const search = useSearchParams()
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string)
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const editorRef = useRef<EditorHandle | null>(null)
  const [design, setDesign] = useState<DesignRow | null>(null)
  const [doc, setDoc] = useState<DesignDoc | null>(null)
  const [err, setErr] = useState('')
  const [user, setUser] = useState({ email: '', name: '' })
  const [tab, setTab] = useState<Tab>(() => (['files', 'share', 'approvals', 'versions'].includes(search.get('tab') || '') ? search.get('tab') : 'design') as Tab)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const [name, setName] = useState('')
  const [, tick] = useState(0)

  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 15000); return () => clearInterval(t) }, [])
  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await sb.auth.getUser()
      const email = u?.email || ''
      let nm = email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      if (email) { const { data: p } = await sb.from('user_profiles').select('full_name').eq('email', email).maybeSingle(); if (p?.full_name) nm = p.full_name }
      setUser({ email, name: nm })
      const { data: row, error } = await sb.from('packaging_designs').select('*').eq('id', id).maybeSingle()
      if (error || !row) { setErr(error?.message || 'Design not found'); return }
      setDesign(row as DesignRow); setName(row.name)
      let d: DesignDoc | null = null
      if (row.doc_path) {
        const { data: blob } = await sb.storage.from(BUCKET).download(row.doc_path)
        if (blob) { try { d = JSON.parse(await blob.text()) } catch { /* corrupt */ } }
      }
      setDoc(d || newDoc(Number(row.width_pt), Number(row.height_pt), row.unit))
    })()
  }, [id, sb])

  // warn before leaving with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (save.status === 'dirty' || save.status === 'saving') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [save.status])

  const onSaved = useCallback((row: Partial<DesignRow>) => setDesign(d => d ? { ...d, ...row } as DesignRow : d), [])
  const updateDesign = async (patch: Partial<DesignRow>) => {
    if (!design) return
    setDesign({ ...design, ...patch } as DesignRow)
    await sb.from('packaging_designs').update({ ...patch, updated_by: user.email }).eq('id', design.id)
  }

  if (err) return <div className="h-screen grid place-items-center text-center"><div><p className="text-gray-700 font-medium">{err}</p><Link href="/packaging" className="text-sm text-blue-600">← Back to Packaging Design</Link></div></div>
  if (!design || !doc) return <div className="h-screen grid place-items-center text-gray-400">Loading…</div>

  const saveLabel = save.status === 'saving' ? 'Saving…' : save.status === 'dirty' ? 'Unsaved changes' : save.status === 'error' ? 'Save failed — retry ⌘S'
    : save.status === 'conflict' ? 'Newer version exists' : save.status === 'saved' ? `Saved ${ago(save.at!)}` : `Saved ${ago(new Date(design.updated_at).getTime())}`

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <header className="h-12 shrink-0 bg-[#1A2035] text-white flex items-center gap-3 px-3">
        <Link href="/packaging" className="w-8 h-8 rounded-md grid place-items-center hover:bg-white/10" title="All designs"><i className="ti ti-arrow-left" /></Link>
        <div className="w-7 h-7 rounded-lg grid place-items-center text-xs font-bold" style={{ background: '#2ABF06' }}>bG</div>
        <input value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== design.name && updateDesign({ name: name.trim() })}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="bg-transparent font-semibold text-sm outline-none focus:bg-white/10 rounded px-1.5 py-1 w-[260px]" />
        <select value={design.status} onChange={e => updateDesign({ status: e.target.value })} className={`text-xs rounded-full px-2 py-1 border-0 ${STATUS_COLORS[design.status]}`}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <span className="text-[11px] text-white/50 hidden lg:inline">{[design.customer_name, design.sku].filter(Boolean).join(' · ')}</span>
        <nav className="flex items-center gap-1 ml-4">
          {([['design', 'ti-pencil', 'Design'], ['files', 'ti-file-export', 'Final Files'], ['share', 'ti-share', 'Printer Share'], ['approvals', 'ti-rosette-discount-check', 'Approvals'], ['versions', 'ti-history', 'Versions']] as const).map(([k, ic, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 h-8 rounded-md text-xs font-medium flex items-center gap-1.5 ${tab === k ? 'bg-white text-[#1A2035]' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              <i className={`ti ${ic}`} />{l}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className={`text-[11px] ${save.status === 'error' || save.status === 'conflict' ? 'text-red-300' : 'text-white/60'}`} title={save.message}>
            {save.status === 'saving' && <i className="ti ti-loader-2 animate-spin mr-1" />}{saveLabel}
          </span>
          {save.status === 'conflict' && (
            <>
              <button onClick={() => location.reload()} className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20">Reload theirs</button>
              <button onClick={() => editorRef.current?.saveNow(true)} className="text-[11px] px-2 py-1 rounded bg-red-500/80 hover:bg-red-500">Keep mine</button>
            </>
          )}
          <button onClick={() => editorRef.current?.saveNow()} className="text-xs px-3 h-8 rounded-md bg-white/10 hover:bg-white/20"><i className="ti ti-device-floppy" /> Save</button>
          <button onClick={() => setTab('share')} className="text-xs px-3 h-8 rounded-md font-semibold" style={{ background: '#2ABF06' }}><i className="ti ti-send" /> Share with printer</button>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex flex-col">
        <Editor editorRef={editorRef} design={design} initialDoc={doc} user={user} onSaved={onSaved} onSaveState={setSave} visible={tab === 'design'} initialPanel={search.get('import') ? 'import' : undefined} />
        {tab === 'files' && <FinalFilesTab design={design} editor={editorRef} user={user} onDesign={updateDesign} />}
        {tab === 'share' && <ShareTab design={design} editor={editorRef} user={user} onDesign={updateDesign} onOpenComment={cid => { setTab('design'); setTimeout(() => editorRef.current?.focusComment(cid), 50) }} />}
        {tab === 'approvals' && <ApprovalsTab design={design} editor={editorRef} user={user} />}
        {tab === 'versions' && <VersionsTab design={design} editor={editorRef} user={user} />}
      </div>
    </div>
  )
}

function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
