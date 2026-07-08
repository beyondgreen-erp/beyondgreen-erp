import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface Input {
  orderNumber?: string; poNumber?: string; customer?: string; carrier?: string
  bolNumber?: string; totalPallets?: number; totalCases?: number; totalWeight?: number
  photoUrls?: string[]; docNames?: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any

export async function POST(req: NextRequest) {
  try {
    const b = await req.json() as Input
    const photos = (b.photoUrls || []).filter(u => typeof u === 'string').slice(0, 8)
    const content: Block[] = photos.map(url => ({ type: 'image', source: { type: 'url', url } }))
    content.push({
      type: 'text',
      text: `You are logging a completed outbound shipment for beyondGREEN (foodservice packaging manufacturer). Review the attached shipment photos and the shipment data, then write a concise, factual summary (4-6 sentences) for safe record-keeping and proof of condition at handoff: what shipped, how it was packed / palletized / wrapped / secured, whether labels and the BOL are visible and legible, any visible damage or concerns, and anything notable for tracking. Only state what is actually visible or given — do not invent details. Shipment data: ${JSON.stringify({ orderNumber: b.orderNumber, poNumber: b.poNumber, customer: b.customer, carrier: b.carrier, bolNumber: b.bolNumber, totalPallets: b.totalPallets, totalCases: b.totalCases, totalWeight: b.totalWeight, attachedDocuments: b.docNames })}`,
    })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{ role: 'user', content }],
    })
    const summary = msg.content.filter(x => x.type === 'text').map(x => (x as { text: string }).text).join('').trim()
    return NextResponse.json({ summary })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'summary failed', summary: '' })
  }
}
