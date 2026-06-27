'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Global Recycle Bin: lists items deleted from any board and restores them
// to their exact original table/row via the restore_deleted_item RPC.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago'
  const d = Math.floor(h / 24); return d + 'd ago'
}

export default function RecycleBin() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('deleted_items')
      .select('id,label,board,deleted_at,deleted_by,record_id')
      .eq('restored', false).eq('is_primary', true)
      .order('deleted_at', { ascending: false }).limit(200)
    setItems(data || []); setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (open) load() }, [open, load])

  async function restore(it: any) {
    setBusy(it.id); setMsg('')
    const { data, error } = await sb.rpc('restore_deleted_item', { p_id: it.id })
    setBusy('')
    if (error) setMsg(error.message.replace('P0001:', '').trim() || 'Could not restore')
    else { setMsg(`Restored “${data?.label || it.label}” back to ${data?.board || it.board}`); load() }
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setMsg('') }}
        className="flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E2E8F0] text-[#0F1C2E] text-sm rounded-lg font-semibold hover:bg-[#F1F4F9]">
        <i className="ti ti-trash text-base" /> Deleted Items
        {items.length > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-[#FEE2E2] text-[#B91C1C]">{items.length}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,18,38,0.45)' }} onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col" style={{ maxHeight: '80vh', border: '1px solid #E4E6EE' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-4 border-b" style={{ borderColor: '#E4E6EE' }}>
              <div>
                <h2 className="text-lg font-bold text-[#0F1C2E]">🗑️ Recycle Bin</h2>
                <p className="text-xs text-[#6B7280]">Restore deleted items from any board back to their exact original spot.</p>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#F5F6FA] text-[#6B7280] hover:bg-[#E4E6EE]">✕</button>
            </div>
            {msg && <div className="mx-5 mt-3 text-sm px-3 py-2 rounded-lg bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">{msg}</div>}
            <div className="overflow-auto px-5 py-3" style={{ minHeight: 140 }}>
              {loading ? <p className="text-sm py-10 text-center text-[#6B7280]">Loading…</p>
                : items.length === 0 ? <p className="text-sm py-12 text-center text-[#6B7280]">Nothing in the recycle bin. Items you delete from any board will appear here so you can put them back.</p>
                  : <div className="divide-y" style={{ borderColor: '#EEF1F6' }}>
                    {items.map(it => (
                      <div key={it.id} className="flex items-center gap-3 py-2.5">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-[#EEF2FF] text-[#3B6FE0]">{it.board}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate text-[#1A1D2E]">{it.label}</p>
                          <p className="text-xs text-[#9CA3AF]">Deleted {timeAgo(it.deleted_at)}{it.deleted_by ? ' · ' + it.deleted_by.split('@')[0] : ''}</p>
                        </div>
                        <button onClick={() => restore(it)} disabled={busy === it.id}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white shrink-0 bg-[#3B6FE0] hover:bg-[#2D5CC8] disabled:opacity-50">
                          {busy === it.id ? 'Restoring…' : 'Restore'}
                        </button>
                      </div>
                    ))}
                  </div>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
