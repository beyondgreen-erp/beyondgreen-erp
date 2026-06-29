import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { getOutlookAccessToken, sendViaGraph } from '@/lib/outlook';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Only these users may generate AI drafts. Everyone else is logged and refused.
const AI_ALLOWED = ['rudyp@beyondgreenbiotech.com'];

// Distributors beyondGREEN already supplies — named for credibility when the recipient is NOT itself a distributor.
const DISTRIBUTORS = [
  'Sysco Corporation', 'US Foods', 'Performance Foodservice', 'Gordon Food Service (GFS)',
  'Ben E. Keith Company', 'Shamrock Foods Company', 'Nicholas & Company', 'Bunzl North America',
  'United Natural Foods (UNFI)', 'Vistar', 'Imperial Dade', 'Edward Don & Co', 'SSP America',
];

const APP_URL = 'https://beyondgreen-erp.vercel.app';
const LOGO_URL = `${APP_URL}/email-logo.png`;
const CATALOG_URL = `${APP_URL}/bG-catalog.pdf`;

// Per-user email signatures, appended automatically on send. Keyed by login email (lowercase).
const SIGNATURES: Record<string, { text: string; html: string }> = {
  'rudyp@beyondgreenbiotech.com': {
    text: `Rudy Patel
Chief Business Development Officer
beyondGREEN biotech, Inc.
(866) 364-9466 | (949) 606-4667
rudyp@beyondGREENbiotech.com
1202 E. Wakeham Ave., Santa Ana, CA 92705
beyondgreenbiotech.com`,
    html: `<div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#374151;line-height:1.5">
<div style="margin-bottom:8px"><img src="${LOGO_URL}" alt="beyondGREEN biotech" width="180" style="width:180px;max-width:62%;height:auto;display:block" /></div>
<div style="font-weight:700;color:#1a2e1a">Rudy Patel</div>
<div>Chief Business Development Officer</div>
<div style="font-weight:600;color:#2E7D32">beyondGREEN biotech, Inc.</div>
<div>(866) 364-9466 | (949) 606-4667</div>
<div><a href="mailto:rudyp@beyondGREENbiotech.com" style="color:#2563EB;text-decoration:none">rudyp@beyondGREENbiotech.com</a></div>
<div>1202 E. Wakeham Ave., Santa Ana, CA 92705</div>
<div><a href="https://beyondgreenbiotech.com" style="color:#2563EB;text-decoration:none">beyondgreenbiotech.com</a></div>
</div>`,
  },
};
function signatureFor(email: string): { text: string; html: string } | null {
  return SIGNATURES[(email || '').toLowerCase().trim()] || null;
}

// Send from the user's own ERP login email
function getSenderEmail(userEmail: string): string {
  if (!userEmail) return 'outreach@beyondgreenbiotech.com'
  const email = userEmail.toLowerCase().trim()
  if (email.endsWith('@beyondgreenbiotech.com') || email.endsWith('@byndgrn.com')) return email
  return 'outreach@beyondgreenbiotech.com'
}

function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}

// Map a customer's industry/field to relevant beyondGREEN catalog categories.
function categoriesFor(industry: string): string[] {
  const s = (industry || '').toLowerCase()
  const has = (...k: string[]) => k.some((x) => s.includes(x))
  const out = new Set<string>()
  if (has('restaurant', 'food', 'pizza', 'cafe', 'caterer', 'kitchen', 'hospitality', 'qsr'))
    ['Takeout Containers', 'Cutlery', 'Cups / Lids', 'Drinking Straws', 'Food Paper Products', 'Cup Sleeves'].forEach((c) => out.add(c))
  if (has('coffee', 'roaster', 'tea')) ['Coffee Bags', 'Cups / Lids', 'Cup Sleeves'].forEach((c) => out.add(c))
  if (has('pet')) ['Trash Liners', 'Produce Bags', 'Grocery Bags'].forEach((c) => out.add(c))
  if (has('retail', 'grocery', 'market', 'store')) ['Grocery Bags', 'Produce Bags', 'Paper Bags', 'Trash Liners'].forEach((c) => out.add(c))
  if (has('hoa', 'multi-family', 'property', 'properties', 'facility', 'facilities', 'janitorial'))
    ['Trash Liners', 'Restroom Essentials'].forEach((c) => out.add(c))
  if (has('hygiene', 'hygine', 'restroom', 'cleaning')) ['Restroom Essentials', 'Trash Liners'].forEach((c) => out.add(c))
  if (out.size === 0) ['Paper Bags', 'Takeout Containers', 'Cutlery', 'Trash Liners'].forEach((c) => out.add(c))
  return Array.from(out)
}

