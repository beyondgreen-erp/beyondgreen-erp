import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const ADMIN_EMAIL = 'rperrier171991@gmail.com'

interface Alert { title: string; summary: string; url: string; source: string; sentiment: string }

function parseAlerts(text: string): Alert[] {
  try {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/(\[[\s\S]*\])/)
    if (match) return JSON.parse(match[1])
  } catch { /* fall through */ }
  // Couldn't parse structured JSON — save whole response as one alert
  if (text.trim()) {
    return [{
      title: 'beyondGREEN Web Monitor Report',
      summary: text.slice(0, 1000),
      url: '',
      source: 'BERG Web Search',
      sentiment: 'neutral',
    }]
  }
  return []
}

export async function GET(req: Request) {
  // Verify Vercel cron secret if configured
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('Authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  try {
    const prompt = `Search the web for the latest news about "beyondGREEN biotech" and "sustainable packaging" trends in the last 24 hours. Also search for "eco-friendly packaging industry news" and "green biotech regulations".

For each relevant article or mention found, return a JSON array with this exact format:
\`\`\`json
[
  {
    "title": "Article headline",
    "summary": "2-3 sentence summary of what was found and why it matters to beyondGREEN",
    "url": "article URL if available, otherwise empty string",
    "source": "news source name",
    "sentiment": "positive|neutral|negative"
  }
]
\`\`\`

Focus on: beyondGREEN mentions, sustainable packaging industry news, competitor activity, regulatory changes, and market trends. Return an empty array [] if nothing relevant is found. Return ONLY the JSON array.`

    const response = await anthropic.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20250305' as any, name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      },
      { headers: { 'anthropic-beta': 'web-search-2025-03-05' } }
    )

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    const alerts = parseAlerts(text)

    if (alerts.length === 0) {
      return new Response(JSON.stringify({ ok: true, saved: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    const rows = alerts.map(a => ({
      alert_type: 'web_mention',
      title: a.title,
      summary: a.summary,
      url: a.url || null,
      source: a.source,
      sentiment: a.sentiment,
      is_read: false,
    }))

    await supabase.from('berg_alerts').insert(rows)

    // Notify admin via Supabase notifications table if it exists
    try {
      await supabase.from('notifications').insert({
        user_email: ADMIN_EMAIL,
        title: `BERG found ${alerts.length} web mention${alerts.length !== 1 ? 's' : ''}`,
        body: alerts[0].title,
        type: 'berg_alert',
        is_read: false,
      })
    } catch { /* notifications table may not exist */ }

    return new Response(JSON.stringify({ ok: true, saved: alerts.length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('BERG monitor error', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
