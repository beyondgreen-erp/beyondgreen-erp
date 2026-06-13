import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, SESSION_COOKIE } from "@/lib/brokerAuth";
import { createSupabaseServerClient } from "@/lib/supabase";
import PortalClient from "./PortalClient";

export const dynamic = "force-dynamic";

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

  return <PortalClient />;
}
