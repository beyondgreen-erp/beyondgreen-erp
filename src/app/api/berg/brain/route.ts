import { saveCompanyFact } from '@/lib/bergMemory'

export async function POST(req: Request) {
  try {
    const { category, fact } = await req.json()
    if (!fact?.trim()) return new Response('Fact is required', { status: 400 })
    await saveCompanyFact(category || 'Other', fact.trim())
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('BERG brain error', err)
    return new Response(String(err), { status: 500 })
  }
}
