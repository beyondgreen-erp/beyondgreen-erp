// POST /api/professional/login  { password }  -> sets signed session cookie
import { NextRequest, NextResponse } from "next/server";
import { createToken, SESSION_COOKIE } from "@/lib/brokerAuth";

export async function POST(req: NextRequest) {
  const secret = process.env.BROKER_PORTAL_SECRET;
  const expected = process.env.BROKER_PORTAL_PASSWORD;
  if (!secret || !expected) {
    return NextResponse.json(
      { error: "Portal not configured. Set BROKER_PORTAL_PASSWORD and BROKER_PORTAL_SECRET." },
      { status: 500 }
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Constant-time-ish compare.
  const given = body.password ?? "";
  if (given.length !== expected.length || given !== expected) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await createToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
