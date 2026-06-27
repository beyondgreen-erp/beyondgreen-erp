import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Only these users may generate AI drafts. Everyone else is logged and refused.
const AI_ALLOWED = ['rudyp@beyondgreenbiotech.com'];

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
    html: `<div style="margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#374151;line-height:1.5">
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
  // ERP accounts on either company domain - use directly
  if (email.endsWith('@beyondgreenbiotech.com') || email.endsWith('@byndgrn.com')) return email
  // Unknown/external login - fall back to generic outreach address
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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  // ---- AI DRAFT (suggestion the user edits before sending) ----
  if (action === 'ai_draft') {
    const { customer_id, sent_by, mode = 'initial', prior_subject = '', prior_body = '' } = body;

    // Access gate: only allowed users; others are logged and refused.
    if (!sent_by || !AI_ALLOWED.includes(String(sent_by).toLowerCase())) {
      await supabase.from('campaign_access_log').insert({
        email: sent_by || null, function_name: 'ai_draft', allowed: false, reason: 'not on allow-list', customer_id: customer_id || null,
      });
      return NextResponse.json({ error: 'function logged, please ask your admin for access' }, { status: 403 });
    }
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' }, { status: 400 });
    if (!customer_id) return NextResponse.json({ error: 'customer_id required' }, { status: 400 });

    const { data: cust } = await supabase.from('customers')
      .select('company_name, contact_name, industry, account_type, customer_status, pipeline_stage, lifetime_spend, last_shipment_date')
      .eq('id', customer_id).single();
    if (!cust) return NextResponse.json({ error: 'customer not found' }, { status: 404 });

    const cats = categoriesFor(cust.industry || '');
    const { data: products } = await supabase.from('professional_catalog')
      .select('sku, category, description, material, moq')
      .in('category', cats).not('description', 'is', null).limit(12);

    const spent = Number(cust.lifetime_spend || 0) > 0;
    const last = cust.last_shipment_date ? new Date(cust.last_shipment_date) : null;
    const dormant = last ? (Date.now() - last.getTime()) / 86400000 > 180 : false;
    const type = mode === 'followup' ? 'follow-up'
      : (cust.pipeline_stage || '').toLowerCase().includes('proposal') ? 'proposal nudge'
      : (spent && dormant) ? 're-engagement'
      : (spent || (cust.customer_status || '').toLowerCase().includes('active')) ? 'new-product cross-sell'
      : 'intro';

    const catalog = (products || []).map((p: any) => `- [${p.sku}] ${p.description} (${p.category}; ${p.material || ''}${p.moq ? '; MOQ ' + p.moq : ''})`).join('\n');

    const system = `You write B2B sales emails for beyondGREEN, a manufacturer of certified-compostable foodservice and packaging products. Keep it warm, concise (120-180 words), specific, and not hype-y. Reference the customer's field, name 2-4 chosen products, and end with a low-friction call to action (samples or a quick call) followed by a brief closing like "Best," on its own line. Do NOT add a sender name, title, contact details, or signature block — a signature is appended automatically.
Return ONLY a JSON object: {"subject": string, "body": string}.`;

    const userMsg = mode === 'followup'
      ? `Write a SHORT follow-up (3-4 sentences) because ${cust.company_name} hasn't replied to the email below. Do not be pushy.\n\nORIGINAL SUBJECT: ${prior_subject}\nORIGINAL BODY:\n${prior_body}`
      : `Campaign type: ${type}.\nCustomer: ${cust.company_name}; contact: ${cust.contact_name || '(none — address generically)'}; field: ${cust.industry || 'unknown'}; status: ${cust.customer_status || ''}; lifetime spend: $${cust.lifetime_spend || 0}; last shipment: ${cust.last_shipment_date || 'none'}.\n\nChoose 2-4 best-fit products from:\n${catalog}`;

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system,
        messages: [{ role: 'user', content: userMsg }],
      });
      const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
      const j = firstJson(raw);
      const subject = (typeof j.subject === 'string' ? j.subject : '').trim();
      const draftBody = (typeof j.body === 'string' ? j.body : '').trim();
      if (!subject || !draftBody) return NextResponse.json({ error: 'AI draft failed' }, { status: 502 });
      await supabase.from('campaign_access_log').insert({ email: sent_by, function_name: 'ai_draft', allowed: true, reason: type, customer_id });
      return NextResponse.json({ subject, body: draftBody, campaign_type: type });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message || 'AI draft failed' }, { status: 500 });
    }
  }

  if (action === 'send') {
    const { customer_id, subject, body: emailBody, sent_by, follow_up_days = 7, customer_email, company_name } = body;
    const follow_up_due = new Date(Date.now() + follow_up_days * 24 * 60 * 60 * 1000).toISOString();

    // 1. Log to DB first
    const { data, error } = await supabase
      .from('customer_outreach')
      .insert({ customer_id, subject, body: emailBody, sent_by, follow_up_days, follow_up_due, status: 'sent' })
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Block byndgrn.com users from outbound email (domain not verified in Resend)
    if (sent_by && sent_by.toLowerCase().endsWith('@byndgrn.com')) {
      return NextResponse.json({ error: 'Outbound email not available for byndgrn.com accounts' }, { status: 403 })
    }

    // 2. Send actual email via Resend (if API key set and customer has email)
    if (process.env.RESEND_API_KEY && customer_email) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail = getSenderEmail(sent_by || '');
        const fromName = fromEmail.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim() || 'beyondGREEN';
        // Append the sender's signature (text + HTML) automatically.
        const sig = signatureFor(sent_by || '');
        const textBody = sig ? `${emailBody}\n\n${sig.text}` : emailBody;
        const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6">${emailBody.replace(/\n/g, '<br>')}</div>${sig ? sig.html : ''}`;
        await resend.emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: [customer_email],
          replyTo: fromEmail,
          subject: subject,
          text: textBody,
          html: htmlBody,
        });
      } catch (emailErr) {
        console.error('Resend error:', emailErr);
        // Don't fail the request — log was saved, email delivery failed
      }
    }

    return NextResponse.json(data);
  }

  if (action === 'mark_responded') {
    const { id, response_notes } = body;
    const { data, error } = await supabase
      .from('customer_outreach')
      .update({ response_received: true, response_at: new Date().toISOString(), response_notes, status: 'responded' })
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
