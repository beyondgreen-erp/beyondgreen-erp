import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: NextRequest) {
  const { emailThread, customer } = await req.json()
  if (!emailThread?.trim()) return NextResponse.json({ error: 'No conversation provided' }, { status: 400 })
  if (!customer?.id) return NextResponse.json({ error: 'No customer selected' }, { status: 400 })

  const current = JSON.stringify({
    company_name: customer.company_name ?? '',
    contact_name: customer.contact_name ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    customer_status: customer.customer_status ?? '',
    pipeline_stage: customer.pipeline_stage ?? '',
    priority: customer.priority ?? '',
    deal_value: customer.deal_value ?? null,
    probability: customer.probability ?? null,
    expected_close_date: customer.expected_close_date ?? null,
    next_follow_up: customer.next_follow_up ?? null,
    industry: customer.industry ?? '',
    lead_source: customer.lead_source ?? '',
    payment_terms: customer.payment_terms ?? '',
    notes: customer.notes ?? '',
  }, null, 2)

  const today = new Date().toISOString().slice(0, 10)

  const msg = await anthropic.messages.create({
    system: 'You are a CRM assistant. Output raw JSON only, no markdown.',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Today is ${today}. Below is an existing customer record and the latest email/conversation thread with them. Read the thread and produce (1) a clean conversation-log entry and (2) ONLY the customer field updates that the new conversation actually changes or newly reveals. Do not restate unchanged values. If a field has no new information, omit it from "updates".

EXISTING CUSTOMER RECORD:
${current}

LATEST CONVERSATION / EMAIL THREAD:
${emailThread}

Also list every distinct person who appears in the thread (senders/recipients/signatures) under "contacts". Return ONLY this exact JSON structure (omit any key inside "updates" that has no new info; use null where a value cannot be determined):
{
  "conversation": {
    "conversation_type": "email | call | meeting | text | note | other",
    "subject": "Short subject line for this conversation",
    "content": "A clear 2-5 sentence summary of what was discussed and decided",
    "contact_name": "Person spoken with, or empty string",
    "outcome": "Brief outcome / current state, or empty string",
    "follow_up_date": "YYYY-MM-DD or null"
  },
  "contacts": [
    { "full_name": "Person mentioned in the thread", "title": "Job title or empty string", "email": "Email or empty string", "phone": "Phone or empty string" }
  ],
  "updates": {
    "customer_status": "Lead | Prospect | Active | Inactive",
    "pipeline_stage": "string",
    "priority": "string",
    "contact_name": "string",
    "email": "string",
    "phone": "string",
    "deal_value": 0,
    "probability": 0,
    "expected_close_date": "YYYY-MM-DD",
    "next_follow_up": "YYYY-MM-DD",
    "industry": "string",
    "lead_source": "string",
    "payment_terms": "string",
    "notes_append": "One concise line to append to the running notes, dated"
  },
  "change_summary": "One sentence describing what changed for this customer"
}`
    }]
  })

  try {
    const rawText = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    const start = rawText.indexOf('{')
    const end = rawText.lastIndexOf('}')
    const text = (start >= 0 && end > start) ? rawText.slice(start, end + 1) : rawText.trim()
    const data = JSON.parse(text)
    // Drop empty/blank update fields so the preview only shows real changes
    if (data.updates) {
      for (const k of Object.keys(data.updates)) {
        const v = data.updates[k]
        if (v === null || v === undefined || v === '' || (typeof v === 'number' && k !== 'probability' && k !== 'deal_value' && v === 0)) {
          delete data.updates[k]
        }
      }
    }
    return NextResponse.json(data)
  } catch (e) {
    console.error('AI update parse error:', e)
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
