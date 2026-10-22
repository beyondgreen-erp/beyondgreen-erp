/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerClient } from '@/lib/supabase'
import { aiErrorMessage } from '@/lib/aiError'

/**
 * The planner's "brain". The maths engine builds the plan; this reviews it against what
 * actually happened on the floor (logged SRPs, confirmed plans, machine downtime, its own
 * past advice) and returns suggestions only. It never changes the plan — the team confirms.
 */
export const maxDuration = 120
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const NL = String.fromCharCode(10)

function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return null
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const s = await createSupabaseServerClient()
    const { data: { user } } = await s.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
    const { woId, date, plan } = await req.json() as { woId?: string; date?: string; plan?: any }
    if (!woId || !date || !plan) return NextResponse.json({ error: 'woId, date and plan are required' }, { status: 400 })

    const sb = createSupabaseAdminClient()
    const [learnR, dailyR, insR, snapR] = await Promise.all([
      sb.rpc('walmart_planner_learning', { p_days: 42 }),
      sb.rpc('walmart_planner_daily_by_sku', { p_days: 21 }),
      sb.from('walmart_ai_insights').select('plan_date, advice, created_at').order('created_at', { ascending: false }).limit(8),
      sb.from('walmart_plan_snapshots').select('plan_date, planned, settings, confirmed_by').order('plan_date', { ascending: false }).limit(14),
    ])

    const pastAdvice = ((insR.data as any[]) || []).map(r => ({ for_date: r.plan_date, headline: r.advice?.headline, suggestions: (r.advice?.suggestions || []).map((x: any) => x.title) }))
    const prompt = [
      'You are the production-planning advisor ("brain") for beyondGREEN biotech\'s Walmart cutlery line.',
      'Product: SRPs (shelf-ready packs of 6 boxes) of compostable cutlery. Pieces (fork BGFRK, spoon BGSPN, knife BGKNF) are injection-molded on machines with fixed molds, then packed by hand into SRPs.',
      'A maths optimiser (linear programming) already produced tomorrow\'s plan below. Your job: review it against the REAL history and give the team practical suggestions.',
      'Rules:',
      '- Suggestions only. The team confirms the plan; never say you changed anything.',
      '- Be specific and numeric (machines, SKUs, SRPs, hours, lbs). Reference the data you used.',
      '- Compare planned vs actual: where the model\'s assumptions (pack rates, packers, machine availability, materials) disagree with what really happens, say so and suggest the correction.',
      '- Learn from your own past advice: do not repeat advice that was clearly not useful; build on what the data shows since.',
      '- Flag material/packaging shortages, machines that keep going down, loads at risk of missing pick-up.',
      '- Plain English for a shop-floor team. Max 5 suggestions, max 4 risks, max 4 learned. Keep every string under 45 words.',
      '',
      `Plan date: ${date}`,
      'TOMORROW\'S PLAN (from the optimiser):', JSON.stringify(plan),
      '',
      'LEARNING DATA — last 42 days (planned vs actual, machine downtime from the Daily Plan):', JSON.stringify(learnR.data || {}),
      '',
      'ACTUAL SRPs LOGGED PER DAY PER SKU (last 21 days):', JSON.stringify(dailyR.data || []),
      '',
      'RECENT CONFIRMED PLANS:', JSON.stringify(snapR.data || []),
      '',
      'YOUR PAST ADVICE (most recent first):', JSON.stringify(pastAdvice),
      '',
      'Return ONLY JSON:',
      '{ "headline": "one sentence on tomorrow", "confidence": "low|medium|high (based on how much real data exists)",',
      '  "suggestions": [ { "title": "short action", "why": "evidence from the data", "impact": "expected effect, with numbers", "area": "packing|molding|materials|priority|machines|data" } ],',
      '  "risks": [ "short risk statements" ],',
      '  "learned": [ "what the real data says about the model\'s assumptions, e.g. real packing speed vs entered rates" ] }',
    ].join(NL)

    const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] })
    const text = msg.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    const advice = firstJson(text) || salvageJson(text)
    if (!advice) return NextResponse.json({ error: 'The AI did not return a readable answer. Try again.' }, { status: 502 })
    await sb.from('walmart_ai_insights').insert({ plan_date: date, work_order_id: woId, advice, model: 'claude-sonnet-4-6', created_by: user.email || null })
    return NextResponse.json({ ok: true, advice })
  } catch (e) {
    return NextResponse.json({ error: aiErrorMessage(e, 'The AI advisor could not run.') }, { status: 500 })
  }
}

// If the answer was cut off mid-JSON, keep everything up to the last complete suggestion.
function salvageJson(text: string): any {
  const start = text.indexOf('{')
  if (start < 0) return null
  const body = text.slice(start)
  for (let cut = body.lastIndexOf('}'); cut > 0; cut = body.lastIndexOf('}', cut - 1)) {
    const head = body.slice(0, cut + 1)
    for (const tail of [']}', '] }', '"]}', '}']) {
      try { const j = JSON.parse(head + tail); if (j && j.headline) return { suggestions: [], risks: [], learned: [], ...j } } catch { /* keep trying */ }
    }
  }
  return null
}
