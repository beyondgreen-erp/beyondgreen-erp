'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import AuthShell, { AuthLink } from '@/components/portal/AuthShell'

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

  if (done) {
    return (
      <AuthShell eyebrow="Almost there" title={<>Check your <span className="pa-grad">inbox.</span></>} subtitle={<>We sent a link to <strong>{f.email}</strong>. Click it to confirm your email and set your password, and you&apos;ll land right in your portal.</>}
        below={<>Already have an account? <AuthLink href="/portal/forgot">Reset your password</AuthLink></>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, background: '#E4F7EE', color: '#0E9C45', display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 800 }}>✓</span>
          <div style={{ fontSize: 14, color: '#3D5446', lineHeight: 1.55 }}>The link expires in 48 hours. Don&apos;t see it? Check spam, or email <a className="pa-link" href="mailto:info@byndgrn.com">info@byndgrn.com</a>.</div>
        </div>
        <a href="/portal" className="pa-ghost" style={{ marginTop: 20 }}>Back to sign in</a>
      </AuthShell>
    )
  }

  return (
    <AuthShell eyebrow="Open an account" title={<>Work with us, <span className="pa-grad">without the back and forth.</span></>}
      subtitle="Start projects, book calls with our team, get quotes, place orders and upload POs, all in one place."
      below={<>Already have an account? <AuthLink href="/portal">Sign in</AuthLink></>}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        {err && <div className="pa-err">{err}</div>}
        <label><span className="pa-lbl">Company *</span><input className="pa-in" value={f.company} onChange={e => set('company', e.target.value)} autoComplete="organization" /></label>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <label><span className="pa-lbl">Your name *</span><input className="pa-in" value={f.name} onChange={e => set('name', e.target.value)} autoComplete="name" /></label>
          <label><span className="pa-lbl">Title</span><input className="pa-in" value={f.title} onChange={e => set('title', e.target.value)} autoComplete="organization-title" /></label>
          <label><span className="pa-lbl">Work email *</span><input type="email" className="pa-in" value={f.email} onChange={e => set('email', e.target.value)} autoComplete="email" /></label>
          <label><span className="pa-lbl">Phone</span><input type="tel" className="pa-in" value={f.phone} onChange={e => set('phone', e.target.value)} autoComplete="tel" /></label>
        </div>
        <label><span className="pa-lbl">What best describes your business?</span>
          <select className="pa-in" value={f.business_type} onChange={e => set('business_type', e.target.value)}><option value="">Choose one</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
        </label>
        <div>
          <span className="pa-lbl">What are you interested in?</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{INTERESTS.map(i => <button type="button" key={i} className="pa-chip" data-on={f.interest.includes(i) ? '1' : '0'} onClick={() => toggle(i)}>{i}</button>)}</div>
        </div>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <label><span className="pa-lbl">Website</span><input className="pa-in" value={f.website} onChange={e => set('website', e.target.value)} placeholder="yourcompany.com" /></label>
          <label><span className="pa-lbl">How did you hear about us?</span><input className="pa-in" value={f.how_heard} onChange={e => set('how_heard', e.target.value)} /></label>
        </div>
        <input tabIndex={-1} autoComplete="off" value={f.website_url} onChange={e => set('website_url', e.target.value)} style={{ display: 'none' }} aria-hidden="true" />
        <button className="pa-btn" disabled={busy} style={{ marginTop: 4 }}>{busy ? 'Creating your account…' : 'Create account  →'}</button>
        <p style={{ margin: 0, fontSize: 12, color: '#6B7F71', textAlign: 'center' }}>Free for customers. We confirm your email before anything is shared.</p>
      </form>
    </AuthShell>
  )
}
