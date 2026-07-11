import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

// Derive a clean domain from a website URL or email.
function domainOf(website?: string | null, email?: string | null): string | null {
  const src = (website || '').trim()
  if (src) {
    try {
      const u = new URL(src.startsWith('http') ? src : 'https://' + src)
      return u.hostname.replace(/^www\./, '')
    } catch { /* fall through */ }
    const m = src.replace(/^www\./, '').match(/([a-z0-9-]+\.[a-z.]{2,})/i)
    if (m) return m[1].toLowerCase()
  }
  if (email && email.includes('@')) return email.split('@')[1].toLowerCase()
  return null
}

interface HunterEmail { value: string; first_name?: string; last_name?: string; position?: string; seniority?: string; linkedin?: string; confidence?: number }

export async function POST(req: NextRequest) {
  try {
    const { ids } = (await req.json()) as { ids?: string[] }
    if (!ids || !ids.length) return NextResponse.json({ error: 'No leads selected' }, { status: 400 })
    const batch = ids.slice(0, 40) // keep within the time budget

    const sb = createSupabaseAdminClient()
    const key = process.env.HUNTER_API_KEY
    const { data: rows } = await sb.from('customers')
      .select('id, company_name, website, email, contact_name, title')
      .in('id', batch)
    const leads = rows || []

    let enriched = 0, emailsFound = 0
    const noProvider: string[] = []

    for (const lead of leads) {
      const domain = domainOf(lead.website as string, lead.email as string)
      const patch: Record<string, unknown> = { enriched_at: new Date().toISOString() }

      if (!domain) { patch.enrichment_source = 'no-domain'; await sb.from('customers').update(patch).eq('id', lead.id); continue }

      if (key) {
        try {
          const r = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=5&api_key=${key}`)
          const j = await r.json()
          const org = j?.data?.organization as string | undefined
          const emails = (j?.data?.emails || []) as HunterEmail[]
          // pick the most senior / highest-confidence contact
          const best = [...emails].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0]
          patch.enrichment_source = 'hunter'
          if (org) patch.company_size = j?.data?.headcount || patch.company_size
          if (best) {
            emailsFound++
            if (!lead.email) patch.email = best.value
            const name = [best.first_name, best.last_name].filter(Boolean).join(' ').trim()
            if (name && !lead.contact_name) patch.contact_name = name
            if (best.position && !lead.title) patch.title = best.position
            if (best.seniority) patch.seniority = best.seniority
            if (best.linkedin) patch.linkedin_url = best.linkedin
          }
        } catch { patch.enrichment_source = 'hunter-error' }
      } else {
        // No provider key configured — record the derived domain so the lead is at least normalized.
        patch.enrichment_source = 'domain-only'
        noProvider.push(lead.company_name as string)
      }

      await sb.from('customers').update(patch).eq('id', lead.id)
      enriched++
    }

    return NextResponse.json({
      enriched,
      emailsFound,
      provider: key ? 'hunter' : 'none',
      message: key
        ? `Enriched ${enriched} lead(s); found ${emailsFound} new email(s).`
        : `Normalized ${enriched} lead(s). To pull real emails/titles, add a HUNTER_API_KEY in the project settings — then re-run enrichment.`,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || 'Enrichment failed' }, { status: 500 })
  }
}
