'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { BUCKET, type DesignRow } from '@/lib/packaging/doc'
import type { EditorHandle } from './Editor'

interface VersionRow { id: string; version_no: number; label: string | null; doc_path: string; thumb_path: string | null; created_by: string | null; created_at: string }

export default function VersionsTab({ design, editor, user }: { design: DesignRow; editor: React.RefObject<EditorHandle>; user: { email: string; name: string } }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<VersionRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await sb.from('packaging_design_versions').select('*').eq('design_id', design.id).order('version_no', { ascending: false })
    const list = (data || []) as VersionRow[]
    setRows(list)
    const paths = list.map(r => r.thumb_path).filter(Boolean) as string[]
    if (paths.length) {
      const { data: s } = await sb.storage.from(BUCKET).createSignedUrls(Array.from(new Set(paths)), 3600)
      const m: Record<string, string> = {}; (s || []).forEach((x: any) => { if (x.signedUrl) m[x.path] = x.signedUrl }); setThumbs(m)
    }
  }, [sb, design.id])
  useEffect(() => { load() }, [load])

  const saveVersion = async () => {
    setBusy('Saving…')
    try {
      await editor.current?.saveNow()
      const doc = editor.current?.getDoc(); if (!doc) throw new Error('Editor not ready')
      const n = (rows[0]?.version_no || 0) + 1
      const path = `designs/${design.id}/versions/${n}.json`
      const thumb = `designs/${design.id}/versions/${n}.png`
      await sb.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(doc)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
      // copy the current thumbnail so the version keeps its own preview
      const { data: th } = await sb.storage.from(BUCKET).download(`designs/${design.id}/thumb.png`)
      if (th) await sb.storage.from(BUCKET).upload(thumb, th, { upsert: true, contentType: 'image/png' })
      await sb.from('packaging_design_versions').insert({ design_id: design.id, version_no: n, label: label.trim() || null, doc_path: path, thumb_path: th ? thumb : null, created_by: user.email })
      setLabel(''); load()
    } catch (e: any) { alert(e?.message || String(e)) } finally { setBusy(null) }
  }
  const restoreVersion = async (v: VersionRow) => {
    if (!confirm(`Restore version ${v.version_no}? Your current working file is saved as a new version first.`)) return
    setBusy('Restoring…')
    try {
      await saveVersionSilently(`Before restoring v${v.version_no}`)
      const { data } = await sb.storage.from(BUCKET).download(v.doc_path)
      if (!data) throw new Error('Version file missing')
      await editor.current?.loadDoc(JSON.parse(await data.text()))
      await editor.current?.saveNow()
      load()
    } catch (e: any) { alert(e?.message || String(e)) } finally { setBusy(null) }
  }
  const saveVersionSilently = async (lbl: string) => {
    const doc = editor.current?.getDoc(); if (!doc) return
    const { data: last } = await sb.from('packaging_design_versions').select('version_no').eq('design_id', design.id).order('version_no', { ascending: false }).limit(1)
    const n = ((last?.[0] as any)?.version_no || 0) + 1
    const path = `designs/${design.id}/versions/${n}.json`
    await sb.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(doc)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
    await sb.from('packaging_design_versions').insert({ design_id: design.id, version_no: n, label: lbl, doc_path: path, thumb_path: null, created_by: user.email })
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6FA]">
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <h2 className="text-lg font-bold text-gray-900">Versions</h2>
            <p className="text-sm text-gray-500">The working file autosaves continuously. Save a named version at milestones (customer approval, printer changes) so you can always go back.</p>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Version name — e.g. Customer approved copy" className="mt-3 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button disabled={!!busy} onClick={saveVersion} className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60" style={{ background: '#3B6FE0' }}>{busy || <><i className="ti ti-bookmark-plus" /> Save version</>}</button>
        </div>
        {!rows.length && <p className="text-sm text-gray-500">No saved versions yet.</p>}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {rows.map(v => (
            <div key={v.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="aspect-[4/3] bg-gray-100 grid place-items-center">{v.thumb_path && thumbs[v.thumb_path] ? <img src={thumbs[v.thumb_path]} alt="" className="max-w-full max-h-full object-contain p-2" /> : <i className="ti ti-history text-3xl text-gray-300" />}</div>
              <div className="p-3 space-y-1">
                <p className="font-semibold text-sm">v{v.version_no}{v.label ? ` — ${v.label}` : ''}</p>
                <p className="text-[11px] text-gray-500">{new Date(v.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · {(v.created_by || '').split('@')[0]}</p>
                <button disabled={!!busy} onClick={() => restoreVersion(v)} className="text-xs text-[#3B6FE0] hover:underline disabled:opacity-50"><i className="ti ti-restore" /> Restore this version</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
