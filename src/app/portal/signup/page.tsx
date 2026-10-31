'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { useEffect, useState } from 'react'

const GREEN = '#037f4c'
const TYPES = ['Restaurant or foodservice', 'Distributor', 'Retailer or grocery', 'Brand / CPG (private label)', 'Hospitality, venue or events', 'School, hospital or government', 'Pet brand or pet retail', 'Other']
const INTERESTS = ['Cutlery and kits', 'Straws', 'Cups and lids', 'Bags and liners', 'Pet waste bags', 'Custom printing', 'Contract manufacturing', 'Private label']

export default function SignupPage() {
  const [f, setF] = useState<any>({ company: '', name: '', title: '', email: '', phone: '', website: '', business_type: '', interest: [] as string[], how_heard: '', website_url: '' })
  const [t0, setT0] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => { setT0(Date.now()) }, [])
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))
  const toggle = (v: string) => set('interest', f.interest.includes(v) ? f.interest.filter((x: string) => x !== v) : [...f.interest, v])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    if (!f.company.trim() || !f.name.trim() || !f.email.trim()) { setErr('Company, your name and work email are required.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/portal/self/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, t: t0 }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Something went wrong. Please try again.'); return }
      setDone(true)
    } finally { setBusy(false) }
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] rounded-xl px-3.5 py-2.5 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#037f4c]/30'
  const lbl = 'block text-xs font-semibold text-gray-600 mb-1'
  return (
    <div className="min-h-screen py-8 px-4" style={{ background: 'linear-gradient(160deg, #0b6b45 0%, #037f4c 45%, #1f5e3f 100%)' }}>
      <div className="mx-auto w-full max-w-xl">
        <div className="text-center mb-5">
          <div className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-white/15 text-white font-bold">bG</div>
          <h1 className="text-white text-2xl font-bold mt-3">Open your beyondGREEN account</h1>
          <p className="text-white/80 text-sm mt-1">One place to start projects, book calls, get quotes, place orders and upload POs.</p>
        </div>
        <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8">
          {done ? (
            <div className="text-center py-4">
              <div className="mx-auto w-12 h-12 rounded-full grid place-items-center text-xl font-bold" style={{ background: '#E4F7EE', color: GREEN }}>✓</div>
              <h2 className="text-lg font-bold text-[#1A1D2E] mt-3">Check your email</h2>
              <p className="text-sm text-gray-600 mt-2 leading-relaxed">We sent a link to <strong>{f.email}</strong>. Click it to confirm your email and set your password. If you already have an account, use <Link href="/portal/forgot" className="font-semibold" style={{ color: GREEN }}>reset password</Link> instead.</p>
              <Link href="/portal" className="inline-block mt-5 text-sm font-semibold" style={{ color: GREEN }}>Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-3.5 py-2 text-sm">{err}</div>}
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block sm:col-span-2"><span className={lbl}>Company *</span><input className={inp} value={f.company} onChange={e => set('company', e.target.value)} autoComplete="organization" /></label>
                <label className="block"><span className={lbl}>Your name *</span><input className={inp} value={f.name} onChange={e => set('name', e.target.value)} autoComplete="name" /></label>
                <label className="block"><span className={lbl}>Title</span><input className={inp} value={f.title} onChange={e => set('title', e.target.value)} autoComplete="organization-title" /></label>
                <label className="block"><span className={lbl}>Work email *</span><input type="email" className={inp} value={f.email} onChange={e => set('email', e.target.value)} autoComplete="email" /></label>
                <label className="block"><span className={lbl}>Phone</span><input type="tel" className={inp} value={f.phone} onChange={e => set('phone', e.target.value)} autoComplete="tel" /></label>
                <label className="block sm:col-span-2"><span className={lbl}>Website</span><input className={inp} value={f.website} onChange={e => set('website', e.target.value)} placeholder="yourcompany.com" /></label>
              </div>
              <label className="block"><span className={lbl}>What best describes your business?</span>
                <select className={inp} value={f.business_type} onChange={e => set('business_type', e.target.value)}><option value="">Choose one</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
              </label>
              <div>
                <span className={lbl}>What are you interested in?</span>
                <div className="flex flex-wrap gap-2">{INTERESTS.map(i => { const on = f.interest.includes(i); return <button type="button" key={i} onClick={() => toggle(i)} className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${on ? 'text-white border-transparent' : 'text-gray-600 border-[#E4E6EE] bg-white'}`} style={on ? { background: GREEN } : {}}>{i}</button> })}</div>
              </div>
              <label className="block"><span className={lbl}>How did you hear about us?</span><input className={inp} value={f.how_heard} onChange={e => set('how_heard', e.target.value)} /></label>
              {/* honeypot */}
              <input tabIndex={-1} autoComplete="off" value={f.website_url} onChange={e => set('website_url', e.target.value)} className="hidden" aria-hidden="true" />
              <button disabled={busy} className="w-full rounded-xl py-3 text-white font-bold text-sm disabled:opacity-50" style={{ background: GREEN }}>{busy ? 'Creating account…' : 'Create account'}</button>
              <p className="text-center text-xs text-gray-500">Already have an account? <Link href="/portal" className="font-semibold" style={{ color: GREEN }}>Sign in</Link></p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
