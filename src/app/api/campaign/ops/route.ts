import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(34);

async function aiFollowup(customer: any, prior: any[]) {
  const priorText = (prior || []).map((p: any, i: number) => "Email " + (i + 1) + " - subject: " + (p.subject || "(none)") + NL + (p.body || "").slice(0, 600)).join(NL + "---" + NL);
  const prompt = "You write short B2B sales follow-up emails for beyondGREEN Biotech, a maker of compostable and biodegradable packaging (bags, mailers, produce bags, food-service packaging). Write the NEXT follow-up email to " + ((customer && customer.company_name) || "the company") + ((customer && customer.industry) ? (" (" + customer.industry + ")") : "") + ". Keep it under 120 words, warm, specific, and not pushy, ending with a soft call to action. Do not include a signature, sign-off name, or catalog link - those are added automatically." + NL + NL + "Prior emails in this thread:" + NL + (priorText || "(none yet)") + NL + NL + "Return ONLY valid JSON: {" + Q + "subject" + Q + ": ..., " + Q + "body" + Q + ": ...}";
  const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 700, messages: [{ role: "user", content: prompt }] });
  const txt = ((msg.content[0] as any) && (msg.content[0] as any).text) || "";
  const a = txt.indexOf("{"); const b = txt.lastIndexOf("}");
  try { return JSON.parse(a >= 0 && b > a ? txt.slice(a, b + 1) : txt); } catch (e) { return { subject: "Following up", body: txt }; }
}

// GET -> per-customer campaign stats map (last launch, emails sent, active, responded)
export async function GET() {
  const { data, error } = await supabase.from('customer_campaign_stats').select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stats: Record<string, any> = {};
  for (const s of (data || []) as any[]) stats[s.customer_id] = s;
  return NextResponse.json({ stats });
}

