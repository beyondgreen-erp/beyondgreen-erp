'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Device { id: string; serial: string; label: string; mode: 'receiving' | 'production'; pin: string; is_active: boolean; last_used_at: string | null; created_at: string }

function randSerial() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''; for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)]
  return s
}

function QR({ url, size = 132 }: { url: string; size?: number }) {
  const [d, setD] = useState('')
  useEffect(() => { let ok = true; import('qrcode').then((m: any) => m.toDataURL(url, { width: size * 2, margin: 1 })).then((u: string) => { if (ok) setD(u) }).catch(() => {}); return () => { ok = false } }, [url, size])
  return d ? <img src={d} width={size} height={size} alt="QR" style={{ borderRadius: 8 }} /> : <div style={{ width: size, height: size }} className="grid place-items-center text-xs text-gray-400 border border-dashed border-gray-300 rounded">QR…</div>
}

export default function ScanDevicesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [origin, setOrigin] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ label: '', mode: 'receiving' as 'receiving' | 'production', pin: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => { if (typeof window !== 'undefined') setOrigin(window.location.origin) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('scan_devices').select('*').order('created_at', { ascending: false })
    setRows((data as Device[]) || [])
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const urlFor = (d: Device) => origin ? `${origin}/scan/${d.serial}` : ''

  async function create() {
    setErr('')
    if (!form.label.trim()) { setErr('Give the device a name (e.g. "Receiving Dock 1").'); return }
    if (!/^\d{4,8}$/.test(form.pin)) { setErr('PIN must be 4–8 digits.'); return }
    setSaving(true)
    const { error } = await sb.from('scan_devices').insert({ serial: randSerial(), label: form.label.trim(), mode: form.mode, pin: form.pin, created_by: email || null })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setShowNew(false); setForm({ label: '', mode: 'receiving', pin: '' }); load()
  }
  async function toggleActive(d: Device) { await sb.from('scan_devices').update({ is_active: !d.is_active }).eq('id', d.id); load() }
  async function setPin(d: Device) { const p = window.prompt(`New PIN for ${d.label} (4–8 digits):`, d.pin); if (p == null) return; if (!/^\d{4,8}$/.test(p)) { alert('PIN must be 4–8 digits.'); return } await sb.from('scan_devices').update({ pin: p }).eq('id', d.id); load() }
  async function rename(d: Device) { const l = window.prompt('Rename device:', d.label); if (!l) return; await sb.from('scan_devices').update({ label: l.trim() }).eq('id', d.id); load() }
  async function remove(d: Device) { if (!confirm(`Delete "${d.label}"? The tablet link will stop working.`)) return; await sb.from('scan_devices').delete().eq('id', d.id); load() }
  function copy(url: string) { navigator.clipboard?.writeText(url).then(() => { setCopied(url); setTimeout(() => setCopied(''), 1500) }).catch(() => {}) }

  const badge = (m: string) => m === 'production'
    ? { background: '#F3E8FF', color: '#7A3FB0', border: '1px solid #E3D5F8' }
    : { background: '#DDF3E8', color: '#0F7A4E', border: '1px solid #BFE9D5' }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1D2E]">Scan Devices</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">Register a tablet or phone for the warehouse. Each device opens its own link, is locked to Receiving or Production, and needs a short PIN. No ERP login required — every scan still writes into the ERP database, credited to the device.</p>
        </div>
        <button onClick={() => { setShowNew(true); setErr('') }} className="shrink-0 bg-[#3B6FE0] hover:bg-[#2f5bc0] text-white text-sm font-semibold px-4 py-2.5 rounded-lg">+ Add Device</button>
      </div>

      {loading ? <p className="text-sm text-gray-400 mt-6">Loading…</p> : rows.length === 0 ? (
        <div className="mt-8 text-center rounded-2xl border border-dashed border-[#D7DBE6] py-14">
          <p className="text-gray-500 font-medium">No devices yet.</p>
          <p className="text-sm text-gray-400 mt-1">Add one, then open its link on the tablet.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4 mt-6">
          {rows.map(d => {
            const url = urlFor(d)
            return (
              <div key={d.id} className={`rounded-2xl border p-4 bg-white ${d.is_active ? 'border-[#E4E6EE]' : 'border-[#E4E6EE] opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase" style={badge(d.mode)}>{d.mode}</span>
                      {!d.is_active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Disabled</span>}
                    </div>
                    <h3 className="text-lg font-bold text-[#1A1D2E] mt-1 truncate">{d.label}</h3>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">serial {d.serial} · PIN {d.pin}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{d.last_used_at ? `Last used ${new Date(d.last_used_at).toLocaleString()}` : 'Never used'}</p>
                  </div>
                  <QR url={url} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input readOnly value={url} className="flex-1 min-w-0 text-xs font-mono bg-[#F7F8FB] border border-[#E4E6EE] rounded-lg px-2.5 py-2 text-gray-600" />
                  <button onClick={() => copy(url)} className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg bg-[#EEF2FB] text-[#3B6FE0] hover:bg-[#E1EAFB]">{copied === url ? 'Copied ✓' : 'Copy'}</button>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <a href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#DDF3E8] text-[#0F7A4E] hover:bg-[#CDEBDD]">Open</a>
                  <button onClick={() => rename(d)} className="text-xs px-3 py-1.5 rounded-lg bg-[#EEF0F4] text-gray-600 hover:bg-[#E2E6EE]">Rename</button>
                  <button onClick={() => setPin(d)} className="text-xs px-3 py-1.5 rounded-lg bg-[#EEF0F4] text-gray-600 hover:bg-[#E2E6EE]">Change PIN</button>
                  <button onClick={() => toggleActive(d)} className="text-xs px-3 py-1.5 rounded-lg bg-[#EEF0F4] text-gray-600 hover:bg-[#E2E6EE]">{d.is_active ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => remove(d)} className="text-xs px-3 py-1.5 rounded-lg bg-[#FBE9E9] text-[#B3261E] hover:bg-[#F6D5D5]">Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !saving && setShowNew(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#1A1D2E] mb-3">Add a scan device</h2>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Device name</label>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Receiving Dock 1" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm mb-3" />
            <label className="block text-xs font-semibold text-gray-500 mb-1">This device is for</label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button onClick={() => setForm(f => ({ ...f, mode: 'receiving' }))} className={`py-2.5 text-sm font-bold rounded-lg border ${form.mode === 'receiving' ? 'bg-[#DDF3E8] text-[#0F7A4E] border-[#0F7A4E]' : 'bg-white text-gray-500 border-[#E4E6EE]'}`}>Receiving</button>
              <button onClick={() => setForm(f => ({ ...f, mode: 'production' }))} className={`py-2.5 text-sm font-bold rounded-lg border ${form.mode === 'production' ? 'bg-[#F3E8FF] text-[#7A3FB0] border-[#7A3FB0]' : 'bg-white text-gray-500 border-[#E4E6EE]'}`}>Production</button>
            </div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">PIN (4–8 digits)</label>
            <input value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 8) }))} inputMode="numeric" placeholder="e.g. 4821" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm tracking-widest" />
            {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNew(false)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
              <button onClick={create} disabled={saving} className="text-sm font-semibold px-5 py-2 rounded-lg bg-[#3B6FE0] text-white disabled:opacity-60">{saving ? 'Creating…' : 'Create device'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
