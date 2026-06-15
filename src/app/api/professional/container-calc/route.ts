import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const { l_cm, w_cm, h_cm, gross_wt_kg, cases_per_pallet, freight_per_cbm, origin_port, dest_port } = await req.json();
  const l = Number(l_cm); const w = Number(w_cm); const h = Number(h_cm);
  const case_cbm = (l/100)*(w/100)*(h/100);
  type CSpec = { cbm: number; max_kg: number };
  const containers: Record<string, CSpec> = { '20ft': { cbm:25.4, max_kg:21700 }, '40ft': { cbm:55.8, max_kg:26500 }, '40hq': { cbm:72.7, max_kg:26500 } };
  const results: Record<string,unknown> = {};
  for (const [name, c] of Object.entries(containers)) {
    const by_vol = Math.floor(c.cbm / case_cbm);
    const by_wt = gross_wt_kg ? Math.floor(c.max_kg / Number(gross_wt_kg)) : by_vol;
    const cases = Math.min(by_vol, by_wt);
    const pallets = cases_per_pallet ? Math.ceil(cases / Number(cases_per_pallet)) : null;
    const total_cbm = parseFloat((cases * case_cbm).toFixed(3));
    const utilization = parseFloat(((total_cbm / c.cbm)*100).toFixed(1));
    const freight_est = freight_per_cbm ? parseFloat((total_cbm * Number(freight_per_cbm)).toFixed(2)) : null;
    results[name] = { cases, pallets, total_cbm, utilization, freight_est, container_cbm: c.cbm };
  }
  return NextResponse.json({ case_cbm: parseFloat(case_cbm.toFixed(5)), containers: results, origin_port, dest_port, note: 'Freight est requires freight_per_cbm input. Volume specs per FIATA/ISO 668.' });
}
