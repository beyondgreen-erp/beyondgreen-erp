import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { createSupabaseServerClient } from '@/lib/supabase';
import { verifyToken, SESSION_COOKIE } from '@/lib/brokerAuth';
import { cookies } from 'next/headers';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const hp = await verifyToken(token, process.env.BROKER_PORTAL_SECRET || '');
  let he = false;
  try { const s = await createSupabaseServerClient(); const { data: { user } } = await s.auth.getUser(); he = !!user; } catch { /* noop */ }
  if (!hp && !he) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json() as Record<string, unknown>;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('professional_catalog').update({
    confirmed_at: new Date().toISOString(),
    confirmed_by: (b.confirmed_by as string) || 'ERP',
    supplier_name: b.supplier_name,
    supplier_quote_date: b.supplier_quote_date,
    sell_price: b.sell_price,
    margin_pct: b.margin_pct,
    notes_internal: b.notes_internal,
    updated_at: new Date().toISOString()
  }).eq('id', b.id as string);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
