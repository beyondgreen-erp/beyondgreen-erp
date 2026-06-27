import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// The University answers from BOTH curated knowledge entries AND analyzed documents.
export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json()
    if (!question?.trim()) return NextResponse.json({ error: 'question required' }, { status: 400 })

    const sb = createSupabaseAdminClient()

    const [{ data: uniHits }, { data: docHits }] = await Promise.all([
      sb.rpc('search_university', { query_text: question, match_count: 8 }),
      sb.rpc('search_document_chunks', { query_text: question, doc_filter: null, match_count: 8 }),
    ])

    const uni = (uniHits || []) as { id: string; title: string; content: string; category: string; source: string }[]
    const chunks = (docHits || []) as { document_id: string; content: string }[]

    let context = ''
    const sources: { type: string; title: string; id: string }[] = []

    if (uni.length) {
      context += '=== beyondGREEN University knowledge ===\n' + uni.map((u, i) => `[U${i + 1}] ${u.title} (${u.category})\n${u.content}`).join('\n\n') + '\n\n'
      uni.forEach(u => sources.push({ type: 'University', title: u.title, id: u.id }))
    }
    if (chunks.length) {
      const ids = Array.from(new Set(chunks.map(c => c.document_id)))
      const { data: docs } = await sb.from('documents').select('id, title').in('id', ids)
      const tmap = Object.fromEntries((docs || []).map(d => [d.id, d.title]))
      context += '=== Document excerpts ===\n' + chunks.map((c, i) => `[D${i + 1}] (${tmap[c.document_id] || 'Doc'})\n${c.content}`).join('\n\n')
      ids.forEach(id => sources.push({ type: 'Document', title: tmap[id] || 'Document', id }))
    }

    if (!context.trim()) {
      // Fallback to most recent University entries so the page is still useful when empty of matches
      const { data: recent } = await sb.from('university_entries').select('title, content, category').eq('is_active', true).order('created_at', { ascending: false }).limit(6)
      if (recent?.length) context = '=== Recent University knowledge ===\n' + recent.map(r => `${r.title} (${r.category})\n${r.content}`).join('\n\n')
    }

    if (!context.trim()) {
      return NextResponse.json({ answer: "The University is empty so far. Add knowledge entries or analyze documents to teach it about beyondGREEN.", sources: [] })
    }

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: 'You are beyondGREEN University — the single source of truth about the company. Answer questions about beyondGREEN using ONLY the knowledge and document excerpts provided. Be clear, helpful, and specific, and mention which sources informed your answer. If the answer is not in the provided material, say what is missing.',
      messages: [{ role: 'user', content: `Question: ${question}\n\n${context}` }],
    })

    const answer = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    // de-dup sources by id
    const seen = new Set<string>()
    const uniqueSources = sources.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    return NextResponse.json({ answer, sources: uniqueSources })
  } catch (err) {
    console.error('university/ask error:', err)
    return NextResponse.json({ error: (err as Error).message || 'Ask failed' }, { status: 500 })
  }
}
