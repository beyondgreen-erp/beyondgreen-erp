import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, SESSION_COOKIE } from "@/lib/brokerAuth";
import { createSupabaseServerClient } from "@/lib/supabase";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import PortalClient from "./PortalClient";
import type { Row } from "./EditDrawer";

export const dynamic = "force-dynamic";

const COLS: [string, string][] = [
  ["sku", "sku"], ["category", "category"], ["description", "description"], ["upc", "upc"],
  ["variation", "variation"], ["qty_case", "qtyCase"], ["case_gross_wt", "caseGrossWt"],
  ["case_dims", "caseDims"], ["case_cu_ft", "caseCuFt"], ["cases_pallet", "casesPallet"],
  ["pallet_net_wt", "palletNetWt"], ["pallet_ht", "palletHt"], ["material", "material"],
  ["hts", "hts"], ["duty_cat", "dutyCat"], ["adcvd_scope", "adcvdScope"], ["origin", "origin"],
  ["mfg_type", "mfgType"], ["fob", "fob"], ["landed", "landed"], ["landed_unit", "landedUnit"],
  ["win_likelihood", "winLikelihood"], ["moq", "moq"], ["notes", "notes"],
];

function mapRow(r: Record<string, unknown>): Row {
  const o: Record<string, unknown> = { id: r.id };
  for (const [col, key] of COLS) o[key] = r[col] ?? null;
  return o as unknown as Row;
}

export default async function ProfessionalPortalPage() {
  // Access if EITHER a valid ERP (Supabase) session OR the Professional password session.
  const token = cookies().get(SESSION_COOKIE)?.value;
  const hasPassword = await verifyToken(token, process.env.BROKER_PORTAL_SECRET || "");

  let hasErp = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    hasErp = !!user;
  } catch {
    hasErp = false;
  }

  if (!hasPassword && !hasErp) redirect("/broker-portal/login");

  // Read the catalog server-side with the service-role key (bypasses RLS),
  // only after the session is verified. The public/anon key cannot read this table.
  let initialItems: Row[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("professional_catalog")
      .select("*")
      .order("category")
      .order("sku");
    initialItems = (data || []).map(mapRow);
  } catch {
    initialItems = [];
  }

  return <PortalClient initialItems={initialItems} />;
}
