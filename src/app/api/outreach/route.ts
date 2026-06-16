import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Send from the user's own ERP login email
function getSenderEmail(userEmail: string): string {
  if (!userEmail) return 'outreach@beyondgreenbiotech.com'
  const email = userEmail.toLowerCase().trim()
  // ERP accounts on either company domain - use directly
  if (email.endsWith('@beyondgreenbiotech.com') || email.endsWith('@byndgrn.com')) return email
  // Unknown/external login - fall back to generic outreach address
  return 'outreach@beyondgreenbiotech.com'
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === 'send') {
    const { customer_id, subject, body: emailBody, sent_by, follow_up_days = 7, customer_email, company_name } = body;
    const follow_up_due = new Date(Date.now() + follow_up_days * 24 * 60 * 60 * 1000).toISOString();

    // 1. Log to DB first
    const { data, error } = await supabase
      .from('customer_outreach')
      .insert({ customer_id, subject, body: emailBody, sent_by, follow_up_days, follow_up_due, status: 'sent' })
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // 2. Send actual email via Resend (if API key set and customer has email)
    if (process.env.RESEND_API_KEY && customer_email) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail = getSenderEmail(sent_by || '');
        const fromName = fromEmail.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim() || 'beyondGREEN';
        await resend.emails.send({
          from: `${fromName} <${fromEmail}>`,
          to: [customer_email],
          replyTo: fromEmail,
          subject: subject,
          text: emailBody,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6">${emailBody.replace(/\n/g, '<br>')}</div>`,
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
