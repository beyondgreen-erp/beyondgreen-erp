'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Contact { full_name: string; title: string; email: string; phone: string; is_primary: boolean }
interface EmailLog { subject: string; body: string; direction: string }
interface ParsedData {
  company_name: string; email: string; phone: string; notes: string
  pipeline_stage: string; customer_status: string
  contacts: Contact[]; email_thread_summary: string; email_log: EmailLog[]
}

export default function QuickAddModal({ onClose, onSaved, userEmail }: { onClose: () => void; onSaved: () => void; userEmail: string }) {
  const [step, setStep] = useState<'paste'|'preview'|'saving'|'done'>('paste')
  const [emailThread, setEmailThread] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedData | null>(null)
  const [error, setError] = useState('')
  const [wasExisting, setWasExisting] = useState(false)
  

  async function handleParse() {
    if (!emailThread.trim()) return
    setParsing(true); setError('')
    try {
      const res = await fetch('/api/customers/ai-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailThread })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setParsed(data); setStep('preview')
    } catch (e: unknown) {
      // Retry once on failure
      try {
        const res2 = await fetch('/api/customers/ai-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailThread })
        })
        const data2 = await res2.json()
        if (data2.error) throw new Error(data2.error)
        setParsed(data2); setStep('preview')
      } catch (e2: unknown) {
        setError(e2 instanceof Error ? e2.message : 'AI extraction failed. Please try again.')
      }
    } finally { setParsing(false) }
  }

  async function handleSave() {
    if (!parsed) return
    setStep('saving')
    try {
      // 1. Check for existing customer with same company name
      let cust: { id: string } | null = null
      const { data: existing } = await supabase
        .from('customers')
        .select('id, company_name')
        .ilike('company_name', parsed.company_name?.trim() || '')
        .limit(1)
        .maybeSingle()

      if (existing) {
        // Company already exists - just add the contact
        cust = existing
        setWasExisting(true)
      } else {
        // Create new customer
        const { data: newCust, error: ce } = await supabase.from('customers').insert({
          company_name: parsed.company_name,
          email: parsed.email,
          phone: parsed.phone,
          notes: parsed.notes,
          pipeline_stage: parsed.pipeline_stage || 'Lead',
          customer_status: parsed.customer_status || 'Lead',
          is_active: true,
        }).select().single()
        if (ce) throw new Error(ce.message)
        cust = newCust
      }

      // 2. Create contacts
      if (cust && parsed.contacts?.length > 0) {
        await supabase.from('customer_contacts').insert(
          parsed.contacts.map((c, i) => ({ ...c, customer_id: cust.id, is_primary: i === 0 }))
        )
      }

      // 3. Log email thread entries
      if (parsed.email_log?.length > 0) {
        await supabase.from('customer_outreach').insert(
          parsed.email_log.map(e => ({
            customer_id: (cust as {id:string}).id,
            subject: e.subject,
            body: e.body,
            sent_by: userEmail,
            status: 'sent',
            notes: `[Imported ${e.direction}]`,
          }))
        )
      }

      setStep('done')
      setTimeout(() => { onSaved(); onClose() }, 1200)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setStep('preview')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">✨ Quick Add Customer</h2>
            <p className="text-sm text-gray-500">Paste an email thread — AI will extract the customer details</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {step === 'paste' && (
          <div className="p-5 space-y-4">
            <textarea
              value={emailThread}
              onChange={e => setEmailThread(e.target.value)}
              placeholder="Paste the email thread here..."
              className="w-full h-64 border border-gray-300 rounded-lg p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleParse} disabled={parsing || !emailThread.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {parsing ? <><span className="animate-spin">⏳</span> Analyzing...</> : '✨ Extract Customer Info'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && parsed && (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Company Name</label>
                <input value={parsed.company_name} onChange={e => setParsed({...parsed, company_name: e.target.value})}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Email</label>
                <input value={parsed.email} onChange={e => setParsed({...parsed, email: e.target.value})}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Phone</label>
                <input value={parsed.phone} onChange={e => setParsed({...parsed, phone: e.target.value})}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Status</label>
                <select value={parsed.customer_status} onChange={e => setParsed({...parsed, customer_status: e.target.value})}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {['Lead','Prospect','Active','Inactive'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Notes / Context</label>
              <textarea value={parsed.notes} onChange={e => setParsed({...parsed, notes: e.target.value})}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {parsed.contacts?.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Contacts ({parsed.contacts.length})</label>
                <div className="mt-2 space-y-2">
                  {parsed.contacts.map((c, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-2">
                      <input placeholder="Name" value={c.full_name} onChange={e => { const cs=[...parsed.contacts]; cs[i]={...cs[i],full_name:e.target.value}; setParsed({...parsed,contacts:cs}) }}
                        className="border rounded px-2 py-1 text-sm" />
                      <input placeholder="Title" value={c.title} onChange={e => { const cs=[...parsed.contacts]; cs[i]={...cs[i],title:e.target.value}; setParsed({...parsed,contacts:cs}) }}
                        className="border rounded px-2 py-1 text-sm" />
                      <input placeholder="Email" value={c.email} onChange={e => { const cs=[...parsed.contacts]; cs[i]={...cs[i],email:e.target.value}; setParsed({...parsed,contacts:cs}) }}
                        className="border rounded px-2 py-1 text-sm" />
                      <input placeholder="Phone" value={c.phone} onChange={e => { const cs=[...parsed.contacts]; cs[i]={...cs[i],phone:e.target.value}; setParsed({...parsed,contacts:cs}) }}
                        className="border rounded px-2 py-1 text-sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {parsed.email_log?.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Email Thread ({parsed.email_log.length} message{parsed.email_log.length !== 1 ? 's' : ''})</label>
                <div className="mt-2 space-y-1">
                  {parsed.email_log.map((e, i) => (
                    <div key={i} className={`text-xs px-3 py-2 rounded-lg border ${ e.direction === 'inbound' ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200' }`}>
                      <span className="font-semibold">{e.direction === 'inbound' ? '← ' : '→ '}{e.subject}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-between pt-2 border-t">
              <button onClick={() => setStep('paste')} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">← Back</button>
              <button onClick={handleSave} className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold">✓ Create Customer</button>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div className="p-10 text-center">
            <div className="text-4xl animate-spin inline-block">⏳</div>
            <p className="mt-3 text-gray-600">Creating customer record...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="p-10 text-center">
            <div className="text-5xl">✅</div>
            <p className="mt-3 font-semibold text-gray-900">{wasExisting ? "Contact added to " : ""}{parsed?.company_name}{wasExisting ? "!" : " added!"}</p>
            <p className="text-sm text-gray-500">{wasExisting ? "Contact and email history added to existing customer." : "Contacts and email history logged."}</p>
          </div>
        )}
      </div>
    </div>
  )
}
