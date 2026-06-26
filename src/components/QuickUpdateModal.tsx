'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface CustomerLite { id: string; company_name: string }
interface Conversation { conversation_type: string; subject: string; content: string; contact_name: string; outcome: string; follow_up_date: string | null }
interface AIResult { conversation: Conversation; updates: Record<string, any>; change_summary: string }

const FIELD_LABELS: Record<string, string> = {
  customer_status: 'Status', pipeline_stage: 'Pipeline Stage', priority: 'Priority',
  contact_name: 'Contact Name', email: 'Email', phone: 'Phone',
  deal_value: 'Deal Value ($)', probability: 'Probability (%)',
  expected_close_date: 'Expected Close', next_follow_up: 'Next Follow-up',
  industry: 'Industry', lead_source: 'Lead Source', payment_terms: 'Payment Terms',
  notes_append: 'Append to Notes',
}
const FIELD_ORDER = ['customer_status','pipeline_stage','priority','contact_name','email','phone','deal_value','probability','expected_close_date','next_follow_up','industry','lead_source','payment_terms','notes_append']
const CONVO_TYPES = ['email','call','meeting','text','note','other']
const fmtCur = (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v)

export default function QuickUpdateModal({ onClose, onSaved, userEmail }: { onClose: () => void; onSaved: () => void; userEmail: string }) {
  const [step, setStep] = useState<'select'|'preview'|'saving'|'done'>('select')
  const [customers, setCustomers] = useState<CustomerLite[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [emailThread, setEmailThread] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AIResult | null>(null)
  const [include, setInclude] = useState<Record<string, boolean>>({})

  useEffect(() => {
    supabase.from('customers').select('id, company_name').eq('is_active', true).order('company_name')
      .then(({ data }) => { if (data) setCustomers(data as CustomerLite[]) })
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers.slice(0, 50)
    return customers.filter(c => (c.company_name || '').toLowerCase().includes(q)).slice(0, 50)
  }, [customers, search])

  const selectedName = customers.find(c => c.id === selectedId)?.company_name || ''

  async function handleAnalyze() {
    if (!selectedId || !emailThread.trim()) return
    setParsing(true); setError('')
    try {
      const { data: full } = await supabase.from('customers').select('*').eq('id', selectedId).single()
      setSelectedCustomer(full)
      const res = await fetch('/api/customers/ai-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailThread, customer: full }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data as AIResult)
      const inc: Record<string, boolean> = {}
      Object.keys(data.updates || {}).forEach(k => { inc[k] = true })
      setInclude(inc)
      setStep('preview')
    } catch (e: any) {
      setError(e?.message || 'AI analysis failed. Please try again.')
    } finally { setParsing(false) }
  }

  function setUpdateVal(k: string, v: any) {
    setResult(r => r ? { ...r, updates: { ...r.updates, [k]: v } } : r)
  }
  function setConvo(patch: Partial<Conversation>) {
    setResult(r => r ? { ...r, conversation: { ...r.conversation, ...patch } } : r)
  }

  async function handleApply() {
    if (!result || !selectedId) return
    setStep('saving'); setError('')
    try {
      const u = result.updates || {}
      const patch: Record<string, any> = {}
      for (const k of Object.keys(u)) {
        if (!include[k]) continue
        if (k === 'notes_append') {
          const line = String(u[k] || '').trim()
          if (line) {
            const dated = `[${new Date().toISOString().slice(0,10)}] ${line}`
            patch.notes = selectedCustomer?.notes ? `${selectedCustomer.notes}\n${dated}` : dated
          }
        } else if (k === 'deal_value' || k === 'probability') {
          const n = parseFloat(String(u[k]).replace(/[^0-9.-]/g, ''))
          if (!isNaN(n)) patch[k] = n
        } else {
          patch[k] = u[k]
        }
      }
      patch.updated_at = new Date().toISOString()
      const { error: ue } = await supabase.from('customers').update(patch).eq('id', selectedId)
      if (ue) throw new Error(ue.message)

      const c = result.conversation
      const { error: ce } = await supabase.from('customer_conversations').insert({
        customer_id: selectedId,
        conversation_type: c.conversation_type || 'email',
        subject: c.subject || null,
        content: c.content || '',
        contact_name: c.contact_name || null,
        outcome: c.outcome || null,
        follow_up_date: c.follow_up_date || null,
        logged_by: userEmail,
      })
      if (ce) throw new Error(ce.message)

      setStep('done')
      setTimeout(() => { onSaved(); onClose() }, 1300)
    } catch (e: any) {
      setError(e?.message || 'Update failed')
      setStep('preview')
    }
  }

  const upd = result?.updates || {}
  const updKeys = FIELD_ORDER.filter(k => k in upd)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">✨ Quick Update Customer</h2>
            <p className="text-sm text-gray-500">Pick a customer, paste the latest conversation — AI logs it and updates the record</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {step === 'select' && (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Customer</label>
              <input value={selectedId ? selectedName : search}
                onChange={e => { setSearch(e.target.value); setSelectedId('') }}
                placeholder="Search for a customer…"
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {!selectedId && search.trim() && (
                <div className="mt-1 border border-gray-200 rounded-lg max-h-44 overflow-y-auto">
                  {filtered.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No matches.</p>}
                  {filtered.map(c => (
                    <button key={c.id} onClick={() => { setSelectedId(c.id); setSearch('') }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0">
                      {c.company_name}
                    </button>
                  ))}
                </div>
              )}
              {selectedId && <p className="mt-1 text-xs text-emerald-600">✓ {selectedName} selected</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Latest Conversation / Email Thread</label>
              <textarea value={emailThread} onChange={e => setEmailThread(e.target.value)}
                placeholder="Paste the latest emails or conversation here…"
                className="w-full mt-1 h-56 border border-gray-300 rounded-lg p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleAnalyze} disabled={parsing || !selectedId || !emailThread.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {parsing ? <><span className="animate-spin">⏳</span> Analyzing…</> : '✨ Analyze & Suggest Updates'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && result && (
          <div className="p-5 space-y-5">
            {result.change_summary && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">{result.change_summary}</div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Conversation Log Entry</label>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <select value={result.conversation.conversation_type} onChange={e => setConvo({ conversation_type: e.target.value })}
                  className="border rounded-lg px-3 py-2 text-sm">
                  {CONVO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={result.conversation.subject} onChange={e => setConvo({ subject: e.target.value })}
                  placeholder="Subject" className="border rounded-lg px-3 py-2 text-sm" />
              </div>
              <textarea value={result.conversation.content} onChange={e => setConvo({ content: e.target.value })}
                className="w-full mt-2 border rounded-lg px-3 py-2 text-sm h-20 resize-none" placeholder="Summary" />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <input value={result.conversation.contact_name} onChange={e => setConvo({ contact_name: e.target.value })}
                  placeholder="Contact spoken with" className="border rounded-lg px-3 py-2 text-sm" />
                <input type="date" value={result.conversation.follow_up_date || ''} onChange={e => setConvo({ follow_up_date: e.target.value })}
                  className="border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Suggested Record Updates ({updKeys.length})</label>
              {updKeys.length === 0 && <p className="mt-2 text-sm text-gray-400 italic">No field changes suggested — just logging the conversation.</p>}
              <div className="mt-2 space-y-2">
                {updKeys.map(k => (
                  <div key={k} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${include[k] ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                    <input type="checkbox" checked={!!include[k]} onChange={e => setInclude({ ...include, [k]: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                    <span className="text-xs font-semibold text-gray-600 w-32 shrink-0">{FIELD_LABELS[k] || k}</span>
                    {k !== 'notes_append' && (
                      <span className="text-xs text-gray-400 shrink-0">{fmtCur(selectedCustomer?.[k])} →</span>
                    )}
                    <input value={String(upd[k] ?? '')} onChange={e => setUpdateVal(k, e.target.value)}
                      className="flex-1 border rounded px-2 py-1 text-sm bg-white" />
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-between pt-2 border-t">
              <button onClick={() => setStep('select')} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">← Back</button>
              <button onClick={handleApply} className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold">✓ Apply Update</button>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div className="p-10 text-center">
            <div className="text-4xl animate-spin inline-block">⏳</div>
            <p className="mt-3 text-gray-600">Updating {selectedName}…</p>
          </div>
        )}

        {step === 'done' && (
          <div className="p-10 text-center">
            <div className="text-5xl">✅</div>
            <p className="mt-3 font-semibold text-gray-900">{selectedName} updated!</p>
            <p className="text-sm text-gray-500">Conversation logged and record updated.</p>
          </div>
        )}
      </div>
    </div>
  )
}
