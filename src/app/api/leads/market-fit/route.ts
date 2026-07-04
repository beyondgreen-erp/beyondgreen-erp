import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function firstJson(text: string): Record<string, unknown> {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}

export async function POST(req: NextRequest) {
  try {
    const { product } = await req.json() as { product?: string }
    if (!product) return NextResponse.json({ error: 'product is required' }, { status: 400 })

    const system = `You are a go-to-market analyst for beyondGREEN biotech, a US manufacturer of certified-compostable and sustainable foodservice/packaging products (cutlery, straws, cups, bags, containers, foil, paper goods). Given a product, identify the US regions most likely to buy it. Weigh two things heavily:
1) REGULATION: single-use plastic/foam bans, polystyrene bans, plastic bag bans, straw bans, EPR laws, and compostable-mandate ordinances at the state and city level. Places with active or upcoming bans are strong markets for compostable alternatives.
2) DEMOGRAPHICS/BEHAVIOR: density of foodservice operators, environmental-values indices, income, tourism, university towns, and green-leaning metros.
Base this on general knowledge; do NOT invent specific statutes you are unsure of — describe the regulatory posture qualitatively and flag uncertainty. Recommend concrete metros/ZIP-worthy areas the sales team can scrape for leads.`

    const user = `Product to sell: "${product}".
Return ONLY JSON:
{
  "summary": "2-3 sentence overview of where this sells best and why",
  "regions": [
    { "area": "metro/city", "state": "ST", "score": 1-100, "regulationAngle": "the ban/law/regulatory reason", "demographicAngle": "the demographic/behavioral reason", "suggestedZips": ["#####","#####"] }
  ],
  "cautions": "1-2 sentences on limits of this analysis"
}
Give 6-10 regions, best first.`

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('')
    const json = firstJson(text)
    if (!json.regions) return NextResponse.json({ error: 'Could not parse analysis', raw: text.slice(0, 500) }, { status: 502 })
    return NextResponse.json(json)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'market-fit failed' }, { status: 500 })
  }
}
