// POST /api/professional/logout -> clears session cookie
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/brokerAuth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
