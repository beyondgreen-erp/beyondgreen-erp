'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import PortalShell, { api, usePortal, GREEN, INK, cardCls, inputCls, labelCls, btnCls, btnGhostCls, fmtDate, FileDrop } from '@/components/portal/PortalShell'

const FILE_SLOTS = [
  { slot: 'Resale or tax-exempt certificate', hint: 'California: CDTFA-230. Other states: your resale or exemption form.' },
  { slot: 'Vendor setup forms for us to complete', hint: 'If your company needs us set up as a supplier, upload your packet and we will return it.' },
  { slot: 'Credit application or other', hint: 'Anything else that helps us set up your account.' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={`${cardCls} p-4 sm:p-5`}><h2 className="text-base font-bold mb-3" style={{ color: INK }}>{title}</h2>{children}</section>
}

function AccountBody() {
  const { account, customer, reload } = usePortal()
  const [ob, setOb] = useState<any>({})
  const [busy, setBusy] = useState<'' | 'save' | 'submit'>('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    const o = { ...(account?.onboarding || {}) }
    if (!o.billing_address && customer?.billing_address) o.billing_address = customer.billing_address
    if (!o.shipping_address && customer?.shipping_address) o.shipping_address = customer.shipping_address
    if (!o.legal_name && account?.company) o.legal_name = account.company
    if (!Array.isArray(o.trade_refs)) o.trade_refs = [{}, {}, {}]
    if (!Array.isArray(o.files)) o.files = []
    setOb(o)
  }, [account, customer])
  const set = (k: string, v: any) => setOb((p: any) => ({ ...p, [k]: v }))
  const setRef = (i: number, k: string, v: string) => setOb((p: any) => ({ ...p, trade_refs: p.trade_refs.map((r: any, j: number) => j === i ? { ...r, [k]: v } : r) }))
  const T = (k: string, label: string, props: any = {}) => <label className={`block ${props.full ? 'sm:col-span-2' : ''}`}><span className={labelCls}>{label}</span>{props.area ? <textarea rows={2} className={inputCls} value={ob[k] || ''} onChange={e => set(k, e.target.value)} /> : <input className={inputCls} type={props.type || 'text'} value={ob[k] || ''} onChange={e => set(k, e.target.value)} placeholder={props.ph} />}</label>
  const Y = (k: string, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-[#037f4c]" checked={!!ob[k]} onChange={e => set(k, e.target.checked)} />{label}</label>

  async function save(submit: boolean) {
    setErr(''); setMsg(''); setBusy(submit ? 'submit' : 'save')
    try {
      const { ok, data } = await api('onboarding-save', { onboarding: ob, submit })
      if (!ok) { setErr(data.error || 'Could not save.'); return }
      setMsg(submit ? 'Submitted. Our team will review and approve your account, usually within one business day.' : 'Saved.')
      await reload()
    } finally { setBusy('') }
  }

  const submitted = account?.onboarding_submitted_at
  return (
    <div className="space-y-4">
      <div className={`${cardCls} p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm`}>
        <div><span className="text-gray-400 text-xs block">Signed in as</span>{account?.name} · {account?.email}</div>
        <div><span className="text-gray-400 text-xs block">Account status</span>{account?.approved ? <span className="font-semibold" style={{ color: GREEN }}>Approved</span> : <span className="font-semibold text-amber-700">Pending approval</span>}</div>
        {customer?.payment_terms && <div><span className="text-gray-400 text-xs block">Payment terms</span>{customer.payment_terms}</div>}
        <div><span className="text-gray-400 text-xs block">Onboarding</span>{submitted ? `Submitted ${fmtDate(submitted)}` : 'Not submitted yet'}</div>
      </div>

      <Section title="Company">
        <div className="grid sm:grid-cols-2 gap-3">
          {T('legal_name', 'Legal company name')}{T('dba', 'DBA (if different)')}
          {T('website', 'Website')}{T('main_phone', 'Main phone', { type: 'tel' })}
          {T('business_type', 'Type of business')}{T('locations', 'Number of locations')}
          {T('years_in_business', 'Years in business')}{T('est_annual_spend', 'Estimated annual spend with us', { ph: 'e.g. $50,000' })}
        </div>
      </Section>

      <Section title="Contacts">
        <div className="grid sm:grid-cols-3 gap-3">
          {T('ap_name', 'Accounts payable contact')}{T('ap_email', 'AP email', { type: 'email' })}{T('ap_phone', 'AP phone', { type: 'tel' })}
          {T('receiving_name', 'Receiving contact')}{T('receiving_email', 'Receiving email', { type: 'email' })}{T('receiving_phone', 'Receiving phone', { type: 'tel' })}
        </div>
      </Section>

      <Section title="Billing and shipping">
        <div className="grid sm:grid-cols-2 gap-3">
          {T('billing_address', 'Billing address', { area: true })}{T('shipping_address', 'Main ship-to address', { area: true })}
          {T('receiving_hours', 'Receiving hours', { ph: 'e.g. Mon-Fri 7am-2pm' })}{T('freight_account', 'Your freight account (if you ship collect)')}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">{Y('liftgate', 'Liftgate needed')}{Y('appointment', 'Delivery appointment required')}{Y('residential', 'Residential or limited access')}{Y('will_call', 'We may pick up in Santa Ana')}</div>
      </Section>

      <Section title="Tax and payment">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className={labelCls}>Sales tax</span><select className={inputCls} value={ob.tax_status || ''} onChange={e => set('tax_status', e.target.value)}><option value="">Choose</option><option>Taxable</option><option>Resale (we resell these products)</option><option>Tax-exempt organization</option></select></label>
          {T('resale_number', "Seller's permit / resale or exemption number")}
          <label className="block"><span className={labelCls}>Preferred payment</span><select className={inputCls} value={ob.payment_method || ''} onChange={e => set('payment_method', e.target.value)}><option value="">Choose</option><option>ACH</option><option>Check</option><option>Credit card</option><option>Wire</option></select></label>
          <label className="block"><span className={labelCls}>Terms requested</span><select className={inputCls} value={ob.terms_requested || ''} onChange={e => set('terms_requested', e.target.value)}><option value="">Choose</option><option>Prepay</option><option>Net 15</option><option>Net 30</option><option>Other</option></select></label>
        </div>
        {(ob.terms_requested && ob.terms_requested !== 'Prepay') && (<>
          <p className="text-xs text-gray-500 mt-4 mb-2">For credit terms, add a bank reference and up to three trade references. Do not enter account numbers.</p>
          <div className="grid sm:grid-cols-3 gap-3">{T('bank_name', 'Bank')}{T('bank_contact', 'Bank contact')}{T('bank_phone', 'Bank phone', { type: 'tel' })}</div>
          <div className="mt-3 space-y-2">
            {(ob.trade_refs || []).map((r: any, i: number) => (
              <div key={i} className="grid sm:grid-cols-4 gap-2">
                <input className={inputCls} placeholder={`Trade reference ${i + 1}: company`} value={r.company || ''} onChange={e => setRef(i, 'company', e.target.value)} />
                <input className={inputCls} placeholder="Contact" value={r.contact || ''} onChange={e => setRef(i, 'contact', e.target.value)} />
                <input className={inputCls} placeholder="Phone" value={r.phone || ''} onChange={e => setRef(i, 'phone', e.target.value)} />
                <input className={inputCls} placeholder="Email" value={r.email || ''} onChange={e => setRef(i, 'email', e.target.value)} />
              </div>
            ))}
          </div>
        </>)}
      </Section>

      <Section title="Documents">
        <div className="grid sm:grid-cols-3 gap-3">
          {FILE_SLOTS.map(s => {
            const mine = (ob.files || []).filter((f: any) => f.slot === s.slot)
            return (
              <div key={s.slot}>
                <p className="text-sm font-semibold" style={{ color: INK }}>{s.slot}</p>
                <p className="text-[11px] text-gray-500 mb-2">{s.hint}</p>
                <FileDrop kind="onboarding" label="Upload" onUploaded={f => set('files', [...(ob.files || []), { ...f, slot: s.slot }])} />
                {mine.map((f: any) => <p key={f.path} className="text-xs mt-1">📎 {f.name} <button onClick={() => set('files', (ob.files || []).filter((x: any) => x.path !== f.path))} className="text-gray-400 hover:text-red-500 ml-1">remove</button></p>)}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Sign and submit">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="w-4 h-4 mt-0.5 accent-[#037f4c]" checked={!!ob.agree} onChange={e => set('agree', e.target.checked)} /><span>I certify this information is accurate, I am authorized to open this account, and beyondGREEN may contact the references above.</span></label>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">{T('signature', 'Type your full name as your signature')}{T('signer_title', 'Title')}</div>
        {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
        {msg && <p className="text-sm mt-3" style={{ color: GREEN }}>{msg}</p>}
        <div className="flex flex-wrap gap-2 justify-end mt-4">
          <button onClick={() => save(false)} disabled={!!busy} className={btnGhostCls}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
          <button onClick={() => save(true)} disabled={!!busy} className={btnCls} style={{ background: GREEN }}>{busy === 'submit' ? 'Submitting…' : submitted ? 'Resubmit updates' : 'Submit onboarding'}</button>
        </div>
      </Section>
    </div>
  )
}

export default function AccountPage() {
  return <PortalShell title="Account and onboarding" subtitle="Everything we need to set you up, in one place. Save anytime and come back."><AccountBody /></PortalShell>
}