// POST { action:'remove', customer_id } -> stop the active campaign + follow-ups for that customer
export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const { action, customer_id, outreach_id } = body;
  if (action === "workflow") {
    if (!customer_id) return NextResponse.json({ error: "customer_id required" }, { status: 400 });
    const { data: rows } = await supabase.from("customer_outreach").select("id, subject, body, sent_at, kind, sequence_step, parent_outreach_id, opened_at, open_count, response_received, response_at, follow_up_due, follow_up_sent_at, status, sequence_active, max_follow_ups, start_probability, created_at").eq("customer_id", customer_id).order("created_at", { ascending: true });
    const list = (rows || []) as any[];
    const { data: cust } = await supabase.from("customers").select("id, company_name, industry, probability").eq("id", customer_id).single();
    const sent = list.filter((r: any) => r.sent_at).length;
    const openedCount = list.filter((r: any) => r.opened_at).length;
    const opens = list.reduce((a: number, r: any) => a + (r.open_count || 0), 0);
    const replied = list.some((r: any) => r.response_received);
    const maxN = list.reduce((a: number, r: any) => Math.max(a, r.max_follow_ups || 0), 0);
    const followsSent = list.filter((r: any) => r.parent_outreach_id && r.sent_at).length;
    const pending = list.filter((r: any) => r.sequence_active && !r.follow_up_sent_at && r.follow_up_due).map((r: any) => r.follow_up_due).sort();
    const nextDue = pending[0] || null;
    const initial = list.find((r: any) => !r.parent_outreach_id) || list[0];
    let startProb = initial ? (initial.start_probability != null ? initial.start_probability : null) : null;
    const curProb = (cust && cust.probability != null) ? cust.probability : null;
    if (initial && startProb == null && curProb != null) { startProb = curProb; await supabase.from("customer_outreach").update({ start_probability: curProb }).eq("id", initial.id); }
    const delta = (curProb != null && startProb != null) ? (curProb - startProb) : null;
    const thread = list.map((r: any) => ({ id: r.id, subject: r.subject, body: r.body, sent_at: r.sent_at, is_followup: !!r.parent_outreach_id, sequence_step: r.sequence_step, opened: !!r.opened_at, open_count: r.open_count || 0, replied: !!r.response_received, response_at: r.response_at, follow_up_due: r.follow_up_due, follow_up_sent_at: r.follow_up_sent_at, status: r.status, sequence_active: r.sequence_active, missing_content: !r.subject || !r.body }));
    return NextResponse.json({ customer: { company_name: cust ? cust.company_name : null, probability: curProb, start_probability: startProb, delta: delta }, metrics: { sent: sent, opens: opens, opened_count: openedCount, open_rate: sent ? Math.round((openedCount / sent) * 100) : 0, replied: replied, step: followsSent, max_follow_ups: maxN, next_due: nextDue }, thread: thread });
  }
  if (action === "preview_next") {
    if (!customer_id) return NextResponse.json({ error: "customer_id required" }, { status: 400 });
    const { data: cust } = await supabase.from("customers").select("id, company_name, industry").eq("id", customer_id).single();
    const { data: prior } = await supabase.from("customer_outreach").select("subject, body").eq("customer_id", customer_id).not("sent_at", "is", null).order("created_at", { ascending: true });
    try { const draft = await aiFollowup(cust, (prior || []) as any[]); return NextResponse.json({ draft: draft }); } catch (e: any) { return NextResponse.json({ error: (e && e.message) || "AI generation failed" }, { status: 500 }); }
  }
  if (action === "fill_missing") {
    if (!outreach_id) return NextResponse.json({ error: "outreach_id required" }, { status: 400 });
    const { data: row } = await supabase.from("customer_outreach").select("id, customer_id, subject, body").eq("id", outreach_id).single();
    if (!row) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    const { data: cust } = await supabase.from("customers").select("id, company_name, industry").eq("id", (row as any).customer_id).single();
    const { data: prior } = await supabase.from("customer_outreach").select("subject, body").eq("customer_id", (row as any).customer_id).not("sent_at", "is", null).order("created_at", { ascending: true });
    try { const draft = await aiFollowup(cust, (prior || []) as any[]); await supabase.from("customer_outreach").update({ subject: draft.subject, body: draft.body }).eq("id", outreach_id); return NextResponse.json({ draft: draft }); } catch (e: any) { return NextResponse.json({ error: (e && e.message) || "AI generation failed" }, { status: 500 }); }
  }
  if (action === "analytics") {
    const { data: rowsRaw } = await supabase.from("customer_outreach").select("id, subject, sent_at, opened_at, open_count, response_received, parent_outreach_id, campaign_id").not("sent_at", "is", null).order("sent_at", { ascending: true });
    const rows = (rowsRaw || []) as any[];
    const sent = rows.length;
    const opened = rows.filter((r: any) => r.opened_at).length;
    const replied = rows.filter((r: any) => r.response_received).length;
    const openRate = sent ? Math.round((opened / sent) * 100) : 0;
    const replyRate = sent ? Math.round((replied / sent) * 100) : 0;
    const camp: any = {};
    for (const r of rows) { const k = r.campaign_id || "none"; if (!camp[k]) camp[k] = { sent: 0, opened: 0, replied: 0, first: r.sent_at }; const c = camp[k]; c.sent++; if (r.opened_at) c.opened++; if (r.response_received) c.replied++; if (r.sent_at < c.first) c.first = r.sent_at; }
    const campaigns = Object.keys(camp).map((k) => { const c = camp[k]; return { label: c.first ? new Date(c.first).toLocaleDateString() : "-", sent: c.sent, open_rate: c.sent ? Math.round((c.opened / c.sent) * 100) : 0, reply_rate: c.sent ? Math.round((c.replied / c.sent) * 100) : 0 }; }).sort((a: any, b: any) => b.reply_rate - a.reply_rate || b.open_rate - a.open_rate);
    const byDate: any = {};
    for (const r of rows) { const d = (r.sent_at || "").slice(0, 10); if (!d) continue; if (!byDate[d]) byDate[d] = { sent: 0, opened: 0, replied: 0 }; byDate[d].sent++; if (r.opened_at) byDate[d].opened++; if (r.response_received) byDate[d].replied++; }
    const trend = Object.keys(byDate).sort().map((d) => { const x = byDate[d]; return { date: d, open_rate: x.sent ? Math.round((x.opened / x.sent) * 100) : 0, reply_rate: x.sent ? Math.round((x.replied / x.sent) * 100) : 0, sent: x.sent }; });
    const initials = rows.filter((r: any) => !r.parent_outreach_id && r.subject);
    const scored = initials.map((r: any) => ({ subject: r.subject, score: (r.response_received ? 2 : 0) + (r.opened_at ? 1 : 0), opened: !!r.opened_at, replied: !!r.response_received }));
    const winners = scored.filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 6);
    const losers = scored.filter((s: any) => s.score === 0).slice(0, 6);
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayAgg: any = {};
    for (const r of rows) { if (!r.sent_at) continue; const day = new Date(r.sent_at).getUTCDay(); if (!dayAgg[day]) dayAgg[day] = { sent: 0, opened: 0 }; dayAgg[day].sent++; if (r.opened_at) dayAgg[day].opened++; }
    const byDay = Object.keys(dayAgg).map((d: any) => ({ day: dow[d], open_rate: dayAgg[d].sent ? Math.round((dayAgg[d].opened / dayAgg[d].sent) * 100) : 0, sent: dayAgg[d].sent })).sort((a: any, b: any) => b.open_rate - a.open_rate);
    let insights: string[] = [];
    try {
      const summary = "Overall: " + sent + " emails sent, open rate " + openRate + "%, reply rate " + replyRate + "%. Winning subjects (got opens/replies): " + winners.map((w: any) => w.subject).join(" | ") + ". Ignored subjects (no opens): " + losers.map((l: any) => l.subject).join(" | ") + ". Open rate by weekday: " + byDay.map((d: any) => d.day + " " + d.open_rate + "%").join(", ") + ".";
      const prompt = "You are a B2B email marketing analyst for beyondGREEN Biotech (compostable packaging). Based on this campaign performance data, give 4 to 6 short, specific, actionable insights to increase OPEN RATE and REPLY RATE on the next campaign. Focus on subject-line patterns, timing, and messaging. Be concrete. Data: " + summary + " Return ONLY a JSON array of strings like [" + Q + "insight one" + Q + ", " + Q + "insight two" + Q + "].";
      const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 600, messages: [{ role: "user", content: prompt }] });
      const txt = ((msg.content[0] as any) && (msg.content[0] as any).text) || "";
      const ia = txt.indexOf("["); const ib = txt.lastIndexOf("]");
      insights = JSON.parse(ia >= 0 && ib > ia ? txt.slice(ia, ib + 1) : "[]");
    } catch (e) { insights = []; }
    return NextResponse.json({ overall: { sent: sent, opened: opened, replied: replied, open_rate: openRate, reply_rate: replyRate }, campaigns: campaigns, trend: trend, winners: winners, losers: losers, by_day: byDay, insights: insights });
  }
  if (action === 'remove') {
    if (!customer_id) return NextResponse.json({ error: 'customer_id required' }, { status: 400 });
    const { error } = await supabase
      .from('customer_outreach')
      .update({ sequence_active: false })
      .eq('customer_id', customer_id)
      .eq('sequence_active', true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
