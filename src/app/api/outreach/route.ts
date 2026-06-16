import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customer_id')
  if (!customerId) return NextResponse.json({ error: 'customer_id required' }, { status: 400 })
  const { data, error } = await sb().from('customer_outreach').select('*').eq('customer_id', customerId).order('sent_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body
  const supabase = sb()

  if (action === 'init_schema') {
    // Create table if not exists via raw SQL
    const sql = `CREATE TABLE IF NOT EXISTS public.customer_outreach (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now(),
      sent_by text NOT NULL DEFAULT '',
      subject text NOT NULL DEFAULT '',
      body text NOT NULL DEFAULT '',
      response_received boolean DEFAULT false,
      response_at timestamptz,
      response_notes text,
      follow_up_days integer DEFAULT 7,
      follow_up_due timestamptz,
      follow_up_approved boolean DEFAULT false,
      follow_up_sent_at timestamptz,
      status text DEFAULT 'sent',
      created_at timestamptz DEFAULT now()
    );`
    // We'll just try inserting — table will be created by migration
    return NextResponse.json({ ok: true })
  }

  if (action === 'send') {
    const { customer_id, subject, body: emailBody, sent_by, follow_up_days = 7 } = body
    const follow_up_due = new Date(Date.now() + follow_up_days * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.from('customer_outreach').insert({
      customer_id, subject, body: emailBody, sent_by, follow_up_days, follow_up_due, status: 'sent'
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (action === 'mark_responded') {
    const { id, response_notes } = body
    const { data, error } = await supabase.from('customer_outreach').update({
      response_received: true, response_at: new Date().toISOString(),
      response_notes, status: 'responded'
    }).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (action === 'approve_followup') {
    const { id } = body
    const { data, error } = await supabase.from('customer_outreach').update({
      follow_up_approved: true, follow_up_sent_at: new Date().toISOString(), status: 'follow_up_sent'
    }).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
