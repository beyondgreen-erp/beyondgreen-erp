// /api/outreach/campaign-runner — the campaign engine.
// Cron hits this every few minutes. It:
//   1) Sends QUEUED initial emails one at a time (from the user's Outlook).
//   2) Sends up to `max_follow_ups` follow-ups on schedule, until the contact replies.
//   3) Watches the user's Outlook inbox for replies — on a reply it stops the
//      sequence, logs the response, and bumps the win-probability score.
// All credentials (Outlook + Anthropic) already live in this app, so nothing extra
// needs configuring. Schedule it from Supabase pg_cron (see migration).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { getOutlookAccessToken, sendViaGraph, inboxHasReplyFrom } from '@/lib/outlook';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Days between sends: initial -> +4d -> FU1 -> +7d -> FU2 -> +14d -> FU3 -> +21d -> FU4 -> +30d -> FU5
const INTERVALS = [4, 7, 14, 21, 30];

const DISTRIBUTORS = [
  'Sysco Corporation', 'US Foods', 'Performance Foodservice', 'Gordon Food Service (GFS)',
  'Ben E. Keith Company', 'Shamrock Foods Company', 'Nicholas & Company', 'Bunzl North America',
  'United Natural Foods (UNFI)', 'Vistar', 'Imperial Dade', 'Edward Don & Co', 'SSP America',
];
const APP_URL = 'https://beyondgreen-erp.vercel.app';
const LOGO_URL = `${APP_URL}/email-logo.png`;
const CATALOG_URL = `${APP_URL}/bG-catalog.pdf`;

const SIG_HTML = `<div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#374151;line-height:1.5">
<div style="margin-bottom:8px"><img src="${LOGO_URL}" alt="beyondGREEN biotech" width="180" style="width:180px;max-width:62%;height:auto;display:block" /></div>
<div style="font-weight:700;color:#1a2e1a">Rudy Patel</div>
<div>Chief Business Development Officer</div>
<div style="font-weight:600;color:#2E7D32">beyondGREEN biotech, Inc.</div>
<div>(866) 364-9466 | (949) 606-4667</div>
<div><a href="mailto:rudyp@beyondGREENbiotech.com" style="color:#2563EB;text-decoration:none">rudyp@beyondGREENbiotech.com</a></div>
<div>1202 E. Wakeham Ave., Santa Ana, CA 92705</div>
<div><a href="https://beyondgreenbiotech.com" style="color:#2563EB;text-decoration:none">beyondgreenbiotech.com</a></div>
</div>`;

function categoriesFor(industry: string): string[] {
  const s = (industry || '').toLowerCase();
  const has = (...k: string[]) => k.some((x) => s.includes(x));
  const out = new Set<string>();
  if (has('restaurant', 'food', 'pizza', 'cafe', 'caterer', 'kitchen', 'hospitality', 'qsr'))
    ['Takeout Containers', 'Cutlery', 'Cups / Lids', 'Drinking Straws', 'Food Paper Products', 'Cup Sleeves'].forEach((c) => out.add(c));
  if (has('coffee', 'roaster', 'tea')) ['Coffee Bags', 'Cups / Lids', 'Cup Sleeves'].forEach((c) => out.add(c));
  if (has('pet')) ['Trash Liners', 'Produce Bags', 'Grocery Bags'].forEach((c) => out.add(c));
  if (has('retail', 'grocery', 'market', 'store')) ['Grocery Bags', 'Produce Bags', 'Paper Bags', 'Trash Liners'].forEach((c) => out.add(c));
  if (has('hoa', 'multi-family', 'property', 'properties', 'facility', 'facilities', 'janitorial'))
    ['Trash Liners', 'Restroom Essentials'].forEach((c) => out.add(c));
  if (has('hygiene', 'hygine', 'restroom', 'cleaning')) ['Restroom Essentials', 'Trash Liners'].forEach((c) => out.add(c));
  if (out.size === 0) ['Paper Bags', 'Takeout Containers', 'Cutlery', 'Trash Liners'].forEach((c) => out.add(c));
  return Array.from(out);
}

function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) return {};
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return {}; }
}

