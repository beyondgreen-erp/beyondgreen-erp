import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']

interface Member { full_name: string; email: string }

function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}

export async function POST(req: NextRequest) {
  try {
    const { text, members } = await req.json() as { text?: string; members?: Member[] }
    if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

    const team = (members || []).filter(m => m?.full_name)
    const roster = team.map(m => `- ${m.full_name} (${m.email})`).join('\n') || '(none provided)'
    const today = new Date().toISOString().slice(0, 10)

    const system = `You turn a pasted email or note into a single actionable task for the beyondGREEN task board.
Today is ${today}.
Return ONLY a JSON object, no prose, with these keys:
- "task_name": a short imperative task title (max ~80 chars). Strip "Re:"/"Fwd:" prefixes and email noise.
- "assignee": the FULL NAME of the best-matching team member from the roster below, or "" if none clearly fits. Use the exact full name as written in the roster. Infer from who the work is for, who is addressed, or the sender. Do not invent names.
- "priority": one of Low, Medium, High, Critical. Judge from urgency/tone; default Medium.
- "due_date": an ISO date YYYY-MM-DD if a clear deadline is stated or strongly implied, else "".
- "notes": one or two sentences of helpful context pulled from the text, else "".

Team roster (match assignee to the full name only):
${roster}`

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: `Email / note:\n\n${text.slice(0, 8000)}` }],
    })

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const j = firstJson(raw)

    // Resolve assignee strictly to a roster full name (case-insensitive)
    let assignee = ''
    if (typeof j.assignee === 'string' && j.assignee.trim()) {
      const want = j.assignee.trim().toLowerCase()
      const hit = team.find(m => m.full_name.toLowerCase() === want)
        || team.find(m => m.full_name.toLowerCase().startsWith(want))
        || team.find(m => m.email.toLowerCase() === want)
      if (hit) assignee = hit.full_name
    }
    const priority = PRIORITIES.includes(j.priority) ? j.priority : 'Medium'
    const due_date = typeof j.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.due_date) ? j.due_date : ''
    const task_name = (typeof j.task_name === 'string' ? j.task_name : '').trim().slice(0, 120)
    const notes = (typeof j.notes === 'string' ? j.notes : '').trim().slice(0, 600)

    return NextResponse.json({ task_name, assignee, priority, due_date, notes })
  } catch (err) {
    console.error('tasks/parse error:', err)
    return NextResponse.json({ error: (err as Error).message || 'Parse failed' }, { status: 500 })
  }
}
