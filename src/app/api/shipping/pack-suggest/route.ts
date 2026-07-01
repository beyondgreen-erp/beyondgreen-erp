import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface InLine {
  sku: string
  description?: string
  units: number
  unitsPerCase?: number
  weightPerUnitGrams?: number
}

const GRAMS_PER_LB = 453.592

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { lines?: InLine[]; maxCasesPerPallet?: number }
    const lines = body.lines || []
    const cap = body.maxCasesPerPallet && body.maxCasesPerPallet > 0 ? body.maxCasesPerPallet : 40

    // Deterministic case plan per SKU.
    const skuPlan = lines.map(l => {
      const upc = l.unitsPerCase && l.unitsPerCase > 0 ? l.unitsPerCase : 1
      const cases = Math.max(1, Math.ceil((l.units || 0) / upc))
      const caseWeightLb = +(((upc * (l.weightPerUnitGrams || 0)) / GRAMS_PER_LB)).toFixed(2)
      return {
        sku: l.sku,
        description: l.description || '',
        totalUnits: l.units || 0,
        unitsPerCase: upc,
        cases,
        caseWeightLb,
        totalWeightLb: +(caseWeightLb * cases).toFixed(2),
      }
    })

    // Pack cases onto pallets sequentially (fills pallets to cap, keeps SKUs together where possible).
    const pallets: { palletNumber: number; cases: { sku: string; count: number }[]; caseCount: number; weightLb: number }[] = []
    let cur: typeof pallets[number] | null = null
    for (const s of skuPlan) {
      let remaining = s.cases
      while (remaining > 0) {
        if (!cur || cur.caseCount >= cap) {
          cur = { palletNumber: pallets.length + 1, cases: [], caseCount: 0, weightLb: 0 }
          pallets.push(cur)
        }
        const room = cap - cur.caseCount
        const put = Math.min(room, remaining)
        cur.cases.push({ sku: s.sku, count: put })
        cur.caseCount += put
        cur.weightLb = +(cur.weightLb + put * s.caseWeightLb).toFixed(2)
        remaining -= put
      }
    }

    const totals = {
      pallets: pallets.length,
      cases: skuPlan.reduce((a, s) => a + s.cases, 0),
      weightLb: +(skuPlan.reduce((a, s) => a + s.totalWeightLb, 0)).toFixed(2),
    }

    let notes = ''
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `You are a shipping/packing assistant for a packaging manufacturer. Given this computed pack plan, write 2-3 short bullet recommendations (mixed-case opportunities, pallet balance, anything to double-check). Be concise. Plan: ${JSON.stringify({ skuPlan, totals, cap })}`,
        }],
      })
      notes = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim()
    } catch { notes = '' }

    return NextResponse.json({ skuPlan, pallets, totals, notes })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'pack-suggest failed' }, { status: 500 })
  }
}
