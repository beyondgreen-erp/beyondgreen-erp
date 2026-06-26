import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { emailThread } = await req.json()
  if (!emailThread?.trim()) return NextResponse.json({ error: 'No email provided' }, { status: 400 })

  const msg = await anthropic.messages.create({
    system: 'You turn an email into a short personal reminder. Output raw JSON only, no markdown.',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Read this email and create a short reminder for the person to act on it. Do NOT include any date. Keep the title to one actionable line.

Email:
${emailThread}

Return ONLY this JSON:
{
  "title": "Short actionable reminder, e.g. 'Follow up with Acme on the pricing PO'",
  "notes": "1-3 sentences of context worth remembering (who/what/why), or empty string",
  "reminder_type": "follow_up | call | meeting | deadline | personal | other",
  "priority": "urgent | high | medium | low"
}`
    }]
  })

  try {
    const rawText = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    const start = rawText.indexOf('{')
    const end = rawText.lastIndexOf('}')
    const text = (start >= 0 && end > start) ? rawText.slice(start, end + 1) : rawText.trim()
    const data = JSON.parse(text)
    return NextResponse.json(data)
  } catch (e) {
    console.error('Reminder AI parse error:', e)
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
