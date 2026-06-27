'use client'
import { useState } from 'react'

interface Source { document_id: string; title: string; category: string | null }

// Cross-document Q&A. Scans every analyzed document and answers in one place.
export default function KnowledgeCenter() {
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  async function ask(e?: React.FormEvent) {
    e?.preventDefault()
    if (!q.trim() || loading) return
    setLoading(true); setAnswer(''); setSources([])
    try {
      const res = await fetch('/api/documents/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setAnswer(data.answer || ''); setSources(data.sources || [])
    } catch (err) {
      setAnswer('Error: ' + (err as Error).message)
    } finally { setLoading(false) }
  }

  return (
    <div className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.06] to-transparent mb-5 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <i className="ti ti-sparkles text-white text-base" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1D2E]">Knowledge Center</p>
          <p className="text-xs text-gray-500">Ask a question and get an answer from across every analyzed document.</p>
        </div>
        <i className={`ti ti-chevron-${open ? 'up' : 'down'} text-gray-400`} />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-3">
          <form onSubmit={ask} className="flex gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Which certifications are expiring this year?"
              className="flex-1 bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <button type="submit" disabled={loading || !q.trim()}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {loading ? <i className="ti ti-loader-2 animate-spin" /> : <i className="ti ti-search" />} Ask
            </button>
          </form>
          {answer && (
            <div className="bg-white border border-[#E4E6EE] rounded-lg px-4 py-3">
              <p className="text-sm text-[#1A1D2E] whitespace-pre-wrap leading-relaxed">{answer}</p>
              {sources.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#E4E6EE] flex flex-wrap gap-1.5">
                  <span className="text-xs text-gray-400 mr-1">Sources:</span>
                  {sources.map(s => (
                    <span key={s.document_id} className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 border border-violet-500/20">{s.title}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