// Build a persuasive AI draft for a customer. step 0 = initial; >=1 = follow-up.
async function draftFor(cust: any, step: number, prior: { subject?: string; body?: string }) {
  const cats = categoriesFor(cust.industry || '');
  const { data: products } = await supabase.from('professional_catalog')
    .select('sku, category, description, material, moq').in('category', cats).not('description', 'is', null).limit(12);
  const catalog = (products || []).map((p: any) => `- [${p.sku}] ${p.description} (${p.category}; ${p.material || ''}${p.moq ? '; MOQ ' + p.moq : ''})`).join('\n');
  const isDistributor = /distribut/i.test(`${cust.account_type || ''} ${cust.industry || ''}`);

  const system = `You write B2B sales emails for beyondGREEN biotech, a US manufacturer of certified-compostable foodservice and packaging products. Your goal is to make the reader WANT to reply and switch to beyondGREEN.

Weave in the strongest switch arguments (pick the 2-3 most relevant; don't dump all of them):
- PRICE: we can beat their current pricing on comparable compostable items.
- HYBRID SUPPLY (lead with this when it fits): beyondGREEN both manufactures in the USA and sources offshore. On many SKUs that means getting Made-in-USA product shipping NOW while their offshore order is still in transit — no stockout, no gap.
- Certified compostable, third-party certifications provided up front.
- Quality, reliability, and private-label capability.

Reference the customer's field and name 2-4 specific products that fit them. End with a low-friction CTA (free samples + a pricing comparison, or a quick 15-min call) and a brief closing like "Best," on its own line.

DISTRIBUTOR RULE: ${isDistributor
    ? 'This recipient IS a distributor — do NOT list other distributors. Focus on margins, fill rates, landed cost, and private-label/house-brand opportunity.'
    : `This recipient is NOT a distributor. Include ONE credibility line naming 4-6 (not all) of the major distributors beyondGREEN already supplies, drawn from: ${DISTRIBUTORS.join(', ')}.`}

Keep it 130-200 words, warm and confident, never hype-y. Do NOT add a sender name, title, contact details, or signature block — a signature is appended automatically.
Return ONLY a JSON object: {"subject": string, "body": string}.`;

  const userMsg = step >= 1
    ? `Write a SHORT, compelling follow-up #${step} (3-5 sentences) because ${cust.company_name} hasn't replied. Add one fresh reason to switch (price or the hybrid US/offshore supply angle). Not pushy. Keep the same subject thread.\n\nPREVIOUS SUBJECT: ${prior.subject || ''}\nPREVIOUS BODY:\n${prior.body || ''}`
    : `Customer: ${cust.company_name}; contact: ${cust.contact_name || '(none — address generically)'}; field: ${cust.industry || 'unknown'}; account type: ${cust.account_type || 'unknown'}; is distributor: ${isDistributor}; status: ${cust.customer_status || ''}.\n\nChoose 2-4 best-fit products from:\n${catalog}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system,
    messages: [{ role: 'user', content: userMsg }],
  });
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const j = firstJson(raw);
  let subject = (typeof j.subject === 'string' ? j.subject : '').trim();
  const draftBody = (typeof j.body === 'string' ? j.body : '').trim();
  if (step >= 1 && prior.subject && !/^re:/i.test(subject)) subject = `Re: ${prior.subject}`;
  return { subject, body: draftBody };
}

function buildHtml(bodyText: string, trackingId?: string): string {
  const catalogHtml = `<div style="margin-top:16px"><a href="${CATALOG_URL}" style="display:inline-block;background:#2E7D32;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;font-weight:700;padding:10px 18px;border-radius:6px">View our full catalog (PDF)</a></div>`;
  const pixel = trackingId ? `<img src="${APP_URL}/api/track/open?id=${trackingId}" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />` : '';
  return `<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6">${bodyText.replace(/\n/g, '<br>')}</div>${catalogHtml}${SIG_HTML}${pixel}`;
}

async function setProbability(customer_id: string, value: number) {
  await supabase.from('customers').update({ probability: Math.max(0, Math.min(100, value)) }).eq('id', customer_id);
}
async function bumpProbability(customer_id: string, delta: number) {
  const { data } = await supabase.from('customers').select('probability').eq('id', customer_id).single();
  const cur = Number(data?.probability ?? 30);
  await setProbability(customer_id, cur + delta);
}

