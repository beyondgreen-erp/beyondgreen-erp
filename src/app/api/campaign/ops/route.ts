import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  const { action, customer_id } = body;
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