// ---- Shared: generate a persuasive AI draft for a customer ----
async function generateDraft(
  cust: any,
  mode: 'initial' | 'followup' = 'initial',
  prior: { subject?: string; body?: string } = {}
): Promise<{ subject: string; body: string; type: string }> {
  const cats = categoriesFor(cust.industry || '');
  const { data: products } = await supabase.from('professional_catalog')
    .select('sku, category, description, material, moq')
    .in('category', cats).not('description', 'is', null).limit(12);
  const catalog = (products || []).map((p: any) => `- [${p.sku}] ${p.description} (${p.category}; ${p.material || ''}${p.moq ? '; MOQ ' + p.moq : ''})`).join('\n');

  const spent = Number(cust.lifetime_spend || 0) > 0;
  const last = cust.last_shipment_date ? new Date(cust.last_shipment_date) : null;
  const dormant = last ? (Date.now() - last.getTime()) / 86400000 > 180 : false;
  const type = mode === 'followup' ? 'follow-up'
    : (cust.pipeline_stage || '').toLowerCase().includes('proposal') ? 'proposal nudge'
    : (spent && dormant) ? 're-engagement'
    : (spent || (cust.customer_status || '').toLowerCase().includes('active')) ? 'new-product cross-sell'
    : 'intro';
  const isDistributor = /distribut/i.test(`${cust.account_type || ''} ${cust.industry || ''}`);

  const system = `You write B2B sales emails for beyondGREEN biotech, a US manufacturer of certified-compostable foodservice and packaging products. Your goal is to make the reader WANT to reply and switch to beyondGREEN.

Weave in the strongest switch arguments (pick the 2-3 most relevant to this customer; do not dump all of them as a list):
- PRICE: we can beat their current pricing on comparable compostable items.
- HYBRID SUPPLY (lead with this when it fits): beyondGREEN both manufactures in the USA and sources offshore. On many SKUs that means a customer can get Made-in-USA product shipping NOW while their offshore order is still in transit — no stockout, no gap in supply.
- Certified compostable, with third-party certifications provided up front.
- Quality, reliability, and private-label capability.

Reference the customer's field and name 2-4 specific products from the list that fit them. Open with the contact's first name if one is given. End with a low-friction call to action (free samples + a pricing comparison, or a quick 15-minute call) and a brief closing like "Best," on its own line.

DISTRIBUTOR RULE: ${isDistributor
    ? 'This recipient IS a distributor — do NOT list other distributors. Focus on margins, fill rates, landed cost, and private-label/house-brand opportunity.'
    : `This recipient is NOT a distributor (they are an operator/brand/retailer/etc.). Include ONE credibility line naming 4-6 (not all) of the major distributors beyondGREEN already supplies, drawn from: ${DISTRIBUTORS.join(', ')}.`}

Keep it 130-200 words, warm and confident, never hype-y or spammy. Do NOT add a sender name, title, contact details, or signature block — a signature is appended automatically.
Return ONLY a JSON object: {"subject": string, "body": string}.`;

  const userMsg = mode === 'followup'
    ? `Write a SHORT, compelling follow-up (3-5 sentences) because ${cust.company_name} hasn't replied to the email below. Add one fresh reason to switch (price or the hybrid US/offshore supply angle). Do not be pushy.\n\nORIGINAL SUBJECT: ${prior.subject || ''}\nORIGINAL BODY:\n${prior.body || ''}`
    : `Campaign type: ${type}.\nCustomer: ${cust.company_name}; contact: ${cust.contact_name || '(none — address generically)'}; field: ${cust.industry || 'unknown'}; account type: ${cust.account_type || 'unknown'}; is distributor: ${isDistributor}; status: ${cust.customer_status || ''}; lifetime spend: $${cust.lifetime_spend || 0}; last shipment: ${cust.last_shipment_date || 'none'}.\n\nChoose 2-4 best-fit products from:\n${catalog}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system,
    messages: [{ role: 'user', content: userMsg }],
  });
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const j = firstJson(raw);
  let subject = (typeof j.subject === 'string' ? j.subject : '').trim();
  const draftBody = (typeof j.body === 'string' ? j.body : '').trim();
  if (mode === 'followup' && prior.subject && !/^re:/i.test(subject)) subject = `Re: ${prior.subject}`;
  return { subject, body: draftBody, type };
}

// ---- Shared: build the email HTML (message + catalog + signature + open-tracking pixel) ----
function buildEmailHtml(emailBody: string, sentBy: string, trackingId?: string): string {
  const sig = signatureFor(sentBy || '');
  const catalogHtml = `<div style="margin-top:16px"><a href="${CATALOG_URL}" style="display:inline-block;background:#2E7D32;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;font-weight:700;padding:10px 18px;border-radius:6px">View our full catalog (PDF)</a></div>`;
  const pixel = trackingId
    ? `<img src="${APP_URL}/api/track/open?id=${trackingId}" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`
    : '';
  return `<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6">${emailBody.replace(/\n/g, '<br>')}</div>${catalogHtml}${sig ? sig.html : ''}${pixel}`;
}

