import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const hts = new URL(req.url).searchParams.get('hts') || '';
  try {
    const r = await fetch('https://api.usitc.gov/getHtsByNumber?htsnumber=' + encodeURIComponent(hts.replace(/[^0-9]/g,'').slice(0,10)));
    const txt = await r.text();
    const match = txt.match(/General Rate of Duty.*?<([^>]+)>([^<]+)/i);
    const rate = match ? match[2].trim() : null;
    if (rate && hts) {
      const admin = createSupabaseAdminClient();
      await admin.from('professional_catalog').update({ live_duty_rate: parseFloat(rate) || null, live_duty_fetched_at: new Date().toISOString() }).eq('hts', hts);
    }
    return NextResponse.json({ hts, rate, source: 'USITC', fetched_at: new Date().toISOString() });
  } catch(e: unknown) {
    return NextResponse.json({ hts, rate: null, error: String(e) });
  }
}
