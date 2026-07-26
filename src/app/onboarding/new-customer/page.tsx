'use client'

import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const F = {
  company_name: '', contact_name: '', email: '', phone: '', website: '',
  billing_address: '', shipping_address: '', resale_tax_id: '', how_heard: '', notes: '',
}

export default function NewCustomerPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [form, setForm] = useState({ ...F })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const inp = 'w-full bg-white border border-[#E4E6EE] focus:border-[#3B6FE0] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] focus:outline-none transition-colors'
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  async function submit() {
    setErr('')
    if (!form.company_name.trim()) { setErr('Please enter your company name.'); return }
    if (!form.email.trim() && !form.phone.trim()) { setErr('Please enter an email or phone so we can reach you.'); return }
    setSaving(true)
    const { error } = await sb.from('new_customer_submissions').insert({
      company_name: form.company_name.trim(),
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      billing_address: form.billing_address.trim() || null,
      shipping_address: form.shipping_address.trim() || null,
      resale_tax_id: form.resale_tax_id.trim() || null,
      how_heard: form.how_heard.trim() || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    if (error) { setErr('Something went wrong - please try again, or email us directly.'); return }
    setDone(true)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
        <div className="bg-white border border-[#E4E6EE] rounded-2xl max-w-md w-full p-8 text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#1A1D2E]">Thank you!</h1>
          <p className="text-sm text-gray-500 mt-2">Your information has been received. Our team will reach out to finish setting up your account.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1A1D2E]">New Customer Setup</h1>
          <p className="text-sm text-gray-500 mt-1">Tell us a bit about your business and we will get your account set up.</p>
        </div>
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">Company name *</label>
            <input className={inp} value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="Acme Co." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Contact name</label>
              <input className={inp} value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Website</label>
              <input className={inp} value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Email</label>
              <input className={inp} value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Phone</label>
              <input className={inp} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 555-5555" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">Billing address</label>
            <textarea rows={2} className={inp + ' resize-none'} value={form.billing_address} onChange={e => set('billing_address', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">Shipping address</label>
            <textarea rows={2} className={inp + ' resize-none'} value={form.shipping_address} onChange={e => set('shipping_address', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Resale / tax ID</label>
              <input className={inp} value={form.resale_tax_id} onChange={e => set('resale_tax_id', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">How did you hear about us?</label>
              <input className={inp} value={form.how_heard} onChange={e => set('how_heard', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">Anything else we should know?</label>
            <textarea rows={3} className={inp + ' resize-none'} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <button onClick={submit} disabled={saving}
            className="w-full bg-[#3B6FE0] hover:bg-[#325fc4] disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm">
            {saving ? 'Submitting...' : 'Submit'}
          </button>
          <p className="text-[11px] text-gray-400 text-center">By submitting, you agree to be contacted by our team about your account.</p>
        </div>
      </div>
    </div>
  )
}
