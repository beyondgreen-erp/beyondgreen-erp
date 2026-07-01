import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function firstJson(text: string): Record<string, unknown> {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}

interface FillInput {
  productDescriptions?: string[]
  categories?: string[]
  totalPallets?: number
  totalCases?: number
  totalWeight?: number
  orderValue?: number
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json() as FillInput
    const fallback = {
      commodityDescription: (b.productDescriptions && b.productDescriptions[0]) || 'Disposable Foodservice Products',
      nmfcNumber: '',
      freightClass: '',
      declaredValue: b.orderValue ?? 0,
      specialInstructions: 'DO NOT STACK',
    }

    let out = { ...fallback }
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You fill out LTL Bill of Lading commodity fields for a compostable/paper/foodservice packaging manufacturer (beyondGREEN). From the shipment data, return ONLY JSON with keys: commodityDescription (short freight description, e.g. "Disposable Cutlery" or "Paper Products"), nmfcNumber (best-guess NMFC item number as string, or ""), freightClass (typical LTL class as string like "70","92.5", or ""), declaredValue (number, use orderValue if given), specialInstructions (string). Data: ${JSON.stringify(b)}`,
        }],
      })
      const text = msg.content.filter(x => x.type === 'text').map(x => (x as { text: string }).text).join('')
      const j = firstJson(text)
      out = {
        commodityDescription: typeof j.commodityDescription === 'string' && j.commodityDescription ? j.commodityDescription : fallback.commodityDescription,
        nmfcNumber: typeof j.nmfcNumber === 'string' ? j.nmfcNumber : '',
        freightClass: typeof j.freightClass === 'string' ? j.freightClass : '',
        declaredValue: Number.isFinite(Number(j.declaredValue)) ? Number(j.declaredValue) : fallback.declaredValue,
        specialInstructions: typeof j.specialInstructions === 'string' && j.specialInstructions ? j.specialInstructions : fallback.specialInstructions,
      }
    } catch { /* keep fallback */ }

    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'bol-fill failed' }, { status: 500 })
  }
}
