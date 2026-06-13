import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, SESSION_COOKIE } from "@/lib/brokerAuth";
import PortalClient from "./PortalClient";

export const dynamic = "force-dynamic";

export default async function BrokerPortalPage() {
  // Defense in depth: middleware guards too, but re-verify on the server.
  const token = cookies().get(SESSION_COOKIE)?.value;
  const ok = await verifyToken(token, process.env.BROKER_PORTAL_SECRET || "");
  if (!ok) redirect("/broker-portal/login");

  return <PortalClient />;
}