export async function GET(req: NextRequest) {
  // Light protection: if CRON_SECRET is set, require it.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = req.nextUrl.searchParams.get('key') || req.headers.get('x-cron-key');
    if (got !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = { initials_sent: 0, followups_sent: 0, replies_found: 0, stopped: 0, errors: [] as string[] };
  const now = Date.now();

  // ---------- 1) REPLY DETECTION: stop sequences + score, for active rows ----------
  const { data: active } = await supabase.from('customer_outreach')
    .select('id, customer_id, sent_by, to_email, sent_at, created_at, subject, body, sequence_step')
    .eq('sequence_active', true).eq('status', 'sent').eq('response_received', false)
    .not('to_email', 'is', null).limit(15);

  for (const row of (active || []) as any[]) {
    try {
      const token = await getOutlookAccessToken(row.sent_by || '');
      if (!token) continue;
      const since = new Date(row.sent_at || row.created_at || Date.now() - 86400000).toISOString();
      const replied = await inboxHasReplyFrom(token, row.to_email, since);
      if (replied) {
        await supabase.from('customer_outreach').update({
          response_received: true, response_at: new Date().toISOString(),
          status: 'responded', sequence_active: false,
        }).eq('id', row.id);
        await setProbability(row.customer_id, 80); // replied = strong signal
        await supabase.from('customer_activity').insert({
          customer_id: row.customer_id, activity_type: 'email_reply', source_type: 'outreach',
          source_id: row.id, source_label: row.subject, author_email: row.sent_by,
          content: `Replied to: "${row.subject}"`,
        }).then(() => {}, () => {});
        await supabase.from('campaign_access_log').insert({
          email: row.sent_by, function_name: 'campaign_reply', allowed: true, reason: 'reply detected', customer_id: row.customer_id,
        }).then(() => {}, () => {});
        result.replies_found++;
      }
    } catch (e) { result.errors.push(`reply ${row.id}: ${(e as Error).message}`); }
  }

  // ---------- 2) SEND QUEUED INITIALS (one at a time, a few per run) ----------
  const { data: queued } = await supabase.from('customer_outreach')
    .select('id, customer_id, sent_by, to_email, follow_up_days')
    .eq('status', 'queued').eq('sequence_active', true).not('to_email', 'is', null)
    .order('created_at', { ascending: true }).limit(5);

  for (const row of (queued || []) as any[]) {
    try {
      const { data: cust } = await supabase.from('customers')
        .select('id, company_name, contact_name, industry, account_type, customer_status, do_not_contact')
        .eq('id', row.customer_id).single();
      if (!cust || cust.do_not_contact) {
        await supabase.from('customer_outreach').update({ status: 'skipped', sequence_active: false }).eq('id', row.id);
        continue;
      }
      const token = await getOutlookAccessToken(row.sent_by || '');
      if (!token) { result.errors.push(`no Outlook token for ${row.sent_by}`); continue; }

      const draft = await draftFor(cust, 0, {});
      if (!draft.subject || !draft.body) { result.errors.push(`draft failed cust ${row.customer_id}`); continue; }
      await sendViaGraph(token, { to: row.to_email, subject: draft.subject, html: buildHtml(draft.body, row.id) });

      const dueIso = new Date(now + (INTERVALS[0]) * 86400000).toISOString();
      await supabase.from('customer_outreach').update({
        status: 'sent', subject: draft.subject, body: draft.body, sequence_step: 0,
        sent_at: new Date().toISOString(), follow_up_due: dueIso, delivered_via: 'outlook',
      }).eq('id', row.id);
      result.initials_sent++;
    } catch (e) { result.errors.push(`initial ${row.id}: ${(e as Error).message}`); }
  }

  // ---------- 3) SEND DUE FOLLOW-UPS (until reply or max) ----------
  const { data: dueRows } = await supabase.from('customer_outreach')
    .select('id, customer_id, sent_by, to_email, subject, body, sequence_step, max_follow_ups, campaign_id')
    .eq('status', 'sent').eq('sequence_active', true).eq('response_received', false)
    .not('follow_up_due', 'is', null).lte('follow_up_due', new Date().toISOString())
    .not('to_email', 'is', null).order('follow_up_due', { ascending: true }).limit(5);

  for (const row of (dueRows || []) as any[]) {
    try {
      const nextStep = (row.sequence_step || 0) + 1;
      const maxF = row.max_follow_ups || 5;
      if (nextStep > maxF) {
        await supabase.from('customer_outreach').update({ sequence_active: false }).eq('id', row.id);
        result.stopped++; continue;
      }
      const { data: cust } = await supabase.from('customers')
        .select('id, company_name, contact_name, industry, account_type, customer_status, do_not_contact')
        .eq('id', row.customer_id).single();
      if (!cust || cust.do_not_contact) {
        await supabase.from('customer_outreach').update({ sequence_active: false }).eq('id', row.id);
        result.stopped++; continue;
      }
      const token = await getOutlookAccessToken(row.sent_by || '');
      if (!token) { result.errors.push(`no Outlook token for ${row.sent_by}`); continue; }

      const draft = await draftFor(cust, nextStep, { subject: row.subject, body: row.body });
      if (!draft.subject || !draft.body) { result.errors.push(`fu draft failed ${row.id}`); continue; }

      // Create the follow-up history row FIRST so we can track opens against it.
      const { data: child } = await supabase.from('customer_outreach').insert({
        customer_id: row.customer_id, sent_by: row.sent_by, to_email: row.to_email,
        subject: draft.subject, body: draft.body, status: 'sent', kind: 'followup',
        parent_outreach_id: row.id, sequence_step: nextStep, campaign_id: row.campaign_id,
        delivered_via: 'outlook', sent_at: new Date().toISOString(),
      }).select('id').single();

      await sendViaGraph(token, { to: row.to_email, subject: draft.subject, html: buildHtml(draft.body, child?.id) });

      // Log on the customer's Activity feed.
      await supabase.from('customer_activity').insert({
        customer_id: row.customer_id, activity_type: 'email', source_type: 'outreach',
        source_id: child?.id || row.id, source_label: draft.subject, author_email: row.sent_by,
        content: `Sent follow-up #${nextStep}: "${draft.subject}"`,
      }).then(() => {}, () => {});

      const nextDue = nextStep < maxF ? new Date(now + (INTERVALS[Math.min(nextStep, INTERVALS.length - 1)]) * 86400000).toISOString() : null;
      await supabase.from('customer_outreach').update({
        sequence_step: nextStep, follow_up_due: nextDue, sequence_active: nextStep < maxF,
      }).eq('id', row.id);
      await bumpProbability(row.customer_id, -5); // ignored another nudge -> lower odds
      result.followups_sent++;
    } catch (e) { result.errors.push(`followup ${row.id}: ${(e as Error).message}`); }
  }

  return NextResponse.json({ ok: true, ...result });
}
