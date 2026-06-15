import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { createSupabaseServerClient } from '@/lib/supabase';
import { verifyToken, SESSION_COOKIE } from '@/lib/brokerAuth';
import { cookies } from 'next/headers';
export const dynamic = 'force-dynamic';
function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const hp = await verifyToken(token, process.env.BROKER_PORTAL_SECRET || '');
  let he = false;
  try { const s = await createSupabaseServerClient(); const { data: { user } } = await s.auth.getUser(); he = !!user; } catch { /* noop */ }
  if (!hp && !he) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('professional_catalog').select('*').order('category').order('sku');
  const rows = (data || []) as Record<string, unknown>[];
  const header = ['SKU','Category','Description','Variation','UPC','Origin','Mfg Type','Material','HTS','Duty Cat','AD/CVD Scope','FOB','Landed/Case','Landed/Unit','Qty/Case','Case Gross Wt','Case Dims','Case CuFt','Cases/Pallet','Pallet Net Wt','Pallet Ht','Win Likelihood','MOQ','Supplier','Quote Date','Live Duty Rate','Live AD/CVD','Sell Price','Margin %','Internal Notes','Confirmed At','Confirmed By','Notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.sku,r.category,r.description,r.variation,r.upc,r.origin,r.mfg_type,r.material,r.hts,r.duty_cat,r.adcvd_scope,r.fob,r.landed,r.landed_unit,r.qty_case,r.case_gross_wt,r.case_dims,r.case_cu_ft,r.cases_pallet,r.pallet_net_wt,r.pallet_ht,r.win_likelihood,r.moq,r.supplier_name,r.supplier_quote_date,r.live_duty_rate,r.live_adcvd_rate,r.sell_price,r.margin_pct,r.notes_internal,r.confirmed_at,r.confirmed_by,r.notes].map(esc).join(','));
  }
  const csv = lines.join('\n');
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="beyondGREEN_Internal_Costing_' + today + '.csv"',
    },
  });
}
