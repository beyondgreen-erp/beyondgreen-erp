'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared frame for the client portal workspace pages (orders, projects, quotes, calls,
// documents, account). Loads the account, redirects to sign-in when there is no session,
// and shows the approval / onboarding banner.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export const GREEN = '#037f4c'
export const INK = '#1A1D2E'
export const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-xl px-3.5 py-2.5 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#037f4c]/30 focus:border-[#037f4c]'
export const labelCls = 'block text-xs font-semibold text-gray-600 mb-1'
export const cardCls = 'bg-white rounded-2xl border border-[#ECEEF3] shadow-sm'
export const btnCls = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:opacity-95'
export const btnGhostCls = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border border-[#E4E6EE] text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50'

export const fmtDate = (d: string | null | undefined) => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
export const money = (n: number | null | undefined) => n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const qty = (n: number | null | undefined) => n == null ? '' : Number(n).toLocaleString('en-US')

export async function api(path: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`/api/portal/self/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

// Upload straight to storage with a one-time signed URL (no size limit from the app server).
export async function uploadFile(kind: 'onboarding' | 'po' | 'project', file: File): Promise<{ path: string; name: string }> {
  const { ok, data } = await api('upload-url', { kind, name: file.name, size: file.size })
  if (!ok) throw new Error(data.error || 'Upload failed.')
  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', file)
  const headers: Record<string, string> = { 'x-upsert': 'false' }
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) headers.apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const r = await fetch(data.url, { method: 'PUT', body: form, headers })
  if (!r.ok) throw new Error('Upload failed. Please try again.')
  return { path: data.path, name: file.name }
}

export interface PortalCtx { account: any; customer: any; counts: any; reload: () => Promise<void> }
const Ctx = createContext<PortalCtx | null>(null)
export const usePortal = () => useContext(Ctx) as PortalCtx

const NAV = [
  { href: '/portal', label: 'Home' },
  { href: '/portal/orders', label: 'Orders' },
  { href: '/portal/projects', label: 'Projects' },
  { href: '/portal/quotes', label: 'Quotes' },
  { href: '/portal/book', label: 'Book a call' },
  { href: '/portal/documents', label: 'Documents' },
  { href: '/portal/account', label: 'Account' },
]

export function PortalNav({ active }: { active: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
      {NAV.map(n => {
        const on = n.href === '/portal' ? active === '/portal' : active.startsWith(n.href)
        return <Link key={n.href} href={n.href} className={`whitespace-nowrap text-[13px] font-semibold rounded-full px-3.5 py-1.5 ${on ? 'bg-white text-[#037f4c]' : 'text-white/85 hover:bg-white/15'}`}>{n.label}</Link>
      })}
    </nav>
  )
}

export default function PortalShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname() || '/portal'
  const [state, setState] = useState<{ phase: 'loading' | 'ready'; account?: any; customer?: any; counts?: any }>({ phase: 'loading' })

  const reload = useCallback(async () => {
    const { ok, status, data } = await api('account')
    if (!ok) { if (status === 401) window.location.href = '/portal?next=' + encodeURIComponent(pathname); return }
    setState({ phase: 'ready', account: data.account, customer: data.customer, counts: data.counts })
  }, [pathname])
  useEffect(() => { reload() }, [reload])

  async function logout() { await fetch('/api/portal/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/portal' }

  const a = state.account
  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      <div style={{ background: `linear-gradient(135deg, #0b6b45 0%, ${GREEN} 55%, #1f5e3f 100%)` }}>
        <div className="mx-auto max-w-5xl px-4 sm:px-5 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/portal" className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-white/15 text-white grid place-items-center font-bold text-sm shrink-0">bG</span>
              <span className="min-w-0"><span className="block text-white font-bold text-[15px] leading-tight truncate">{a?.company || 'beyondGREEN'}</span><span className="block text-white/70 text-[11px] leading-tight">beyondGREEN client portal</span></span>
            </Link>
            <button onClick={logout} className="text-xs font-semibold text-white bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5 shrink-0">Sign out</button>
          </div>
          <div className="mt-3"><PortalNav active={pathname} /></div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-5 py-5">
        {state.phase === 'ready' && a && !a.approved && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <span>{a.onboarding_submitted_at ? 'Thanks for sending your onboarding details. Our team is reviewing your account; ordering unlocks once it is approved. Projects, quotes, calls and messages are open now.' : 'Welcome! Finish your onboarding packet so we can approve ordering. Projects, quotes, calls and messages are open now.'}</span>
            {!a.onboarding_submitted_at && <Link href="/portal/account" className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: GREEN }}>Finish onboarding</Link>}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: INK }}>{title}</h1>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {state.phase === 'loading'
          ? <div className={`${cardCls} p-10 text-center text-sm text-gray-400`}>Loading…</div>
          : <Ctx.Provider value={{ account: state.account, customer: state.customer, counts: state.counts, reload }}>{children}</Ctx.Provider>}
        <p className="text-center text-[11px] text-gray-400 mt-10">beyondGREEN biotech · Santa Ana, California · <a href="mailto:info@byndgrn.com" className="underline">info@byndgrn.com</a></p>
      </div>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className={`${cardCls} p-8 text-center text-sm text-gray-500`}>{children}</div>
}

export function Pill({ tone, children }: { tone?: string; children: React.ReactNode }) {
  const T: Record<string, [string, string]> = { green: ['#E4F7EE', '#037f4c'], blue: ['#E8F0FE', '#1D4ED8'], amber: ['#FEF3E2', '#B45309'], red: ['#FDECEC', '#C0341D'], violet: ['#F1EAFB', '#6D28D9'], gray: ['#EEF0F4', '#5A6E8A'] }
  const [bg, fg] = T[tone || 'gray'] || T.gray
  return <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: bg, color: fg }}>{children}</span>
}

export function FileDrop({ kind, onUploaded, label, multiple = true, accept }: { kind: 'onboarding' | 'po' | 'project'; onUploaded: (f: { path: string; name: string }) => void; label?: string; multiple?: boolean; accept?: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function handle(files: FileList | null) {
    if (!files || !files.length) return
    setErr(''); setBusy(true)
    try { for (const f of Array.from(files)) onUploaded(await uploadFile(kind, f)) }
    catch (e: any) { setErr(e?.message || 'Upload failed.') }
    finally { setBusy(false) }
  }
  return (
    <div>
      <label className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-[#D9DEE8] rounded-xl px-4 py-5 text-center cursor-pointer hover:border-[#037f4c] hover:bg-[#F7FBF9]"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handle(e.dataTransfer.files) }}>
        <span className="text-sm font-semibold" style={{ color: GREEN }}>{busy ? 'Uploading…' : (label || 'Drop files or tap to upload')}</span>
        <span className="text-[11px] text-gray-400">PDF, images, AI/EPS/SVG, CAD, Office or ZIP · up to 50 MB</span>
        <input type="file" className="hidden" multiple={multiple} accept={accept} onChange={e => { handle(e.target.files); e.currentTarget.value = '' }} disabled={busy} />
      </label>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
