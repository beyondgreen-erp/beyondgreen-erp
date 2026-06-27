'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface AIData { ai_summary: string | null; ai_key_facts: string[] | null; ai_suggested_category: string | null; ai_processed_at: string | null }

// Per-document AI analysis + Q&A, shown inside the document edit drawer.
export default function DocAI({ documentId }: { documentId: string }) {
  const sb = createSupabaseBrowserClient()
  const [data, setData] = useState<AIData | null>(null)
  const [processing, setProcessing] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)

  async function refresh() {
    const { data: d } = await sb.from('documents').select('ai_summary, ai_key_facts, ai_suggested_category, ai_processed_at').eq('id', documentId).single()
    if (d) setData(d as AIData)
  }
  useEffect(() => { refresh() }, [documentId]) // eslint-disable-line

  async function analyze() {
    setProcessing(true); setErr('')
    try {
      const res = await fetch('/api/documents/process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      await refresh()
    } catch (e) { setErr((e as Error).message) } finally { setProcessing(false) }
  }

  async function ask(e?: React.FormEvent) {
    e?.preventDefault()
    if (!q.trim() || asking) return
    setAsking(true); setAnswer('')
    try {
      const res = await fetch('/api/documents/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, documentId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      setAnswer(j.answer || '')
    } catch (e) { setAnswer('Error: ' + (e as Error).message) } finally { setAsking(false) }
  }

  const processed = !!data?.ai_processed_at
  return (
    <div className="border-t border-[#E4E6EE] pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 tracking-widest uppercase flex items-center gap-1.5"><i className="ti ti-sparkles text-violet-500" /> AI Analysis</p>
        <button onClick={analyze} disabled={processing}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white transition-colors">
          {processing ? <><i className="ti ti-loader-2 animate-spin" /> Analyzing…</> : <><i className="ti ti-wand" /> {processed ? 'Re-analyze' : 'Analyze with AI'}</>}
        </button>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      {!processed && !processing && <p className="text-xs text-gray-500 italic">Upload a file above, then run AI analysis to extract a summary, key facts, and a category — and add it to the Knowledge Center & University.</p>}
      {data?.ai_summary && (
        <div className="bg-[#F9FAFB] border border-[#E4E6EE] rounded-lg p-3 space-y-2">
          {data.ai_suggested_category && <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 border border-violet-500/20">{data.ai_suggested_category}</span>}
          <p className="text-sm text-[#1A1D2E] leading-relaxed">{data.ai_summary}</p>
          {data.ai_key_facts && data.ai_key_facts.length > 0 && (
            <ul className="space-y-1 pt-1">
              {data.ai_key_facts.map((f, i) => <li key={i} className="text-xs text-gray-600 flex gap-1.5"><span className="text-violet-500">•</span>{f}</li>)}
            </ul>
          )}
          {data.ai_processed_at && <p className="text-[10px] text-gray-400 pt-1">Analyzed {new Date(data.ai_processed_at).toLocaleString()}</p>}
        </div>
      )}
      {processed && (
        <div className="space-y-2">
          <form onSubmit={ask} className="flex gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask a question about this document…"
              className="flex-1 bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <button type="submit" disabled={asking || !q.trim()} className="text-xs px-3 py-2 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 disabled:opacity-50">
              {asking ? <i className="ti ti-loader-2 animate-spin" /> : 'Ask'}
            </button>
          </form>
          {answer && <div className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5"><p className="text-sm text-[#1A1D2E] whitespace-pre-wrap leading-relaxed">{answer}</p></div>}
        </div>
      )}
    </div>
  )
}
