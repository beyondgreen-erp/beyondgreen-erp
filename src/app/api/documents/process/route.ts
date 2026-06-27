import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CATEGORIES = ['Contract', 'Spec Sheet', 'Certificate', 'SDS', 'Quality Record', 'Drawing', 'Policy', 'Other']

// Split text into ~1500-char chunks on paragraph/sentence boundaries
function chunkText(text: string, size = 1500): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  const paras = clean.split(/\n\n+/)
  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > size && cur) { chunks.push(cur.trim()); cur = p }
    else { cur = cur ? cur + '\n\n' + p : p }
    while (cur.length > size * 1.6) { chunks.push(cur.slice(0, size).trim()); cur = cur.slice(size) }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.slice(0, 60)
}

export async function POST(req: NextRequest) {
  try {
    const { documentId, autotitle } = await req.json()
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

    const sb = createSupabaseAdminClient()

    const { data: doc, error: docErr } = await sb.from('documents').select('*').eq('id', documentId).single()
    if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    // Most recent file attached to this document
    const { data: files } = await sb
      .from('file_attachments')
      .select('*')
      .eq('record_type', 'documents')
      .eq('record_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1)
    const file = files?.[0]

    // Build the content the model will read
    const userContent: Anthropic.MessageParam['content'] = []
    let fileNote = ''
    if (file) {
      const { data: blob } = await sb.storage.from('erp-files').download(file.storage_path)
      if (blob) {
        const buf = Buffer.from(await blob.arrayBuffer())
        const ext = (file.file_name.split('.').pop() || '').toLowerCase()
        const isPdf = file.file_type === 'application/pdf' || ext === 'pdf'
        const isImg = (file.file_type || '').startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
        const isText = (file.file_type || '').startsWith('text/') || ['txt', 'csv', 'md', 'json', 'tsv'].includes(ext)
        if (isPdf) {
          userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } } as Anthropic.DocumentBlockParam)
        } else if (isImg) {
          const mt = (file.file_type && file.file_type.startsWith('image/')) ? file.file_type : `image/${ext === 'jpg' ? 'jpeg' : ext}`
          userContent.push({ type: 'image', source: { type: 'base64', media_type: mt as 'image/png', data: buf.toString('base64') } })
        } else if (isText) {
          fileNote = `\n\nFile contents (${file.file_name}):\n${buf.toString('utf-8').slice(0, 60000)}`
        } else {
          fileNote = `\n\nAttached file "${file.file_name}" (${file.file_type || ext}) could not be read directly. Use the title and notes below.`
        }
      }
    }

    const prompt = `You are the document intelligence engine for beyondGREEN, a compostable foodservice products manufacturer. Analyze the attached document (and metadata) and produce a structured analysis.

Document title: ${doc.title}
Existing category: ${doc.category || 'unknown'}
Owner: ${doc.owner || 'n/a'}
Notes: ${doc.notes || 'n/a'}${fileNote}

Return ONLY raw JSON (no markdown) in exactly this shape:
{
  "title": "a short, clean, human-readable document title based on the contents (e.g. 'Walmart Supplier Agreement 2024'), never the raw file name or extension",
  "summary": "3-6 sentence plain-English summary of what this document is and why it matters to beyondGREEN",
  "category": "one of: ${CATEGORIES.join(', ')}",
  "key_facts": ["5-10 short, specific, factual bullet points pulled from the document (dates, parties, specs, obligations, certifications, numbers)"],
  "full_text": "the full readable text content of the document, transcribed as faithfully as possible (omit page furniture). If you cannot read the file, return an empty string."
}`

    userContent.push({ type: 'text', text: prompt })

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: userContent }],
    })

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
    const parsed = JSON.parse(s >= 0 && e > s ? raw.slice(s, e + 1) : '{}')

    const summary: string = (parsed.summary || '').toString().trim()
    const keyFacts: string[] = Array.isArray(parsed.key_facts) ? parsed.key_facts.map((f: unknown) => String(f)).filter(Boolean) : []
    const category: string = CATEGORIES.includes(parsed.category) ? parsed.category : (doc.category || 'Other')
    const fullText: string = (parsed.full_text || '').toString().trim()
    const aiTitle: string = (parsed.title || '').toString().trim()
    const fileBase = file ? file.file_name.replace(/\.[^.]+$/, '') : ''
    const titleLooksAuto = !doc.title || doc.title === fileBase || doc.title === (file?.file_name || '') || /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|txt|csv|md)$/i.test(doc.title)
    const applyTitle = ((autotitle || titleLooksAuto) && aiTitle) ? aiTitle : doc.title
    const knowledgeText = [summary, keyFacts.map(f => `• ${f}`).join('\n')].filter(Boolean).join('\n\n')

    // Update the document. Auto-apply category only when it was unset/Other.
    const applyCategory = (!doc.category || doc.category === 'Other') ? category : doc.category
    await sb.from('documents').update({
      title: applyTitle,
      ai_summary: summary || null,
      ai_key_facts: keyFacts,
      ai_suggested_category: category,
      category: applyCategory,
      extracted_text: fullText || null,
      source_file_path: file?.storage_path || null,
      ai_processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', documentId)

    // Rebuild chunks for retrieval. Fall back to summary+facts if no full text.
    await sb.from('document_chunks').delete().eq('document_id', documentId)
    const basis = fullText && fullText.length > 40 ? fullText : knowledgeText
    const chunks = chunkText(`${applyTitle}\n\n${basis}`)
    if (chunks.length) {
      await sb.from('document_chunks').insert(chunks.map((content, i) => ({ document_id: documentId, chunk_index: i, content })))
    }

    // Feed the University: one entry per document, kept in sync.
    if (knowledgeText) {
      const { data: existing } = await sb.from('university_entries').select('id').eq('source_document_id', documentId).maybeSingle()
      const entry = {
        title: applyTitle,
        content: knowledgeText,
        category: 'Documents',
        source: 'document',
        source_document_id: documentId,
        tags: category,
        created_by: doc.owner || 'AI',
        updated_at: new Date().toISOString(),
      }
      if (existing?.id) await sb.from('university_entries').update(entry).eq('id', existing.id)
      else await sb.from('university_entries').insert(entry)
    }

    return NextResponse.json({ ok: true, title: applyTitle, summary, category: applyCategory, suggested_category: category, key_facts: keyFacts, chunks: chunks.length })
  } catch (err) {
    console.error('documents/process error:', err)
    return NextResponse.json({ error: (err as Error).message || 'Processing failed' }, { status: 500 })
  }
}
