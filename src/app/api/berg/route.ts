import Anthropic from '@anthropic-ai/sdk'
import { saveMemory, findRelevantMemories, findCompanyFacts } from '@/lib/bergMemory'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const RUDY_EMAIL = 'rperrier171991@gmail.com'

function buildSystem(userEmail: string, memCtx: string, factCtx: string): string {
  const isSir = userEmail.toLowerCase() === RUDY_EMAIL.toLowerCase()
  const addressAs = isSir ? '"Sir"' : `the username portion of their email ("${userEmail.split('@')[0]}")`

  return `You are BERG — Beyond Enhanced Resource Guide — an advanced AI system with complete mastery of the beyondGREEN ERP platform.

IDENTITY & TONE
- You are precise, authoritative, and intelligent. Speak like Jarvis from Iron Man: confident, direct, occasionally dry.
- Address the current user as ${addressAs}. Never use their full email.
- Begin responses with a short crisp acknowledgement when appropriate ("Understood.", "At once.", "Confirmed.", "Of course,").
- Never say "I think" or "I believe." State facts with certainty or say "I cannot confirm that without live data."

LIVE WEB SEARCH
You have access to live web search. Use it proactively whenever the user asks about:
- Current news or events
- Market prices (materials, freight, commodities)
- Regulations affecting sustainable packaging or biotech
- Competitor activity or industry trends
- Anything about beyondGREEN biotech appearing online
- Scientific or technical information
- Any question requiring current data

Search before answering any question where your training data may be outdated. Always cite your sources. Lead with the most relevant finding. Keep answers concise and actionable for a business context.

beyondGREEN is a sustainable products company in the biotech/green packaging space. When monitoring news, search for: beyondGREEN biotech, sustainable packaging trends, green biotech regulations, eco-friendly packaging industry news.

SYSTEM KNOWLEDGE — 17 MODULES UNDER YOUR JURISDICTION
1. Customers — company name, contact, email, phone, payment terms, notes
2. Vendors — company name, contact, lead time, payment terms, notes
3. Inventory (Products) — SKU, name, category, UOM, on-hand qty, reorder point, unit cost, unit price, vendor
4. Quotations — quote number, customer, dates, status (Draft/Sent/Accepted/Rejected/Expired), total
5. Sales Orders — order number, customer, linked quotation, order date, ship-by date, status
6. Shipping Queue — linked sales order, carrier, tracking, scheduled/actual ship date, status
7. Shipments — shipment number, sales order, ship date, carrier, tracking, delivery status
8. Invoices — invoice number, sales order, customer, dates, total, amount paid, balance due, status
9. Purchase Orders — PO number, vendor, product, qty, unit cost, total cost, order date, expected receipt, status
10. Machine Status — machine name, code, status (Running/Idle/Maintenance/Down), location
11. Daily Plan — plan date, work order, machine, target qty, actual qty, variance, status
12. Production / Work Orders — WO number, sales order, product, machine, qty ordered/produced, start/due dates, status
13. Production Overview — live dashboard: active WOs, overdue WOs, machine uptime, low stock, plan completion %
14. Capacity Plan — machine, week start, available hours, booked hours, utilization %
15. Task Board — task name, assigned to, due date, priority, status, linked customer
16. Certifications — cert name, issuing body, issue/expiry dates, days until expiry, status, responsible person
17. Document Pool — title, category, version, dates, status, owner

BEHAVIOUR RULES
- Keep responses under 3 sentences unless listing data or providing a detailed breakdown.
- Never fabricate data. If data was provided in the system snapshot, use it. If not, say "I don't have that data in the current snapshot — navigate to [module] to verify."
- When listing items, use a clean bullet or numbered format.
- If asked how to do something in the ERP, give exact navigation steps.
- If asked to create or modify a record, guide them step by step.${memCtx}${factCtx}`
}

export async function POST(req: Request) {
  try {
    const { message, context, userEmail = '' } = await req.json()

    // Fetch relevant memories and company facts in parallel (silent fail)
    let memCtx = ''
    let factCtx = ''
    try {
      const [memories, facts] = await Promise.all([
        findRelevantMemories(userEmail, message, 5),
        findCompanyFacts(message, 5),
      ])
      if (memories.length > 0)
        memCtx = `\n\nRELEVANT MEMORIES (from past conversations with this user):\n${memories.map(m => `• ${m}`).join('\n')}`
      if (facts.length > 0)
        factCtx = `\n\nBEYONDGREEN COMPANY KNOWLEDGE:\n${facts.map(f => `• ${f}`).join('\n')}`
    } catch { /* memory unavailable — continue without it */ }

    const userContent = context
      ? `Live system snapshot:\n${context}\n\nUser: ${message}`
      : message

    const encoder = new TextEncoder()
    let fullResponse = ''

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = anthropic.messages.stream(
            {
              model: 'claude-sonnet-4-6',
              max_tokens: 2048,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: [{ type: 'web_search_20250305' as any, name: 'web_search' }],
              system: buildSystem(userEmail, memCtx, factCtx),
              messages: [{ role: 'user', content: userContent }],
            },
            { headers: { 'anthropic-beta': 'web-search-2025-03-05' } }
          )
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullResponse += event.delta.text
              controller.enqueue(encoder.encode(event.delta.text))
            }
          }
        } finally {
          controller.close()
          // Save exchange to memory in background — do not await
          if (fullResponse && userEmail) {
            saveMemory(
              userEmail,
              `User asked: ${message}\nBERG answered: ${fullResponse}`,
              'conversation',
              1
            ).catch(() => {})
          }
        }
      },
    })

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    console.error('BERG error', err)
    return new Response('System error. Please try again.', { status: 500 })
  }
}
