'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Quotes & RFQs > Inquiry Replies.
// For website / email inquiries about private label and custom pet waste bags: capture what the customer
// asked, work the costing, then write a customer-specific reply (humanizer rules) and a "next steps" PDF.
// The reply is edited here and copied into Outlook; nothing is sent from this screen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import {
  type InquiryForm, type Tier, CHANNELS, FORMATS, PACKAGINGS, DISPENSERS, CERTS, emptyForm, tierRows, suggestedCost, suggestedPrice,
  bagsPerUnit, unitName, plural, money, money4, int, pricingTableHtml, pricingTableText, factsForWriter, buildSteps,
  PACKAGING_MOQ, packagingMoqApplies, belowPackagingMoq,
  type ProductType, PRODUCT_TYPES, TOOLING_KINDS, CATALOG, defaultCerts, defaultMaterial, isBags, genRows, genSuggestedPrice, quoteSummary,
} from '@/lib/inquiryReply'
import { generateInquiryStepsPDF, stepsPdfName } from '@/lib/generateInquiryStepsPDF'

const inp = 'w-full rounded-md border border-[#E4E6EE] bg-white px-2.5 py-1.5 text-sm text-[#1A1D2E] focus:outline-none focus:border-[#0F766E]'
const lbl = 'block text-[11px] font-medium text-gray-500 mb-1'
const card = 'rounded-xl border border-[#E4E6EE] bg-white p-4'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><label className={lbl}>{label}</label>{children}</div>
}
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

interface Saved { id: string; company: string | null; brand: string | null; contact_name: string | null; subject: string | null; status: string; created_by: string | null; created_at: string; sent_at: string | null; customer_id: string | null; customers?: { company_name: string; pipeline_stage: string | null } | null }

