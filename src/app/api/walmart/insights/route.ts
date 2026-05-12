import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

export async function POST() {
  try {
    const sb = getSupabase()

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 90)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const [prodRes, ordersRes, invRes, bomRes] = await Promise.all([
      sb.from('walmart_production').select('*').gte('production_date', cutoffStr).order('production_date', { ascending: true }),
      sb.from('walmart_orders').select('*').order('order_date', { ascending: false }),
      sb.from('walmart_inventory').select('*'),
      sb.from('walmart_bom').select('*'),
    ])

    const productionData = prodRes.data ?? []
    const ordersData = ordersRes.data ?? []
    const inventoryData = invRes.data ?? []
    const bomData = bomRes.data ?? []

    const systemPrompt = `You are a supply chain analyst for beyondGREEN biotech, a sustainable products company. Analyze the provided Walmart production and inventory data and provide actionable insights.

beyondGREEN produces 7 Walmart SKUs (compostable cutlery in SRP format - 6-packs per SRP):
- 22GVF24: Fork 24ct SRP
- 22GVA24: Assorted 24ct SRP
- 22GVK48: Knife 48ct SRP
- 22GVA48: Assorted 48ct SRP
- 22GVS48: Spoon 48ct SRP
- 22GVS24: Spoon 24ct SRP
- 22GVF48: Fork 48ct SRP

Analyze the data and provide:
1. Current run rate (SRPs per day/week)
2. Production trend (improving/declining)
3. Forecast for next 30/60/90 days
4. Inventory risk assessment
5. Which SKUs need urgent production
6. Packaging burn rate analysis
7. Recommended production targets
8. Any anomalies or concerns
9. Week-over-week performance comparison
10. Estimated weeks of coverage per SKU

Format your response as JSON with this exact structure:
{
  "run_rate": {
    "daily_avg_srps": number,
    "weekly_avg_srps": number,
    "trend": "improving" | "stable" | "declining",
    "trend_pct": number
  },
  "forecast": {
    "next_30_days_srps": number,
    "next_60_days_srps": number,
    "next_90_days_srps": number,
    "confidence": "high" | "medium" | "low"
  },
  "sku_analysis": [
    {
      "sku": string,
      "weeks_coverage": number,
      "urgency": "critical" | "low" | "ok" | "good",
      "recommended_weekly_target": number,
      "insight": string
    }
  ],
  "packaging_analysis": {
    "tightest_component": string,
    "days_remaining": number,
    "burn_rate_per_day": number
  },
  "alerts": string[],
  "recommendations": string[],
  "performance_summary": string
}`

    const userMessage = `Here is the production data for the last 90 days:

PRODUCTION ENTRIES (${productionData.length} records):
${JSON.stringify(productionData.slice(-60), null, 2)}

CURRENT INVENTORY:
${JSON.stringify(inventoryData, null, 2)}

OPEN/RECENT ORDERS:
${JSON.stringify(ordersData.slice(0, 20), null, 2)}

BOM DATA:
${JSON.stringify(bomData, null, 2)}

Please analyze this data and return ONLY valid JSON matching the specified structure. No markdown, no explanation outside the JSON.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    let parsed
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : text)
    } catch {
      parsed = { error: 'Failed to parse AI response', raw: text.slice(0, 500) }
    }

    return Response.json({ ok: true, data: parsed, generated_at: new Date().toISOString() })
  } catch (err) {
    console.error('Walmart insights error', err)
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
