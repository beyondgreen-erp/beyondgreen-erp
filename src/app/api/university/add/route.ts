import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  try {
    const { title, content, category, tags, created_by } = await req.json()
    if (!title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: 'title and content are required' }, { status: 400 })
    }
    const sb = createSupabaseAdminClient()
    const { data, error } = await sb.from('university_entries').insert({
      title: title.trim(),
      content: content.trim(),
      category: (category || 'General').trim(),
      source: 'manual',
      tags: tags?.trim() || null,
      created_by: created_by || null,
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || 'Add failed' }, { status: 500 })
  }
}
