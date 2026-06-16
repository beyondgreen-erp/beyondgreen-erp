"use server";
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export async function POST(req: NextRequest) {
  const { customer_id, sent_by, subject, email_body, follow_up_days } = await req.json();
  if (!customer_id || !subject || !email_body) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const due = follow_up_days ? new Date(Date.now() + (follow_up_days||7) * 86400000).toISOString() : null;
  const { data, error } = await sb().from('customer_outreach_log').insert({ customer_id, sent_by: sent_by||'ERP', subject, body: email_body, follow_up_days: follow_up_days||7, follow_up_due_at: due }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const cid = sp.get('customer_id'), pf = sp.get('pending_followups');
  if (pf) {
    const { data, error } = await sb().from('customer_outreach_log').select('*, customers(id,company_name,email)').eq('follow_up_sent',false).eq('follow_up_approved',false).lte('follow_up_due_at', new Date().toISOString()).order('follow_up_due_at');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }
  if (cid) {
    const { data, error } = await sb().from('customer_outreach_log').select('*').eq('customer_id', cid).order('sent_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }
  return NextResponse.json({ error: 'Missing params' }, { status: 400 });
}
export async function PATCH(req: NextRequest) {
  const { id, response_received, response_notes, approve_followup } = await req.json();
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const u: Record<string,unknown> = {};
  if (response_received !== undefined) { u.response_received = response_received; u.response_at = new Date().toISOString(); if (response_notes) u.response_notes = response_notes; }
  if (approve_followup) { u.follow_up_approved = true; u.follow_up_sent = true; }
  const { error } = await sb().from('customer_outreach_log').update(u).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