// Resolve the best email for each customer (primary contact, then customer record).
async function emailsForCustomers(customer_ids: string[]) {
  const { data: contacts } = await supabase.from('customer_contacts')
    .select('customer_id, email, is_primary').in('customer_id', customer_ids);
  const map: Record<string, string> = {};
  for (const ct of (contacts || []) as any[]) {
    if (ct.email && (ct.is_primary || !map[ct.customer_id])) map[ct.customer_id] = ct.email;
  }
  return map;
}

function gateAI(sent_by: string): boolean {
  return !!sent_by && AI_ALLOWED.includes(String(sent_by).toLowerCase());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  // ---- AI DRAFT (single, suggestion the user edits before sending) ----
  if (action === 'ai_draft') {
    const { customer_id, sent_by, mode = 'initial', prior_subject = '', prior_body = '' } = body;
    if (!gateAI(sent_by)) {
      await supabase.from('campaign_access_log').insert({ email: sent_by || null, function_name: 'ai_draft', allowed: false, reason: 'not on allow-list', customer_id: customer_id || null });
      return NextResponse.json({ error: 'function logged, please ask your admin for access' }, { status: 403 });
    }
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' }, { status: 400 });
    if (!customer_id) return NextResponse.json({ error: 'customer_id required' }, { status: 400 });

    const { data: cust } = await supabase.from('customers')
      .select('company_name, contact_name, industry, account_type, customer_status, pipeline_stage, lifetime_spend, last_shipment_date')
      .eq('id', customer_id).single();
    if (!cust) return NextResponse.json({ error: 'customer not found' }, { status: 404 });

    try {
      const d = await generateDraft(cust, mode, { subject: prior_subject, body: prior_body });
      if (!d.subject || !d.body) return NextResponse.json({ error: 'AI draft failed' }, { status: 502 });
      await supabase.from('campaign_access_log').insert({ email: sent_by, function_name: 'ai_draft', allowed: true, reason: d.type, customer_id });
      return NextResponse.json({ subject: d.subject, body: d.body, campaign_type: d.type });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message || 'AI draft failed' }, { status: 500 });
    }
  }

  // ---- CAMPAIGN: generate drafts for many customers (NO send — for review) ----
  if (action === 'campaign_generate') {
    const { customer_ids, sent_by } = body;
    if (!gateAI(sent_by)) {
      await supabase.from('campaign_access_log').insert({ email: sent_by || null, function_name: 'campaign_generate', allowed: false, reason: 'not on allow-list' });
      return NextResponse.json({ error: 'function logged, please ask your admin for access' }, { status: 403 });
    }
    if (!Array.isArray(customer_ids) || customer_ids.length === 0) return NextResponse.json({ error: 'customer_ids required' }, { status: 400 });
    // Cap per batch so we stay within the request time budget.
    const ids = customer_ids.slice(0, 12);
    const overflow = customer_ids.length - ids.length;

    const { data: custs } = await supabase.from('customers')
      .select('id, company_name, contact_name, email, industry, account_type, customer_status, pipeline_stage, lifetime_spend, last_shipment_date, probability, do_not_contact')
      .in('id', ids);
    const emailMap = await emailsForCustomers(ids);
    for (const c of (custs || []) as any[]) { if (c.email && !emailMap[c.id]) emailMap[c.id] = c.email; }

    const campaign_id = crypto.randomUUID();
    const drafts: any[] = [];
    let skipped = 0;
    for (const c of (custs || []) as any[]) {
      const to_email = emailMap[c.id];
      if (!to_email || c.do_not_contact) { skipped++; continue; }
      try {
        const d = await generateDraft(c, 'initial');
        if (!d.subject || !d.body) { skipped++; continue; }
        const { data: row } = await supabase.from('customer_outreach').insert({
          customer_id: c.id, sent_by, to_email, status: 'draft',
          subject: d.subject, body: d.body, campaign_id,
          sequence_active: false, sequence_step: 0,
        }).select('id').single();
        // Seed a starting win-probability if none yet.
        const base = (c.customer_status || '').toLowerCase().includes('active') ? 50 : 30;
        if (c.probability == null) await supabase.from('customers').update({ probability: base }).eq('id', c.id);
        drafts.push({
          id: row?.id, customer_id: c.id, company_name: c.company_name,
          contact_name: c.contact_name, to_email, subject: d.subject, body: d.body,
          probability: c.probability ?? base,
        });
      } catch { skipped++; }
    }
    await supabase.from('campaign_access_log').insert({ email: sent_by, function_name: 'campaign_generate', allowed: true, reason: `${drafts.length} drafts` });
    return NextResponse.json({ ok: true, campaign_id, drafts, skipped, overflow });
  }

  // ---- CAMPAIGN: send a reviewed batch NOW (instant), log to customer activity ----
  if (action === 'campaign_send_batch') {
    const { items, sent_by, follow_up_days = 4, max_follow_ups = 5 } = body; // items: [{id, subject, body}]
    if (!gateAI(sent_by)) {
      await supabase.from('campaign_access_log').insert({ email: sent_by || null, function_name: 'campaign_send_batch', allowed: false, reason: 'not on allow-list' });
      return NextResponse.json({ error: 'function logged, please ask your admin for access' }, { status: 403 });
    }
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'items required' }, { status: 400 });

    const token = await getOutlookAccessToken(sent_by || '');
    if (!token) return NextResponse.json({ error: 'Outlook is not connected for this user. Connect Outlook on the Customers page, then try again.' }, { status: 400 });

    const due = new Date(Date.now() + follow_up_days * 86400000).toISOString();
    const results: any[] = [];
    for (const it of items as any[]) {
      try {
        const { data: row } = await supabase.from('customer_outreach')
          .select('id, customer_id, to_email').eq('id', it.id).single();
        if (!row || !row.to_email) { results.push({ id: it.id, ok: false, error: 'missing recipient' }); continue; }
        const subject = (it.subject || '').trim();
        const emailBody = (it.body || '').trim();
        if (!subject || !emailBody) { results.push({ id: it.id, ok: false, error: 'empty subject/body' }); continue; }

        await sendViaGraph(token, { to: row.to_email, subject, html: buildEmailHtml(emailBody, sent_by, row.id) });

        await supabase.from('customer_outreach').update({
          status: 'sent', subject, body: emailBody, sent_at: new Date().toISOString(),
          delivered_via: 'outlook', sequence_active: true, sequence_step: 0,
          follow_up_days, max_follow_ups, follow_up_due: due,
        }).eq('id', row.id);

        // Log on the customer's Activity feed.
        await supabase.from('customer_activity').insert({
          customer_id: row.customer_id, activity_type: 'email', source_type: 'outreach',
          source_id: row.id, source_label: subject, author_email: sent_by,
          content: `Sent campaign email: "${subject}"`,
        }).then(() => {}, () => {});

        results.push({ id: it.id, ok: true });
      } catch (e) {
        results.push({ id: it.id, ok: false, error: (e as Error).message || 'send failed' });
      }
    }
    const sent = results.filter((r) => r.ok).length;
    await supabase.from('campaign_access_log').insert({ email: sent_by, function_name: 'campaign_send_batch', allowed: true, reason: `${sent}/${items.length} sent` });
    return NextResponse.json({ ok: true, sent, total: items.length, results });
  }

  // ---- Discard generated drafts the user chose not to send ----
  if (action === 'campaign_discard') {
    const { ids } = body;
    if (Array.isArray(ids) && ids.length) {
      await supabase.from('customer_outreach').delete().in('id', ids).eq('status', 'draft');
    }
    return NextResponse.json({ ok: true });
  }

  // ---- Single send (used by the per-customer Outreach drawer) ----
  if (action === 'send') {
    const { customer_id, subject, body: emailBody, sent_by, follow_up_days = 7, customer_email } = body;
    const follow_up_due = new Date(Date.now() + follow_up_days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('customer_outreach')
      .insert({ customer_id, subject, body: emailBody, sent_by, follow_up_days, follow_up_due, status: 'sent', to_email: customer_email || null })
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sig = signatureFor(sent_by || '');
    const textBody = `${emailBody}\n\nView our full catalog: ${CATALOG_URL}${sig ? `\n\n${sig.text}` : ''}`;
    const htmlBody = buildEmailHtml(emailBody, sent_by || '', data.id);

    let deliveredVia = 'none';
    if (customer_email) {
      try {
        const gToken = await getOutlookAccessToken(sent_by || '');
        if (gToken) { await sendViaGraph(gToken, { to: customer_email, subject, html: htmlBody }); deliveredVia = 'outlook'; }
      } catch (e) { console.error('Outlook send failed, will try Resend:', e); }
    }
    if (deliveredVia === 'none' && customer_email && process.env.RESEND_API_KEY && !(sent_by && sent_by.toLowerCase().endsWith('@byndgrn.com'))) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail = getSenderEmail(sent_by || '');
        const fromName = fromEmail.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim() || 'beyondGREEN';
        await resend.emails.send({ from: `${fromName} <${fromEmail}>`, to: [customer_email], replyTo: fromEmail, subject, text: textBody, html: htmlBody });
        deliveredVia = 'resend';
      } catch (emailErr) { console.error('Resend error:', emailErr); }
    }
    if (deliveredVia !== 'none') {
      await supabase.from('customer_activity').insert({
        customer_id, activity_type: 'email', source_type: 'outreach', source_id: data.id,
        source_label: subject, author_email: sent_by, content: `Sent email: "${subject}"`,
      }).then(() => {}, () => {});
    }
    await supabase.from('customer_outreach').update({ delivered_via: deliveredVia }).eq('id', data.id);
    return NextResponse.json({ ...data, delivered_via: deliveredVia });
  }

  if (action === 'mark_responded') {
    const { id, response_notes } = body;
    const { data, error } = await supabase
      .from('customer_outreach')
      .update({ response_received: true, response_at: new Date().toISOString(), response_notes, status: 'responded', sequence_active: false })
      .eq('id', id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  if (action === 'approve_followup') {
    const { id } = body;
    const { data, error } = await supabase
      .from('customer_outreach')
      .update({ follow_up_approved: true, follow_up_sent_at: new Date().toISOString(), status: 'follow_up_sent' })
      .eq('id', id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customer_id = searchParams.get('customer_id');
  const pending = searchParams.get('pending_followups');

  if (pending) {
    const { data, error } = await supabase
      .from('customer_outreach')
      .select('*, customers(id,company_name,email)')
      .eq('status', 'sent')
      .lte('follow_up_due', new Date().toISOString())
      .eq('follow_up_approved', false)
      .order('follow_up_due', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (customer_id) {
    const { data, error } = await supabase
      .from('customer_outreach')
      .select('*')
      .eq('customer_id', customer_id)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  return NextResponse.json({ error: 'Missing params' }, { status: 400 });
}
