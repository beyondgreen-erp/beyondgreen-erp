import { NextResponse } from 'next/server'
import { requireUser, isResp } from './_auth'
import { loadSettings, loadForecast } from '@/lib/walmartWeekly/data'
import { defaultReportDate } from '@/lib/walmartWeekly/service'
export const dynamic = 'force-dynamic'

// Overview for the tab: settings, the current forecast batch, PO history coverage and past runs.
export async function GET() {
  const a = await requireUser(); if (isResp(a)) return a
  const sb = a.admin
  const [settings, forecast, { data: reports }, { data: hist }, { data: prodLast }] = await Promise.all([
    loadSettings(sb), loadForecast(sb),
    sb.from('wm_weekly_reports').select('id, report_date, wm_week, status, subject, created_by, created_at, sent_at, sent_to, inputs, xlsx_path').order('report_date', { ascending: false }).limit(30),
    sb.from('wm_po_history').select('order_date, updated_at').order('order_date', { ascending: false }).limit(1),
    sb.from('walmart_production_entries').select('production_date').is('voided_at', null).order('production_date', { ascending: false }).limit(1),
  ])
  const { count } = await sb.from('wm_po_history').select('po_number', { count: 'exact', head: true })
  return NextResponse.json({
    settings, defaultReportDate: defaultReportDate(),
    forecast: forecast ? { id: forecast.id, name: forecast.name, runDate: forecast.forecast_run_date, rows: forecast.rows.length, plan: forecast.plan, manual: forecast.manual, first: forecast.rows.map(r => r.order_date).sort()[0], last: forecast.rows.map(r => r.order_date).sort().slice(-1)[0] } : null,
    reports: reports || [],
    history: { pos: count || 0, latestOrder: hist?.[0]?.order_date || null, updatedAt: hist?.[0]?.updated_at || null },
    productionLast: prodLast?.[0]?.production_date || null,
  })
}
