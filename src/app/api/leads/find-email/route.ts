/**
 * POST /api/leads/find-email  { customer_id }
 * Researches the correct, current contact email for a bounced lead.
 *
 * Strategy (best result wins, no mutation happens here):
 *   1) Anthropic web search — looks at the org's real website / staff directory.
 *   2) Hunter.io domain-search (if HUNTER_API_KEY is set).
 *   3) Common-pattern fallback (info@ / contact@ the org domain) as low confidence.
 *
 * Returns: { suggestions: [{ email, source, confidence, note }], method }
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function domainOf(website?: string | null, email?: string | null): string | null {
  const src = (website || '').trim()
  if (src) {
    try { const u = new URL(src.startsWith('http') ? src : 'https://' + src); return u.hostname.replace(/^www\./, '') } catch { /* fall through */ }
    const m = src.replace(/^www\./, '').match(/([a-z0-9-]+\.[a-z.]{2,})/i)
    if (m) return m[1].toLowerCase()
  }
  if (email && email.includes('@')) return email.split('@')[1].toLowerCase()
  return null
}

interface Suggestion { email: string; source: string; confidence: string; note: string }

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

async function viaWebSearch(lead: any, domain: string | null): Promise<Suggestion[]> {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 } as any],
    messages: [{
      role: 'user',
      content: `A cold outreach email to the address below BOUNCED as undeliverable. Search the web (the organization's official website, "contact" / staff-directory / department pages) and find the best CURRENT, published contact email to reach the right person about free compostable pet-waste-bag dispensers for parks (procurement, parks & recreation, public works, or a general info inbox).

Organization: ${lead.company_name || 'unknown'}
Known contact name: ${lead.contact_name || 'unknown'}
Website: ${lead.website || domain || 'unknown'}
Bounced email: ${lead.email || 'unknown'}

Only return emails you actually find published on a real page (do not invent addresses). Prefer official .gov / .org pages. Return ONLY raw JSON, no markdown:
{"suggestions":[{"email":"...","source":"page URL where you found it","confidence":"high|medium|low","note":"whose inbox / department this is"}]}
If nothing credible is found, return {"suggestions":[]}.`,
    }],
  })
  const text = (msg.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a < 0 || b < 0) return []
  try {
    const j = JSON.parse(text.slice(a, b + 1))
    const out = (j.suggestions || []).filter((s: any) => s && EMAIL_RE.test(String(s.email || '')))
    return out.map((s: any) => ({ email: String(s.email).toLowerCase(), source: String(s.source || 'web'), confidence: String(s.confidence || 'medium'), note: String(s.note || '') }))
  } catch { return [] }
}

async function viaHunter(domain: string): Promise<Suggestion[]> {
  const key = process.env.HUNTER_API_KEY
  if (!key) return []
  try {
    const r = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=5&api_key=${key}`)
    const j = await r.json()
    const emails = (j?.data?.emails || []) as any[]
    return [...emails]
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 3)
      .map(e => ({ email: String(e.value).toLowerCase(), source: 'Hunter.io', confidence: (e.confidence || 0) >= 80 ? 'high' : (e.confidence || 0) >= 50 ? 'medium' : 'low', note: [e.first_name, e.last_name].filter(Boolean).join(' ') + (e.position ? ` · ${e.position}` : '') }))
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  const { customer_id } = await req.json().catch(() => ({}))
  if (!customer_id) return NextResponse.json({ error: 'customer_id required' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const { data: lead } = await sb.from('customers').select('id, company_name, contact_name, website, email').eq('id', customer_id).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 })

  const domain = domainOf(lead.website as string, lead.email as string)

  let suggestions: Suggestion[] = []
  let method = 'web_search'
  try { suggestions = await viaWebSearch(lead, domain) } catch { suggestions = [] }

  if (!suggestions.length && domain) {
    const h = await viaHunter(domain)
    if (h.length) { suggestions = h; method = 'hunter' }
  }
  if (!suggestions.length && domain) {
    method = 'domain-guess'
    suggestions = [
      { email: `info@${domain}`, source: 'common pattern (unverified)', confidence: 'low', note: 'General inbox guess — verify before sending' },
      { email: `contact@${domain}`, source: 'common pattern (unverified)', confidence: 'low', note: 'General inbox guess — verify before sending' },
    ]
  }

  // Drop the address that already bounced.
  const old = String(lead.email || '').toLowerCase()
  suggestions = suggestions.filter(s => s.email !== old)

  return NextResponse.json({
    suggestions, method, domain,
    message: suggestions.length ? `Found ${suggestions.length} candidate email(s).` : 'No candidate emails found — try the org website directly.',
  })
}
