import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isResp } from '../_auth'
import { loadSettings } from '@/lib/walmartWeekly/data'
import { loadAssets, sendViaGraphWithAttachments, ReportRow } from '@/lib/walmartWeekly/service'
import { getOutlookAccessToken } from '@/lib/outlook'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Sends the generated email from the signed-in user's connected Outlook mailbox.
export async function POST(req: NextRequest) {
  const a = await requireUser(); if (isResp(a)) return a
  try {
    const { id, to, cc } = await req.json()
    const { data: row } = await a.admin.from('wm_weekly_reports').select('*').eq('id', id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    const token = await getOutlookAccessToken(a.email)
    if (!token) return NextResponse.json({ error: `Your Outlook mailbox (${a.email}) is not connected to the ERP. Connect it under Settings, then try again.` }, { status: 400 })
    const settings = await loadSettings(a.admin)
    const assets = await loadAssets(a.admin, row as ReportRow)
    const rec = { to: Array.isArray(to) && to.length ? to : settings.recipients.to, cc: Array.isArray(cc) ? cc : settings.recipients.cc }
    await sendViaGraphWithAttachments(token, row as ReportRow, settings, assets, rec)
    await a.admin.from('wm_weekly_reports').update({ status: 'sent', sent_at: new Date().toISOString(), sent_to: rec }).eq('id', id)
    return NextResponse.json({ ok: true, sentTo: rec })
  } catch (e) {
    console.error('[walmart weekly] send', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
