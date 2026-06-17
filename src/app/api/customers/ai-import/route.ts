import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { emailThread } = await req.json()
  if (!emailThread?.trim()) return NextResponse.json({ error: 'No email thread provided' }, { status: 400 })

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Extract customer information from this email thread. Return ONLY valid JSON, no markdown.

Email thread:
${emailThread}

Return this exact JSON structure:
{
  "company_name": "Company name or empty string",
  "email": "Primary company email or empty string",
  "phone": "Phone number or empty string",
  "notes": "Brief summary of what they need/context",
  "pipeline_stage": "Lead",
  "customer_status": "Lead",
  "contacts": [
    {
      "full_name": "Contact full name",
      "title": "Job title or empty string",
      "email": "Contact email",
      "phone": "Contact phone or empty string",
      "is_primary": true
    }
  ],
  "email_thread_summary": "One paragraph summary of the email conversation",
  "email_log": [
    {
      "subject": "Email subject",
      "body": "Email body text",
      "direction": "inbound or outbound"
    }
  ]
}`
    }]
  })

  try {
    const rawText = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    // Extract JSON: find outermost { } to handle any wrapping text or fences
    const start = rawText.indexOf('{')
    const end = rawText.lastIndexOf('}')
    const text = (start >= 0 && end > start) ? rawText.slice(start, end + 1) : rawText.trim()
    const data = JSON.parse(text)
    return NextResponse.json(data)
  } catch (e) {
    console.error('AI parse error:', e)
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
