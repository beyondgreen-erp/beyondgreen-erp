import { NextRequest, NextResponse } from 'next/server'

// Server-side check so the reveal password never appears in the client bundle.
const REVEAL_PASSWORD = '7upy298@rP15'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { password?: string }
  const ok = typeof body.password === 'string' && body.password === REVEAL_PASSWORD
  return NextResponse.json({ ok })
}