export default function InquiryReplyBuilder() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState<{ email: string; name: string }>({ email: '', name: '' })
  const [f, setF] = useState<InquiryForm>(emptyForm())
  const [savedId, setSavedId] = useState<string | null>(null)
  const [lead, setLead] = useState<{ id: string; name: string; isNew: boolean } | null>(null)
  const [filter, setFilter] = useState<'All' | 'Sent' | 'Draft'>('All')
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [guidance, setGuidance] = useState('')
  const [busy, setBusy] = useState<'' | 'extract' | 'write' | 'pdf' | 'save'>('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [list, setList] = useState<Saved[]>([])
  const [pdfUrl, setPdfUrl] = useState('')
  const [aiHtml, setAiHtml] = useState('')
  const [past, setPast] = useState<{ brand: string; when: string; form: any }[]>([])
  const editor = useRef<HTMLDivElement>(null)
  const [pastCosts, setPastCosts] = useState<any[]>([])
  const [pastOpen, setPastOpen] = useState(true)

  // Costs we already know: our own SKUs on the inventory board and what similar private label rolls sold for.
  useEffect(() => {
    if (!isBags(f)) { setPastCosts([]); return }
    const t = setTimeout(async () => {
      const { data } = await sb.rpc('inquiry_past_costs', { p_width: f.widthIn, p_length: f.lengthIn, p_micron: f.micron, p_format: f.format })
      setPastCosts(((data as any[]) || []).filter(r => Number(r.match) >= 4))
    }, 400)
    return () => clearTimeout(t)
  }, [f.productType, f.widthIn, f.lengthIn, f.micron, f.format]) // eslint-disable-line

  const set = <K extends keyof InquiryForm>(k: K, v: InquiryForm[K]) => setF(p => ({ ...p, [k]: v }))
  const setTool = (patch: Partial<InquiryForm['tooling']>) => setF(p => ({ ...p, tooling: { ...p.tooling, ...patch } }))
  const setGen = (i: number, patch: Partial<{ qty: number; price: number | null }>) => setF(p => ({ ...p, genTiers: p.genTiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))
  function changeType(t: ProductType) {
    const d = defaultMaterial(t)
    setF(p => ({ ...p, productType: t, certs: defaultCerts(t), material: d.material, madeInSantaAna: d.santaAna, unitLabel: p.productType === t ? p.unitLabel : d.unit }))
  }
  const setTier = (i: number, patch: Partial<Tier>) => setF(p => ({ ...p, tiers: p.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))

  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser()
      const email = user?.email || ''
      let name = ''
      if (email) {
        const { data } = await sb.from('user_profiles').select('full_name,display_name').ilike('email', email).limit(1)
        name = (data?.[0] as any)?.full_name || (data?.[0] as any)?.display_name || ''
      }
      setMe({ email, name })
      setF(p => (p.preparedBy ? p : { ...p, preparedBy: name }))
    })()
    loadList()
  }, []) // eslint-disable-line

  async function loadList() {
    const { data } = await sb.from('inquiry_replies').select('id,company,brand,contact_name,subject,status,created_by,created_at,sent_at,customer_id,customers(company_name,pipeline_stage)').order('created_at', { ascending: false }).limit(200)
    setList((data as unknown as Saved[]) || [])
  }
  useEffect(() => { if (editor.current && editor.current.innerHTML !== html) editor.current.innerHTML = html }, [html])
  useEffect(() => {
    (async () => {
      const t = f.productType || 'Pet waste bags'
      const { data } = await sb.from('inquiry_replies').select('id,brand,company,sent_at,form').eq('status', 'Sent').eq('product_type', t).order('sent_at', { ascending: false }).limit(5)
      setPast(((data as any[]) || []).filter(r => r.id !== savedId).map(r => ({ brand: r.brand || r.company || 'a customer', when: new Date(r.sent_at).toLocaleDateString('en-US'), form: r.form || {} })))
    })()
  }, [f.productType, savedId]) // eslint-disable-line

  const rows = tierRows(f)
  const un = unitName(f)
  const steps = buildSteps(f)

  async function extract() {
    setErr(''); setMsg(''); setBusy('extract')
    try {
      const r = await fetch('/api/inquiry-reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'extract', text: f.inquiryText }) })
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'Could not read the message.')
      const d = j.data || {}
      setF(p => {
        const q: any = { ...p }
        for (const k of ['contactFirst', 'contactFull', 'company', 'brand', 'email', 'phone', 'location', 'launch', 'color', 'scent', 'sampleAddress']) if (d[k]) q[k] = String(d[k])
        for (const k of ['widthIn', 'lengthIn', 'micron', 'bagsPerRoll', 'rollsPerUnit']) if (d[k] != null && Number(d[k]) > 0) q[k] = Number(d[k])
        if (CHANNELS.includes(d.channel)) q.channel = d.channel
        if (FORMATS.includes(d.format)) q.format = d.format
        if (PACKAGINGS.includes(d.packaging)) q.packaging = d.packaging
        if (DISPENSERS.includes(d.dispenser)) q.dispenser = d.dispenser
        if (['None', 'Printed', 'Embossed (needs a mold)', 'Not decided yet'].includes(d.dispenserLogo)) q.dispenserLogo = d.dispenserLogo
        if (['None', '1 color print', 'Not decided yet'].includes(d.bagPrint)) q.bagPrint = d.bagPrint
        for (const k of ['logoReceived', 'artworkReceived', 'dielineReceived', 'samplesRequested']) if (typeof d[k] === 'boolean') q[k] = d[k]
        if (Array.isArray(d.questions) && d.questions.length) q.questions = d.questions.join('\n')
        if (PRODUCT_TYPES.includes(d.productType)) {
          const t = d.productType as ProductType, dm = defaultMaterial(t)
          q.productType = t; q.certs = defaultCerts(t); q.material = dm.material; q.madeInSantaAna = dm.santaAna; q.unitLabel = d.unitLabel ? String(d.unitLabel) : dm.unit
        }
        if (q.productType && q.productType !== 'Pet waste bags') {
          if (d.productDesc) q.productDesc = String(d.productDesc)
          if (Array.isArray(d.specs) && d.specs.length) q.specs = d.specs.map(String).join('\n')
          if (d.printNote) q.printNote = String(d.printNote)
          const qs = Array.isArray(d.quantities) ? d.quantities.map(Number).filter((x: number) => x > 0) : []
          if (qs.length) q.genTiers = qs.slice(0, 5).map((x: number) => ({ qty: x, price: null }))
          const need = d.toolingNeeded === true || d.toolingNeeded === 'true'
          q.tooling = { ...p.tooling, needed: need, kind: TOOLING_KINDS.includes(d.toolingKind) ? d.toolingKind : p.tooling.kind }
        }
        const units = Array.isArray(d.units) ? d.units.map(Number).filter((x: number) => x > 0) : []
        if (units.length) q.tiers = units.slice(0, 5).map((u: number) => ({ units: u, pricePerBag: null, packagingEach: null, dispenserQty: d.dispenserQty ? Number(d.dispenserQty) : null }))
        else if (d.dispenserQty) q.tiers = p.tiers.map(t => ({ ...t, dispenserQty: Number(d.dispenserQty) }))
        return q
      })
      setMsg('Form filled from the message. Please check every field before writing the reply.')
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  async function write() {
    setErr(''); setMsg(''); setBusy('write')
    try {
      if (!f.contactFirst.trim()) throw new Error('Add the contact first name.')
      const table = pricingTableHtml(f)
      const allowed = [table, money(Number(f.plateCharge) || 0), money(Number(f.dispenserEach) || 0), money(Number(f.moldCost) || 0, 0), pricingTableText(f)].join(' ')
      const r = await fetch('/api/inquiry-reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'write', facts: factsForWriter(f), tableHtml: table, allowedMoney: allowed, guidance, replyId: savedId }) })
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'The writer did not answer.')
      setSubject(j.data.subject || ''); setHtml(j.data.html || ''); setAiHtml(j.data.html || ''); setWarnings(j.data.warnings || [])
      setMsg(`Reply written${j.data.learnedFrom ? `, using ${j.data.learnedFrom} past ${j.data.learnedFrom === 1 ? 'reply' : 'replies'} for this kind of product as a guide` : ''}. Read it, edit anything right in the box, then copy it into Outlook.`)
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  async function copyEmail() {
    const el = editor.current; if (!el) return
    const h = `<div style="font-family:Arial,sans-serif;font-size:11pt">${el.innerHTML}</div>`
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([h], { type: 'text/html' }), 'text/plain': new Blob([el.innerText], { type: 'text/plain' }) })])
    } catch {
      const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); document.execCommand('copy'); s?.removeAllRanges()
    }
    try {
      const r = await recordSent()
      setMsg(`Email copied and logged as sent. ${r.isNew ? 'New lead added' : 'Linked to'} "${r.name}" on the Customers board. Paste it into your Outlook reply.`)
    } catch (e: any) {
      setMsg('Email copied. Paste it into your Outlook reply.'); setErr(`It was not logged: ${e.message || e}. Press Save to try again.`)
    }
  }

  // Find the customer by email, then by company or brand name. If none, add them to the Leads board.
  async function findOrCreateLead(): Promise<{ id: string; name: string; isNew: boolean }> {
    if (lead) return lead
    const email = f.email.trim()
    const names = [f.company, f.brand].map(x => (x || '').trim()).filter(Boolean)
    let hit: any = null
    if (email) {
      const { data } = await sb.from('customers').select('id,company_name').ilike('email', email).not('is_merged', 'is', true).limit(1)
      hit = data?.[0]
    }
    for (const n of names) {
      if (hit) break
      const { data } = await sb.from('customers').select('id,company_name').ilike('company_name', n).not('is_merged', 'is', true).limit(1)
      hit = data?.[0]
    }
    if (hit) { const r = { id: hit.id, name: hit.company_name, isNew: false }; setLead(r); return r }
    const [city, state] = (f.location || '').split(',').map(s => s.trim())
    const top = quoteSummary(f).reduce((m, r) => Math.max(m, r.total), 0)
    const name = f.company.trim() || f.brand.trim() || f.contactFull.trim() || f.contactFirst.trim()
    if (!name) throw new Error('Add the company or brand name first.')
    const follow = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
    const { data, error } = await sb.from('customers').insert({
      company_name: name, contact_name: f.contactFull || f.contactFirst || null, email: email || null, phone: f.phone || null,
      city: city || null, state: state || null, board: 'Leads', account_type: 'lead', customer_status: 'Lead', pipeline_stage: 'Contacted',
      lead_source: 'Website inquiry', industry: isBags(f) ? 'Pet products' : (f.productType || null), priority: 'medium', deal_value: Math.round(top), payment_terms: f.paymentTerms || null,
      contacted_at: new Date().toISOString(), next_follow_up: follow,
      notes: isBags(f)
        ? `Private label inquiry${f.brand ? ` for ${f.brand}` : ''} (${f.channel}). ${f.widthIn} x ${f.lengthIn} in, ${f.micron} micron, ${f.bagsPerRoll} bags per roll, ${f.rollsPerUnit} rolls per ${un}. Quantities: ${rows.map(r => `${int(r.units)} ${plural(un, r.units)}`).join(', ')}.`
        : `${f.productType} inquiry${f.brand ? ` for ${f.brand}` : ''}: ${f.productDesc || 'see the reply'}. Quantities: ${genRows(f).map(r => `${int(r.qty)} ${plural(un, r.qty)}`).join(', ')}.${f.tooling.needed ? ` Needs ${f.tooling.kind.toLowerCase()}.` : ''}`,
    }).select('id,company_name').single()
    if (error) throw error
    const r = { id: (data as any).id, name: (data as any).company_name, isNew: true }; setLead(r); return r
  }

  async function recordSent() {
    const c = await findOrCreateLead()
    const id = await save(true, c.id)
    const { data: cur } = await sb.from('inquiry_replies').select('conversation_id').eq('id', id).single()
    if (!(cur as any)?.conversation_id) {
      const text = (editor.current?.innerText || '').slice(0, 8000)
      const { data: conv } = await sb.from('customer_conversations').insert({
        customer_id: c.id, logged_by: me.email || 'erp', conversation_type: 'email', subject: subject || `${f.productType || 'Product'} inquiry reply`,
        content: text, contact_name: f.contactFull || f.contactFirst || null, outcome: 'Reply sent with pricing and next steps PDF',
        follow_up_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), follow_up_notes: 'Check they received the pricing and next steps PDF.',
      }).select('id').single()
      await sb.from('inquiry_replies').update({ conversation_id: (conv as any)?.id || null }).eq('id', id)
      if (!c.isNew) await sb.from('customers').update({ contacted_at: new Date().toISOString() }).eq('id', c.id)
    }
    loadList()
    return c
  }

  async function pdf(download: boolean) {
    setErr(''); setBusy('pdf')
    try {
      const blob = await generateInquiryStepsPDF(f, { download })
      if (!download) { if (pdfUrl) URL.revokeObjectURL(pdfUrl); setPdfUrl(URL.createObjectURL(blob)) }
    } catch (e: any) { setErr(e.message || 'Could not build the PDF.') } finally { setBusy('') }
  }

  async function save(sent = false, customerId?: string): Promise<string> {
    setErr(''); if (!sent) setBusy('save')
    try {
      const row: any = { company: f.company || null, brand: f.brand || null, contact_name: f.contactFull || f.contactFirst || null, contact_email: f.email || null, form: f as any, subject, email_html: editor.current?.innerHTML || html, product_type: f.productType || 'Pet waste bags', created_by: me.email || null, updated_at: new Date().toISOString() }
      if (aiHtml) row.ai_html = aiHtml
      if (customerId || lead?.id) row.customer_id = customerId || lead?.id
      if (sent) { row.status = 'Sent'; row.sent_at = new Date().toISOString(); row.sent_by = me.email || null }
      let id = savedId
      if (id) { const { error } = await sb.from('inquiry_replies').update(row).eq('id', id); if (error) throw error }
      else { const { data, error } = await sb.from('inquiry_replies').insert(row).select('id').single(); if (error) throw error; id = (data as any).id; setSavedId(id) }
      if (!sent) { setMsg('Saved as a draft.'); loadList() }
      return id as string
    } catch (e: any) { if (sent) throw e; setErr(e.message || 'Could not save.'); return '' } finally { if (!sent) setBusy('') }
  }

  async function open(id: string) {
    const { data } = await sb.from('inquiry_replies').select('*').eq('id', id).single()
    if (!data) return
    setF({ ...emptyForm(me.name), ...(data as any).form }); setSubject((data as any).subject || ''); setHtml((data as any).email_html || ''); setAiHtml((data as any).ai_html || ''); setSavedId(id); setLead((data as any).customer_id ? { id: (data as any).customer_id, name: (data as any).company || '', isNew: false } : null); setWarnings([]); setMsg('Opened a saved reply.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function reset() { setF(emptyForm(me.name)); setSubject(''); setHtml(''); setAiHtml(''); setSavedId(null); setLead(null); setWarnings([]); setMsg(''); setErr('') }

  const sugCost = suggestedCost(f)
  const lastNums = (pf: any) => {
    const bits: string[] = []
    const u = pf.unitLabel || 'piece'
    if (pf.productType && pf.productType !== 'Pet waste bags') {
      if (pf.costEach) bits.push(`cost ${money4(Number(pf.costEach))}/${u}`)
      const pr = (pf.genTiers || []).filter((t: any) => t.price).map((t: any) => `${int(Number(t.qty))} at ${money4(Number(t.price))}`)
      if (pr.length) bits.push(`priced ${pr.join(', ')}`)
      if (pf.tooling?.needed) bits.push(`${pf.tooling.kind}${pf.tooling.cost ? ` ${money(Number(pf.tooling.cost), 0)}` : ''}${pf.tooling.moq ? `, min ${pf.tooling.moq}` : ''}${pf.tooling.leadTime ? `, ${pf.tooling.leadTime}` : ''}`)
    } else {
      if (pf.costPerBag) bits.push(`cost ${money4(Number(pf.costPerBag))}/bag`)
      const pr = (pf.tiers || []).filter((t: any) => t.pricePerBag).map((t: any) => `${int(Number(t.units))} at ${money4(Number(t.pricePerBag))}/bag`)
      if (pr.length) bits.push(`priced ${pr.join(', ')}`)
    }
    if (pf.leadTime) bits.push(`lead time ${pf.leadTime}`)
    return bits.join(' · ')
  }
  const applyLast = (pf: any) => setF(p => isBags(p)
    ? { ...p, costPerBag: pf.costPerBag ?? p.costPerBag, leadTime: pf.leadTime || p.leadTime, paymentTerms: (pf.paymentTerms && pf.paymentTerms !== 'Prepayment for new accounts' ? pf.paymentTerms : p.paymentTerms) }
    : { ...p, costEach: pf.costEach ?? p.costEach, leadTime: pf.leadTime || p.leadTime, paymentTerms: (pf.paymentTerms && pf.paymentTerms !== 'Prepayment for new accounts' ? pf.paymentTerms : p.paymentTerms),
        tooling: pf.tooling?.needed && p.tooling.needed ? { ...p.tooling, kind: pf.tooling.kind || p.tooling.kind, cost: pf.tooling.cost ?? p.tooling.cost, moq: pf.tooling.moq || p.tooling.moq, leadTime: pf.tooling.leadTime || p.tooling.leadTime } : p.tooling })
  const pastHint = past.filter(x => lastNums(x.form)).length ? (
    <div className="mb-3 rounded-lg bg-sky-50 border border-sky-100 p-2.5">
      <div className="text-[11px] font-semibold text-sky-800 mb-1">Last time for {f.productType || 'Pet waste bags'} (from replies we sent)</div>
      {past.filter(x => lastNums(x.form)).slice(0, 3).map((x, i) => (
        <div key={i} className="flex items-center justify-between gap-2 text-[11px] text-sky-900 py-0.5">
          <span className="min-w-0"><b>{x.brand}</b>, {x.when}: {lastNums(x.form)}</span>
          <button onClick={() => applyLast(x.form)} className="shrink-0 px-2 py-0.5 rounded border border-sky-200 bg-white text-sky-800 hover:bg-sky-100">Use these</button>
        </div>
      ))}
    </div>
  ) : null

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
      {/* LEFT: what they asked + costing */}
      <div className="space-y-4 min-w-0">
        <div className={card}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-[#1A1D2E]">1. Paste the customer&apos;s message</h3>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-800">Start a new reply</button>
          </div>
          <textarea value={f.inquiryText} onChange={e => set('inquiryText', e.target.value)} rows={6} placeholder="Paste the website form or their email here (the whole thread is fine)." className={inp} />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button onClick={extract} disabled={!f.inquiryText.trim() || !!busy} className="text-sm font-medium px-3 py-1.5 rounded-md bg-[#0F766E] text-white disabled:opacity-50">{busy === 'extract' ? 'Reading…' : 'Fill the form from this message'}</button>
            <span className="text-xs text-gray-400">Or fill the fields by hand. Vague inquiry? Fill what you know and the reply will ask for the rest.</span>
          </div>
        </div>

        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1A1D2E] mb-3">2. Who they are</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Contact first name *"><input className={inp} value={f.contactFirst} onChange={e => set('contactFirst', e.target.value)} /></Field>
            <Field label="Contact full name"><input className={inp} value={f.contactFull} onChange={e => set('contactFull', e.target.value)} /></Field>
            <Field label="Company"><input className={inp} value={f.company} onChange={e => set('company', e.target.value)} /></Field>
            <Field label="Brand"><input className={inp} value={f.brand} onChange={e => set('brand', e.target.value)} /></Field>
            <Field label="Email"><input className={inp} value={f.email} onChange={e => set('email', e.target.value)} /></Field>
            <Field label="Location"><input className={inp} value={f.location} onChange={e => set('location', e.target.value)} placeholder="Orlando, FL" /></Field>
            <Field label="Where they will sell"><select className={inp} value={f.channel} onChange={e => set('channel', e.target.value as any)}>{CHANNELS.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="How they found us"><input className={inp} value={f.source} onChange={e => set('source', e.target.value)} /></Field>
            <Field label="Launch timing"><input className={inp} value={f.launch} onChange={e => set('launch', e.target.value)} placeholder="Spring 2027, still finalizing…" /></Field>
          </div>
          <Field label="Their questions and requests, one per line, in their order" className="mt-3">
            <textarea className={inp} rows={4} value={f.questions} onChange={e => set('questions', e.target.value)} placeholder={'Price per box at 1,000 and 3,000\nBPI and OK Compost certificate numbers\nDispenser with logo, 1,000 pcs'} />
          </Field>
        </div>

        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1A1D2E] mb-3">3. The product</h3>
          <Field label="What is the inquiry about?" className="mb-3"><select className={inp} value={f.productType || 'Pet waste bags'} onChange={e => changeType(e.target.value as ProductType)}>{PRODUCT_TYPES.map(c => <option key={c}>{c}</option>)}</select></Field>
          {isBags(f) ? (<>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Format" className="col-span-2 md:col-span-1"><select className={inp} value={f.format} onChange={e => set('format', e.target.value as any)}>{FORMATS.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Width (in)"><input className={inp} type="number" value={f.widthIn ?? ''} onChange={e => set('widthIn', numOrNull(e.target.value))} /></Field>
            <Field label="Length (in)"><input className={inp} type="number" value={f.lengthIn ?? ''} onChange={e => set('lengthIn', numOrNull(e.target.value))} /></Field>
            <Field label="Thickness (micron)"><input className={inp} type="number" value={f.micron ?? ''} onChange={e => set('micron', numOrNull(e.target.value))} /></Field>
            <Field label="Bags per roll"><input className={inp} type="number" value={f.bagsPerRoll ?? ''} onChange={e => set('bagsPerRoll', numOrNull(e.target.value))} /></Field>
            <Field label={`Rolls per ${un}`}><input className={inp} type="number" value={f.rollsPerUnit ?? ''} onChange={e => set('rollsPerUnit', numOrNull(e.target.value))} /></Field>
            <Field label="Color"><input className={inp} value={f.color} onChange={e => set('color', e.target.value)} /></Field>
            <Field label="Scent"><input className={inp} value={f.scent} onChange={e => set('scent', e.target.value)} /></Field>
            <Field label="Print on bags"><select className={inp} value={f.bagPrint} onChange={e => set('bagPrint', e.target.value as any)}>{['None', '1 color print', 'Not decided yet'].map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Packaging" className="col-span-2 md:col-span-1"><select className={inp} value={f.packaging} onChange={e => set('packaging', e.target.value as any)}>{PACKAGINGS.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Dispenser"><select className={inp} value={f.dispenser} onChange={e => set('dispenser', e.target.value as any)}>{DISPENSERS.map(c => <option key={c}>{c}</option>)}</select></Field>
            {f.dispenser !== 'None' && <Field label="Logo on dispenser"><select className={inp} value={f.dispenserLogo} onChange={e => set('dispenserLogo', e.target.value as any)}>{['None', 'Printed', 'Embossed (needs a mold)', 'Not decided yet'].map(c => <option key={c}>{c}</option>)}</select></Field>}
          </div>
          <div className="mt-3 text-xs text-gray-500">{int(bagsPerUnit(f))} bags per {un}.</div>
          </>) : (<>
            {CATALOG.some(c => c.type === f.productType) && (
              <Field label="Start from one of our stock items (optional, fills cost and specs)" className="mb-3">
                <select className={inp} value="" onChange={e => { const c = CATALOG.find(x => x.label === e.target.value); if (c) setF(p => ({ ...p, costEach: c.cost, unitLabel: c.unit, specs: p.specs.trim() ? p.specs : c.specs, alternative: p.tooling.needed && !p.alternative ? c.label : p.alternative, pricesFor: p.tooling.needed ? 'alternative' : 'item' })) }}>
                  <option value="">Choose a stock item…</option>{CATALOG.filter(c => c.type === f.productType).map(c => <option key={c.label} value={c.label}>{c.label} ({money4(c.cost)} cost)</option>)}
                </select>
              </Field>
            )}
            <Field label="What they want, in one sentence"><textarea className={inp} rows={2} value={f.productDesc} onChange={e => set('productDesc', e.target.value)} placeholder="Solid green straw with a three-leaf shamrock-shaped opening the whole length" /></Field>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Field label="Specs, one per line (Label: value)" className="md:col-span-2"><textarea className={inp} rows={4} value={f.specs} onChange={e => set('specs', e.target.value)} placeholder={'Color: solid green\nShape: three-leaf shamrock opening\nLength: 7.75 in'} /></Field>
              <div className="space-y-3">
                <Field label="They count in (singular)"><input className={inp} value={f.unitLabel} onChange={e => set('unitLabel', e.target.value)} placeholder="straw, fork, cup, case" /></Field>
                <Field label="Printing or branding"><input className={inp} value={f.printNote} onChange={e => set('printNote', e.target.value)} placeholder="Logo on the wrapper…" /></Field>
              </div>
              <Field label="Material (shown to the customer)" className="md:col-span-2"><input className={inp} value={f.material} onChange={e => set('material', e.target.value)} /></Field>
              <label className="flex items-center gap-1.5 text-sm text-gray-700 mt-5"><input type="checkbox" checked={f.madeInSantaAna} onChange={e => set('madeInSantaAna', e.target.checked)} />Made at our Santa Ana facility</label>
            </div>
            <div className="mt-3 rounded-lg border border-[#E4E6EE] p-3">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-800"><input type="checkbox" checked={f.tooling.needed} onChange={e => setTool({ needed: e.target.checked })} />Needs new tooling (custom shape, size or new item)</label>
              {f.tooling.needed && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <Field label="Tooling type"><select className={inp} value={f.tooling.kind} onChange={e => setTool({ kind: e.target.value })}>{TOOLING_KINDS.map(c => <option key={c}>{c}</option>)}</select></Field>
                  <Field label="One-time cost (blank = quoted later)"><input className={inp} type="number" value={f.tooling.cost ?? ''} onChange={e => setTool({ cost: numOrNull(e.target.value) })} /></Field>
                  <Field label="Minimum run"><input className={inp} value={f.tooling.moq} onChange={e => setTool({ moq: e.target.value })} placeholder="250,000 straws" /></Field>
                  <Field label="Tooling lead time"><input className={inp} value={f.tooling.leadTime} onChange={e => setTool({ leadTime: e.target.value })} placeholder="6 to 8 weeks" /></Field>
                  <Field label="Note on the tooling (optional)" className="col-span-2 md:col-span-4"><input className={inp} value={f.tooling.note} onChange={e => setTool({ note: e.target.value })} placeholder="The die is theirs; we keep it on file for reorders…" /></Field>
                  <Field label="What we can offer now instead (optional)" className="col-span-2 md:col-span-4"><input className={inp} value={f.alternative} onChange={e => set('alternative', e.target.value)} placeholder="Our stock solid green 7.75 in jumbo straw, in stock now" /></Field>
                </div>
              )}
            </div>
          </>)}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {([['logoReceived', 'We have their logo'], ['artworkReceived', 'We have final artwork'], ['dielineReceived', 'They have a dieline'], ['samplesRequested', 'Send samples']] as const).map(([k, t]) => (
              <label key={k} className="flex items-center gap-1.5 text-gray-700"><input type="checkbox" checked={!!(f as any)[k]} onChange={e => set(k as any, e.target.checked as any)} />{t}</label>
            ))}
          </div>
          {f.samplesRequested && <Field label="Sample ship-to address" className="mt-3"><textarea className={inp} rows={2} value={f.sampleAddress} onChange={e => set('sampleAddress', e.target.value)} /></Field>}
        </div>

        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#1A1D2E]">4. Costing</h3>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Cost and margin are internal only</span>
          </div>
          {pastHint}
          {isBags(f) ? (<>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Our cost per bag"><input className={inp} type="number" step="0.0001" value={f.costPerBag ?? ''} placeholder={String(sugCost)} onChange={e => set('costPerBag', numOrNull(e.target.value))} /></Field>
            <Field label="Price basis"><select className={inp} value={f.basis} onChange={e => set('basis', e.target.value as any)}><option>FOB Santa Ana, CA</option><option>Delivered (DDP)</option></select></Field>
            {f.dispenser !== 'None' && <Field label="Dispenser price each"><input className={inp} type="number" step="0.01" value={f.dispenserEach ?? ''} onChange={e => set('dispenserEach', numOrNull(e.target.value))} /></Field>}
            {f.bagPrint === '1 color print' && <Field label="Plate charge (one time)"><input className={inp} type="number" value={f.plateCharge ?? ''} onChange={e => set('plateCharge', numOrNull(e.target.value))} /></Field>}
            {(f.dispenser === 'Custom molded dispenser (new mold)' || f.dispenserLogo === 'Embossed (needs a mold)') && <Field label="Mold cost (one time)"><input className={inp} type="number" value={f.moldCost ?? ''} onChange={e => set('moldCost', numOrNull(e.target.value))} /></Field>}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">Blank cost uses {money4(sugCost)} per bag: the 9 x 12 in, 18 micron folded roll cost scaled by size and thickness. Blank prices use cost at 20% margin plus the private label volume markup (Pricing Calculator rules). Overwrite anything.</p>

          {pastCosts.length > 0 && (
            <div className="mt-3 rounded-lg border border-[#E4E6EE] bg-[#F8FAF9]">
              <button onClick={() => setPastOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[#1A1D2E]">
                <span>From our records: similar bags we already make or sold ({pastCosts.length})</span><span className="text-gray-400">{pastOpen ? 'Hide' : 'Show'}</span>
              </button>
              {pastOpen && (
                <div className="overflow-x-auto px-3 pb-3">
                  <table className="w-full text-xs min-w-[640px]">
                    <thead><tr className="text-[10px] text-gray-500 text-left">
                      <th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Size</th><th className="py-1 pr-2">Source</th>
                      <th className="py-1 pr-2 text-right">Per bag</th><th className="py-1 pr-2 text-right">Scaled to this bag</th><th />
                    </tr></thead>
                    <tbody>
                      {pastCosts.map((r, i) => (
                        <tr key={i} className="border-t border-[#E9ECF2]">
                          <td className="py-1.5 pr-2"><div className="font-medium text-[#1A1D2E]">{r.sku}</div><div className="text-[10px] text-gray-500 truncate max-w-[260px]">{r.name}</div></td>
                          <td className="py-1.5 pr-2 whitespace-nowrap">{r.size || '?'}{r.micron ? `, ${Number(r.micron)} mic` : ''}</td>
                          <td className="py-1.5 pr-2">{r.kind === 'cost'
                            ? <span>Inventory cost {money4(Number(r.per_unit))} per {r.unit_label} of {int(Number(r.bags_per_unit))} bags</span>
                            : <span>Sold at {money4(Number(r.per_unit))} per roll of {int(Number(r.bags_per_unit))}{r.customer ? ` to ${r.customer}` : ''}{r.last_date ? `, ${new Date(r.last_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}</span>}</td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap">{money4(Number(r.per_bag))}</td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap font-medium">{money4(Number(r.scaled_per_bag))}</td>
                          <td className="py-1.5 text-right whitespace-nowrap">{r.kind === 'cost'
                            ? <button onClick={() => set('costPerBag', Number(r.scaled_per_bag))} className="text-[11px] font-semibold text-[#0F766E] hover:underline">Use as cost</button>
                            : <span className="text-[10px] text-gray-400">price reference</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-gray-400 mt-1.5">Inventory cost is the unit cost on the Inventory board divided by bags per pack, so it can include our own retail box. Scaled to this bag adjusts for size and thickness. Sold prices are what private label customers paid, for reference only.</p>
                </div>
              )}
            </div>
          )}
          {packagingMoqApplies(f) && (
            <div className={`mt-3 text-[11px] rounded-md px-3 py-2 ${f.tiers.some(t => belowPackagingMoq(f, Number(t.units))) ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600'}`}>
              Packaging minimum: {int(PACKAGING_MOQ)} {plural(un, 2)} per design. {f.tiers.some(t => belowPackagingMoq(f, Number(t.units)))
                ? <>Smaller quantities are still quoted, but the packaging is billed at {int(PACKAGING_MOQ)} {plural(un, 2)} and the reply and price table tell the customer they buy {int(PACKAGING_MOQ)} printed {plural(un, 2)} regardless.</>
                : 'Every quantity in the table meets it.'}
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-[11px] text-gray-500 text-left">
                <th className="py-1 pr-2">{plural(un, 2).replace(/^./, c => c.toUpperCase())}</th><th className="py-1 pr-2">Price per bag</th><th className="py-1 pr-2">Packaging per {un}</th>
                {f.dispenser !== 'None' && <th className="py-1 pr-2">Dispensers</th>}<th className="py-1 pr-2 text-right">Per {un}</th><th className="py-1 pr-2 text-right">Total</th><th className="py-1 text-right">Margin</th><th />
              </tr></thead>
              <tbody>
                {f.tiers.map((t, i) => {
                  const r = rows.find(x => x.units === Number(t.units))
                  return (
                    <tr key={i} className="border-t border-[#F0F2F7]">
                      <td className="py-1.5 pr-2 w-24"><input className={`${inp} ${belowPackagingMoq(f, Number(t.units)) ? 'border-amber-300' : ''}`} type="number" value={t.units || ''} onChange={e => setTier(i, { units: Number(e.target.value) })} />{belowPackagingMoq(f, Number(t.units)) && <div className="text-[10px] text-amber-700 mt-0.5">Packaging billed at {int(PACKAGING_MOQ)}</div>}</td>
                      <td className="py-1.5 pr-2 w-28"><input className={inp} type="number" step="0.0001" value={t.pricePerBag ?? ''} placeholder={t.units ? String(suggestedPrice(f, Number(t.units))) : ''} onChange={e => setTier(i, { pricePerBag: numOrNull(e.target.value) })} /></td>
                      <td className="py-1.5 pr-2 w-28"><input className={inp} type="number" step="0.01" value={t.packagingEach ?? ''} placeholder="TBC" onChange={e => setTier(i, { packagingEach: numOrNull(e.target.value) })} /></td>
                      {f.dispenser !== 'None' && <td className="py-1.5 pr-2 w-24"><input className={inp} type="number" value={t.dispenserQty ?? ''} onChange={e => setTier(i, { dispenserQty: numOrNull(e.target.value) })} /></td>}
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{r ? money(r.pricePerUnit) : ''}{r?.pricePerRoll != null && <div className="text-[10px] text-gray-400">{money4(r.pricePerRoll)}/roll</div>}</td>
                      <td className="py-1.5 pr-2 text-right font-medium whitespace-nowrap">{r ? money(r.total) : ''}</td>
                      <td className={`py-1.5 text-right text-xs whitespace-nowrap ${r && r.marginPct != null && r.marginPct < 0.15 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{r && r.marginPct != null ? `${Math.round(r.marginPct * 100)}%` : ''}</td>
                      <td className="py-1.5 pl-2 text-right">{f.tiers.length > 1 && <button onClick={() => setF(p => ({ ...p, tiers: p.tiers.filter((_, j) => j !== i) }))} className="text-gray-300 hover:text-red-500 text-xs">✕</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {f.tiers.length < 5 && <button onClick={() => setF(p => ({ ...p, tiers: [...p.tiers, { units: 0, pricePerBag: null, packagingEach: null, dispenserQty: null }] }))} className="mt-2 text-xs font-medium text-[#0F766E]">+ Add a quantity</button>}
          </div>

          </>) : (<>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label={`Our cost per ${un}`}><input className={inp} type="number" step="0.0001" value={f.costEach ?? ''} placeholder="Enter or pick a stock item" onChange={e => set('costEach', numOrNull(e.target.value))} /></Field>
              <Field label="Price basis"><select className={inp} value={f.basis} onChange={e => set('basis', e.target.value as any)}><option>FOB Santa Ana, CA</option><option>Delivered (DDP)</option></select></Field>
              {f.alternative.trim() && <Field label="These prices are for" className="col-span-2"><select className={inp} value={f.pricesFor || 'item'} onChange={e => set('pricesFor', e.target.value as any)}><option value="item">The item they asked for</option><option value="alternative">Our stock option: {f.alternative.slice(0, 40)}</option></select></Field>}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Blank prices use our cost at 20% margin (SKU pricing sheet rule). Leave cost and price blank if we cannot price it yet; the reply will say pricing follows.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead><tr className="text-[11px] text-gray-500 text-left"><th className="py-1 pr-2">Quantity ({plural(un, 2)})</th><th className="py-1 pr-2">Price per {un}</th><th className="py-1 pr-2 text-right">Total</th><th className="py-1 text-right">Margin</th><th /></tr></thead>
                <tbody>
                  {f.genTiers.map((t, i) => {
                    const r = genRows(f).find(x => x.qty === Number(t.qty))
                    const sp = genSuggestedPrice(f)
                    return (
                      <tr key={i} className="border-t border-[#F0F2F7]">
                        <td className="py-1.5 pr-2 w-32"><input className={inp} type="number" value={t.qty || ''} onChange={e => setGen(i, { qty: Number(e.target.value) })} /></td>
                        <td className="py-1.5 pr-2 w-32"><input className={inp} type="number" step="0.0001" value={t.price ?? ''} placeholder={sp != null ? String(sp) : 'TBC'} onChange={e => setGen(i, { price: numOrNull(e.target.value) })} /></td>
                        <td className="py-1.5 pr-2 text-right font-medium whitespace-nowrap">{r?.total != null ? money(r.total) : 'TBC'}</td>
                        <td className={`py-1.5 text-right text-xs whitespace-nowrap ${r && r.marginPct != null && r.marginPct < 0.15 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{r && r.marginPct != null ? `${Math.round(r.marginPct * 100)}%` : ''}</td>
                        <td className="py-1.5 pl-2 text-right">{f.genTiers.length > 1 && <button onClick={() => setF(p => ({ ...p, genTiers: p.genTiers.filter((_, j) => j !== i) }))} className="text-gray-300 hover:text-red-500 text-xs">✕</button>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {f.genTiers.length < 5 && <button onClick={() => setF(p => ({ ...p, genTiers: [...p.genTiers, { qty: 0, price: null }] }))} className="mt-2 text-xs font-medium text-[#0F766E]">+ Add a quantity</button>}
              {f.tooling.needed && <div className="mt-2 text-xs text-gray-600">{f.tooling.kind}: {f.tooling.cost ? money(Number(f.tooling.cost), 0) + ' one time' : 'quoted later'}{f.tooling.moq ? `, minimum run ${f.tooling.moq}` : ''}</div>}
            </div>
          </>)}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Field label="Payment terms"><input className={inp} value={f.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} /></Field>
            <Field label="Lead time"><input className={inp} value={f.leadTime} onChange={e => set('leadTime', e.target.value)} /></Field>
            <Field label="Quote # (if attached)"><input className={inp} value={f.quoteNumber} onChange={e => set('quoteNumber', e.target.value)} placeholder="Q-2026-…" /></Field>
            <Field label="Freight note" className="md:col-span-3"><input className={inp} value={f.freightNote} onChange={e => set('freightNote', e.target.value)} /></Field>
          </div>
          <div className="mt-3">
            <div className={lbl}>Certifications to include</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {CERTS.map(c => <label key={c.key} className="flex items-center gap-1.5 text-gray-700"><input type="checkbox" checked={f.certs.includes(c.key)} onChange={e => set('certs', e.target.checked ? [...f.certs, c.key] : f.certs.filter(x => x !== c.key))} />{c.label}</label>)}
            </div>
          </div>
        </div>

        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1A1D2E] mb-2">5. Anything you want said your way</h3>
          <textarea className={inp} rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. We already make a similar 20-roll box for another Amazon brand, happy to send a photo. Mention we can do lavender later." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Field label="Prepared by (shown on the PDF)"><input className={inp} value={f.preparedBy} onChange={e => set('preparedBy', e.target.value)} /></Field>
            <Field label="Tone or focus for this one (optional)"><input className={inp} value={guidance} onChange={e => setGuidance(e.target.value)} placeholder="Short and friendly, they are price shopping…" /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={write} disabled={!!busy} className="text-sm font-semibold px-4 py-2 rounded-md bg-[#0F766E] text-white disabled:opacity-50">{busy === 'write' ? 'Writing the reply…' : html ? 'Rewrite the reply' : 'Write the reply'}</button>
            <button onClick={() => pdf(false)} disabled={!!busy} className="text-sm font-medium px-3 py-2 rounded-md border border-[#E4E6EE] text-gray-700 disabled:opacity-50">Preview next steps PDF</button>
          </div>
        </div>
      </div>

      {/* RIGHT: output */}
      <div className="space-y-4 min-w-0">
        {(err || msg) && <div className={`rounded-lg px-3 py-2 text-sm ${err ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>{err || msg}</div>}
        <div className={card}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h3 className="text-sm font-semibold text-[#1A1D2E]">Email reply</h3>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => { navigator.clipboard.writeText(subject); setMsg('Subject copied.') }} disabled={!subject} className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-[#E4E6EE] text-gray-700 disabled:opacity-40">Copy subject</button>
              <button onClick={copyEmail} disabled={!html} className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-[#0F766E] text-white disabled:opacity-40">Copy email + log as sent</button>
              <button onClick={() => save()} disabled={!!busy} className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-[#E4E6EE] text-gray-700 disabled:opacity-40">{busy === 'save' ? 'Saving…' : savedId ? 'Save changes' : 'Save'}</button>
            </div>
          </div>
          <Field label="Subject"><input className={inp} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Written with the reply" /></Field>
          <div className="mt-3">
            <div className={lbl}>Body (click to edit)</div>
            <div ref={editor} contentEditable suppressContentEditableWarning onBlur={e => setHtml((e.target as HTMLDivElement).innerHTML)}
              className="min-h-[260px] rounded-md border border-[#E4E6EE] p-3 text-[14px] leading-relaxed text-[#1A1D2E] focus:outline-none focus:border-[#0F766E] [&_p]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2.5 [&_li]:mb-1"
              style={{ fontFamily: 'Arial, sans-serif' }} />
            {!html && <p className="text-xs text-gray-400 mt-2">Fill the form and press Write the reply. Every price comes from the costing table, never from the writer.</p>}
          </div>
          {warnings.length > 0 && <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"><b>Check before sending:</b><ul className="list-disc pl-4 mt-1">{warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
        </div>

        <div className={card}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h3 className="text-sm font-semibold text-[#1A1D2E]">Attachment: next steps PDF</h3>
            <div className="flex gap-2">
              <button onClick={() => pdf(false)} disabled={!!busy} className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-[#E4E6EE] text-gray-700 disabled:opacity-40">{busy === 'pdf' ? 'Building…' : 'Refresh preview'}</button>
              <button onClick={() => pdf(true)} disabled={!!busy} className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-[#0F766E] text-white disabled:opacity-40">Download PDF</button>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">Saves as “{stepsPdfName(f)}”. Attach it to your Outlook reply.</p>
          {pdfUrl ? <iframe src={pdfUrl} className="w-full h-[520px] rounded-md border border-[#E4E6EE]" title="Next steps PDF" /> : (
            <ol className="text-sm text-gray-700 space-y-1.5">
              {steps.map((s, i) => <li key={i} className="flex gap-2"><span className="text-[#0F766E] font-semibold w-4">{i + 1}</span><span><b>{s.title}</b> <span className="text-gray-400">({s.who}, {s.status === 'done' ? 'done' : s.status === 'next' ? 'next' : 'coming up'})</span><br /><span className="text-gray-500 text-xs">{s.detail}</span></span></li>)}
            </ol>
          )}
        </div>

        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#1A1D2E]">Inquiry log <span className="text-gray-400 font-normal">({list.filter(x => x.status === 'Sent').length} sent)</span></h3>
            <div className="flex gap-1">{(['All', 'Sent', 'Draft'] as const).map(k => (
              <button key={k} onClick={() => setFilter(k)} className={`text-[11px] px-2 py-0.5 rounded-full border ${filter === k ? 'bg-[#0F766E] text-white border-[#0F766E]' : 'border-[#E4E6EE] text-gray-500'}`}>{k}</button>
            ))}</div>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">Copying an email logs it here as sent, adds the customer to the Leads board (or links the existing record) and logs the email in their conversations.</p>
          {list.length === 0 ? <p className="text-xs text-gray-400">Nothing saved yet.</p> : (
            <div className="divide-y divide-[#F0F2F7]">
              {list.filter(s => filter === 'All' || (filter === 'Sent' ? s.status === 'Sent' : s.status !== 'Sent')).map(s => (
                <div key={s.id} className={`py-2 flex items-center justify-between gap-2 px-1 rounded ${s.id === savedId ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                  <button onClick={() => open(s.id)} className="min-w-0 text-left flex-1">
                    <span className="text-sm font-medium text-[#1A1D2E] truncate block">{s.brand || s.company || 'Untitled'}{s.contact_name ? ` · ${s.contact_name}` : ''}</span>
                    <span className="text-xs text-gray-400 truncate block">{s.subject || 'No reply written yet'}</span>
                    {s.customer_id && <a href={`/sales/customers?item=${s.customer_id}`} onClick={e => e.stopPropagation()} className="text-[11px] text-[#0F766E] underline">{s.customers?.company_name || 'Customer record'}{s.customers?.pipeline_stage ? ` (${s.customers.pipeline_stage})` : ''}</a>}
                  </button>
                  <span className="text-[11px] text-right whitespace-nowrap">
                    <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${s.status === 'Sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{s.status === 'Sent' ? 'Sent' : 'Draft'}</span><br />
                    <span className="text-gray-400">{new Date(s.sent_at || s.created_at).toLocaleDateString('en-US')} · {(s.created_by || '').split('@')[0]}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
