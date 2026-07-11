// GET /api/leads/categorize — AI-categorizes imported leads by industry using Claude.
// Works on customers where industry IS NULL, grouped by domain (so each domain is
// classified once and applied to all its leads). Processes a chunk per call and
// returns how many remain, so it can be run repeatedly until remaining = 0.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const CATEGORIES = [
  'Restaurant',
  'Grocery / Supermarket',
  'Hospitality (Hotel/Resort)',
  'Distributor / Wholesale',
  'Convenience & Fuel',
  'Catering',
  'Bakery / Café / Coffee',
  'Bar / Brewery / Beverage',
  'Institutional (Edu/Health/Gov)',
  'Retail / Big-Box',
  'Entertainment / Venue & Concessions',
  'Other / Unknown',
]

function niceName(domain: string): string {
  const base = (domain.split('.')[0] || domain).replace(/[-_]/g, ' ')
  return base.replace(/\b\w/g, c => c.toUpperCase())
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const need = process.env.REPLY_SCAN_KEY
  if (need && url.searchParams.get('key') !== need) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const source = url.searchParams.get('source') || 'Achyut Email List'
  const maxDomains = Math.min(1400, Math.max(50, Number(url.searchParams.get('max') || 900)))
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  const sb = createSupabaseAdminClient()

  // Pull a page of still-uncategorized leads and reduce to distinct domains.
  const { data: rows, error } = await sb
    .from('customers')
    .select('email')
    .eq('lead_source', source)
    .is('industry', null)
    .limit(20000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const domainsAll = Array.from(
    new Set((rows || [])
      .map(r => String(r.email || '').split('@')[1]?.toLowerCase())
      .filter(Boolean) as string[])
  )
  const totalRemainingDomains = domainsAll.length
  if (!totalRemainingDomains) {
    return NextResponse.json({ done: true, remaining_domains: 0, updated: 0, message: 'Nothing left to categorize.' })
  }

  const domains = domainsAll.slice(0, maxDomains)
  const anthropic = new Anthropic({ apiKey })

  const SUB = 45
  let updated = 0
  let classified = 0
  const started = Date.now()

  for (let i = 0; i < domains.length; i += SUB) {
    if (Date.now() - started > 52000) break // stay under maxDuration
    const chunk = domains.slice(i, i + SUB)
    const listing = chunk.map(d => `${d}  (${niceName(d)})`).join('\n')
    const prompt =
`You are classifying US businesses for a compostable-foodservice-packaging vendor's lead list.
For each email domain below, pick the SINGLE best industry category from this exact list:
${CATEGORIES.map(c => `- ${c}`).join('\n')}

Rules:
- Use the domain name and the company name in parentheses to infer the business type.
- This list skews heavily toward foodservice, so restaurants, grocers, hotels, bars, cafés, distributors and concessions are common.
- Only use "Other / Unknown" when you truly cannot tell (generic tech, personal names, unclear).
- Return ONLY a JSON object mapping each domain exactly as given to its category. No prose.

Domains:
${listing}`

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
      const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
      let map: Record<string, string> = {}
      try { map = JSON.parse(jsonStr) } catch { map = {} }

      // group domains by assigned category, then one UPDATE per category
      const byCat: Record<string, string[]> = {}
      for (const d of chunk) {
        let cat = map[d] || map[d.toLowerCase()]
        if (!cat || !CATEGORIES.includes(cat)) cat = 'Other / Unknown'
        ;(byCat[cat] ||= []).push(d)
      }
      for (const [cat, ds] of Object.entries(byCat)) {
        // update every uncategorized lead whose domain is in this set
        const { data: upd, error: uErr } = await sb.rpc('set_industry_for_domains', {
          p_source: source, p_domains: ds, p_industry: cat,
        })
        if (!uErr && typeof upd === 'number') updated += upd
        classified += ds.length
      }
    } catch (e) {
      // skip this chunk on error; it will be retried on the next run
    }
  }

  const remaining = Math.max(0, totalRemainingDomains - classified)
  return NextResponse.json({
    done: remaining === 0,
    total_remaining_domains_before: totalRemainingDomains,
    classified_domains_this_run: classified,
    remaining_domains: remaining,
    leads_updated_this_run: updated,
    message: remaining === 0 ? 'All leads categorized.' : `Categorized ${classified} domains; ${remaining} domains remain — run again.`,
  })
}
