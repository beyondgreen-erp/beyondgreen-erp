import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { question, documentId } = await req.json()
    if (!question?.trim()) return NextResponse.json({ error: 'question required' }, { status: 400 })

    const sb = createSupabaseAdminClient()

    // Retrieve relevant chunks via full-text search
    const { data: hits } = await sb.rpc('search_document_chunks', {
      query_text: question,
      doc_filter: documentId || null,
      match_count: documentId ? 10 : 12,
    })

    let rows = (hits || []) as { document_id: string; chunk_index: number; content: string }[]

    // Fallback: if FTS found nothing, pull recent chunks (scoped if a single doc)
    if (rows.length === 0) {
      let q = sb.from('document_chunks').select('document_id, chunk_index, content').order('created_at', { ascending: false }).limit(documentId ? 10 : 12)
      if (documentId) q = q.eq('document_id', documentId)
      const { data: fb } = await q
      rows = (fb || []) as typeof rows
    }

    if (rows.length === 0) {
      return NextResponse.json({ answer: "I don't have any analyzed document content to answer from yet. Upload a document and run \"Analyze with AI\" first.", sources: [] })
    }

    // Resolve document titles for citation
    const ids = Array.from(new Set(rows.map(r => r.document_id)))
    const { data: docs } = await sb.from('documents').select('id, title, category').in('id', ids)
    const titleMap = Object.fromEntries((docs || []).map(d => [d.id, { title: d.title, category: d.category }]))

    const context = rows.map((r, i) => `[${i + 1}] (Document: ${titleMap[r.document_id]?.title || 'Unknown'})\n${r.content}`).join('\n\n---\n\n')

    const scope = documentId ? 'a single document' : 'the entire beyondGREEN document library'
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are the beyondGREEN Knowledge Center. Answer the user's question using ONLY the provided document excerpts from ${scope}. Be concise and specific. If the excerpts don't contain the answer, say so plainly. Cite the document name(s) you used in your answer.`,
      messages: [{ role: 'user', content: `Question: ${question}\n\nDocument excerpts:\n\n${context}` }],
    })

    const answer = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const sources = ids.map(id => ({ document_id: id, title: titleMap[id]?.title || 'Unknown', category: titleMap[id]?.category || null }))

    return NextResponse.json({ answer, sources })
  } catch (err) {
    console.error('documents/ask error:', err)
    return NextResponse.json({ error: (err as Error).message || 'Ask failed' }, { status: 500 })
  }
}
