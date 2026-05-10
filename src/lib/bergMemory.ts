import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured')
  return createClient(url, key)
}
const supabase = { from: (...a: Parameters<ReturnType<typeof getSupabase>['from']>) => getSupabase().from(...a), rpc: (...a: Parameters<ReturnType<typeof getSupabase>['rpc']>) => getSupabase().rpc(...a) }

function openaiClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export async function embedText(text: string): Promise<number[] | null> {
  const ai = openaiClient()
  if (!ai) return null
  try {
    const res = await ai.embeddings.create({ model: 'text-embedding-3-small', input: text })
    return res.data[0].embedding
  } catch {
    return null
  }
}

export async function saveMemory(
  userEmail: string,
  content: string,
  memoryType = 'conversation',
  importance = 1
): Promise<void> {
  const embedding = await embedText(content)
  const row: Record<string, unknown> = { user_email: userEmail, memory_type: memoryType, content, importance }
  if (embedding) row.embedding = JSON.stringify(embedding)
  await supabase.from('berg_memory').insert(row)
}

export async function findRelevantMemories(
  userEmail: string,
  query: string,
  limit = 5
): Promise<string[]> {
  const embedding = await embedText(query)
  if (!embedding) return []
  const { data } = await supabase.rpc('match_berg_memories', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.65,
    match_count: limit,
    user_email_filter: userEmail,
  })
  return (data ?? []).map((m: { content: string }) => m.content)
}

export async function saveCompanyFact(category: string, fact: string, source = 'user'): Promise<void> {
  const embedding = await embedText(fact)
  const row: Record<string, unknown> = { category, fact, source }
  if (embedding) row.embedding = JSON.stringify(embedding)
  await supabase.from('berg_company_facts').insert(row)
}

export async function findCompanyFacts(query: string, limit = 5): Promise<string[]> {
  const embedding = await embedText(query)
  if (!embedding) return []
  const { data } = await supabase.rpc('match_company_facts', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.65,
    match_count: limit,
  })
  return (data ?? []).map((f: { fact: string }) => f.fact)
}

export async function getAllFacts(page = 0, perPage = 20): Promise<{
  data: { id: string; category: string; fact: string; created_at: string }[]
  count: number
}> {
  const { data, count } = await supabase
    .from('berg_company_facts')
    .select('id, category, fact, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * perPage, (page + 1) * perPage - 1)
  return { data: data ?? [], count: count ?? 0 }
}

export async function deleteFact(id: string): Promise<void> {
  await supabase.from('berg_company_facts').delete().eq('id', id)
}
