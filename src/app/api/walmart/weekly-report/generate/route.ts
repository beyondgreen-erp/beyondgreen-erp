import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isResp } from '../_auth'
import { generateReport, loadAssets, inlineHtml } from '@/lib/walmartWeekly/service'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const a = await requireUser(); if (isResp(a)) return a
  try {
    const body = await req.json()
    const reportDate = String(body.reportDate || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return NextResponse.json({ error: 'Pick a report date.' }, { status: 400 })
    const row = await generateReport(a.admin, reportDate, { reportDate, notes: body.notes || {}, openingPosition: body.openingPosition || undefined, priorReportDate: body.priorReportDate || undefined, manualOrders: body.manualOrders || undefined }, a.email, body.id || undefined)
    const assets = await loadAssets(a.admin, row)
    return NextResponse.json({ report: { ...row, html: undefined }, preview: inlineHtml(row.html || '', assets.charts) })
  } catch (e) {
    console.error('[walmart weekly] generate', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
