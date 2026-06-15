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
export async function GET(req: Request) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const hp = await verifyToken(token, process.env.BROKER_PORTAL_SECRET || '');
  let he = false;
  try { const s = await createSupabaseServerClient(); const { data: { user } } = await s.auth.getUser(); he = !!user; } catch { /* noop */ }
  if (!hp && !he) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ids = new URL(req.url).searchParams.get('ids');
  const admin = createSupabaseAdminClient();
  let q = admin.from('professional_catalog').select('sku,category,description,variation,upc,origin,material,hts,qty_case,case_dims,moq,sell_price,win_likelihood').order('category').order('sku');
  if (ids) q = q.in('id', ids.split(','));
  const { data } = await q;
  const rows = (data || []) as Record<string, unknown>[];
  const header = ['SKU','Category','Product Description','Variation','UPC','Origin','Material','HTS Code','Qty/Case','Case Dimensions','MOQ','Quote Price/Case','Win Likelihood'];
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const lines = [
    'beyondGREEN Biotech Inc. - Confidential Price Quote',
    'Generated: ' + date,
    'Prices in USD. Valid 30 days from date of issue.',
    '',
    '',
    header.join(','),
  ];
  for (const r of rows) {
    const price = r.sell_price ? '$' + Number(r.sell_price).toFixed(2) : 'Contact us';
    lines.push([r.sku,r.category,r.description,r.variation,r.upc,r.origin,r.material,r.hts,r.qty_case,r.case_dims,r.moq,price,r.win_likelihood].map(esc).join(','));
  }
  lines.push('');
  lines.push('beyondGREEN Biotech Inc. | 1202 E. Wakeham Ave, Santa Ana, CA 92705 | Certified Compostable Packaging');
  const csv = lines.join('\n');
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="beyondGREEN_Price_Quote_' + today + '.csv"',
    },
  });
}
