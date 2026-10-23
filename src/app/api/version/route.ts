import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Which deployment is live — open tabs compare this to the build they are running and refresh when it changes. */
export async function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || ''
  return NextResponse.json({ v }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
