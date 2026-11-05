import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isResp } from '../_auth'
import { loadSettings } from '@/lib/walmartWeekly/data'
import { buildEml, loadAssets, inlineHtml, ReportRow } from '@/lib/walmartWeekly/service'
export const dynamic = 'force-dynamic'

// Downloads: ?id=&kind=xlsx | eml | html
export async function GET(req: NextRequest) {
  const a = await requireUser(); if (isResp(a)) return a
  const id = req.nextUrl.searchParams.get('id') || ''
  const kind = req.nextUrl.searchParams.get('kind') || 'xlsx'
  const { data: row } = await a.admin.from('wm_weekly_reports').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
  const r = row as ReportRow
  const base = `bG_Weekly_Update_WK${r.wm_week}_${r.report_date}`
  try {
    if (kind === 'xlsx') {
      const { xlsx, xlsxName } = await loadAssets(a.admin, r)
      return new NextResponse(new Uint8Array(xlsx), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${xlsxName}"` } })
    }
    if (kind === 'eml') {
      const settings = await loadSettings(a.admin)
      const eml = await buildEml(a.admin, r, settings, `Rudy Patel <${a.email}>`)
      return new NextResponse(new Uint8Array(eml), { headers: { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="${base}.eml"` } })
    }
    const { charts } = await loadAssets(a.admin, r)
    return new NextResponse(inlineHtml(r.html || '', charts), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.html"` } })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
