/* eslint-disable @typescript-eslint/no-explicit-any */
// Orchestration: load data, compute, render the workbook, charts and email, store the run.
import { SupabaseClient } from '@supabase/supabase-js'
import MailComposer from 'nodemailer/lib/mail-composer'
import { loadForecast, loadInventory, loadPos, loadPriorReport, loadProduction, loadSettings } from './data'
import { compute } from './model'
import { buildWorkbook } from './workbook'
import { buildCharts } from './charts'
import { buildEmailHtml, htmlToText, subjectFor } from './email'
import { Results, Settings, WeeklyInputs } from './types'
import { addDays, fiscalWeek, lastThursday } from './weeks'

export const BUCKET = 'erp-files'
export const FOLDER = 'walmart-weekly'

export interface ReportRow { id: string; report_date: string; wm_week: number; status: string; inputs: WeeklyInputs; results: Results; html: string | null; xlsx_path: string | null; chart_paths: { id: string; path: string }[]; subject: string | null; created_by: string | null; created_at: string; sent_at: string | null; sent_to: any }

export async function generateReport(sb: SupabaseClient, reportDate: string, inputs: WeeklyInputs, userEmail: string, existingId?: string): Promise<ReportRow> {
  const settings = await loadSettings(sb)
  const prior = await loadPriorReport(sb, reportDate)
  const priorDate = inputs.priorReportDate || prior?.report_date || addDays(reportDate, -7)
  const fy = fiscalWeek(reportDate).fy
  const fromDate = `${fy - 1}-12-01`   // enough history for the fiscal YTD table
  const [pos, production, inventory, forecast] = await Promise.all([
    loadPos(sb, fromDate, reportDate),
    loadProduction(sb, addDays(priorDate, -21), reportDate),
    loadInventory(sb, reportDate),
    loadForecast(sb),
  ])
  const full: WeeklyInputs = { ...inputs, reportDate, priorReportDate: priorDate }
  const results = compute({ settings, inputs: full, pos, production, inventory, forecast, prior })
  const html = buildEmailHtml(results, settings, full)
  const subject = subjectFor(results)
  const id = existingId || crypto.randomUUID()
  const base = `${FOLDER}/${id}`
  const xlsx = buildWorkbook(results, settings)
  const xlsxPath = `${base}/Walmart_Weekly_Report_WK${results.wmWeek}_${reportDate}.xlsx`
  const up1 = await sb.storage.from(BUCKET).upload(xlsxPath, xlsx, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true })
  if (up1.error) throw new Error('Workbook upload failed: ' + up1.error.message)
  const chartPaths: { id: string; path: string }[] = []
  for (const c of buildCharts(results)) {
    const path = `${base}/${c.id}.png`
    const up = await sb.storage.from(BUCKET).upload(path, c.png, { contentType: 'image/png', upsert: true })
    if (up.error) throw new Error('Chart upload failed: ' + up.error.message)
    chartPaths.push({ id: c.id, path })
  }
  const row = { id, report_date: reportDate, wm_week: results.wmWeek, status: 'draft', inputs: full, results, html, xlsx_path: xlsxPath, chart_paths: chartPaths, subject, created_by: userEmail }
  const { data, error } = await sb.from('wm_weekly_reports').upsert(row, { onConflict: 'id' }).select('*').single()
  if (error) throw new Error('Could not save the report: ' + error.message)
  return data as ReportRow
}

export async function loadAssets(sb: SupabaseClient, row: ReportRow): Promise<{ xlsx: Buffer; charts: { id: string; png: Buffer }[]; xlsxName: string }> {
  const xlsxName = (row.xlsx_path || '').split('/').pop() || 'Walmart_Weekly_Report.xlsx'
  const { data: x, error } = await sb.storage.from(BUCKET).download(row.xlsx_path || '')
  if (error || !x) throw new Error('Workbook is missing from storage, regenerate the report')
  const charts: { id: string; png: Buffer }[] = []
  for (const c of row.chart_paths || []) {
    const { data } = await sb.storage.from(BUCKET).download(c.path)
    if (data) charts.push({ id: c.id, png: Buffer.from(await data.arrayBuffer()) })
  }
  return { xlsx: Buffer.from(await x.arrayBuffer()), charts, xlsxName }
}

// Preview HTML with the charts inlined as data URIs (for the ERP preview pane and the .html download).
export function inlineHtml(html: string, charts: { id: string; png: Buffer }[]): string {
  let out = html
  for (const c of charts) out = out.split(`cid:${c.id}`).join(`data:image/png;base64,${c.png.toString('base64')}`)
  return out
}

export async function buildEml(sb: SupabaseClient, row: ReportRow, settings: Settings, from: string): Promise<Buffer> {
  const { xlsx, charts, xlsxName } = await loadAssets(sb, row)
  const mail = new MailComposer({
    from, to: settings.recipients.to.join(', '), cc: settings.recipients.cc.join(', '),
    subject: row.subject || '', text: htmlToText(row.html || ''), html: row.html || '',
    headers: { 'X-Unsent': '1' },
    attachments: [
      ...charts.map(c => ({ filename: `${c.id}.png`, content: c.png, cid: c.id, contentType: 'image/png', contentDisposition: 'inline' as const })),
      { filename: xlsxName, content: xlsx, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ],
  })
  return await mail.compile().build()
}

// Microsoft Graph sendMail payload from the signed-in user's mailbox, workbook attached, charts inline.
export async function sendViaGraphWithAttachments(accessToken: string, row: ReportRow, settings: Settings, assets: { xlsx: Buffer; charts: { id: string; png: Buffer }[]; xlsxName: string }, toOverride?: { to: string[]; cc: string[] }): Promise<void> {
  const parseAddr = (s: string) => { const m = s.match(/^(.*?)<([^>]+)>\s*$/); return m ? { emailAddress: { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim() } } : { emailAddress: { address: s.trim() } } }
  const rec = toOverride || settings.recipients
  const payload = {
    message: {
      subject: row.subject,
      body: { contentType: 'HTML', content: row.html },
      toRecipients: rec.to.filter(Boolean).map(parseAddr),
      ccRecipients: rec.cc.filter(Boolean).map(parseAddr),
      attachments: [
        ...assets.charts.map(c => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: `${c.id}.png`, contentType: 'image/png', contentId: c.id, isInline: true, contentBytes: c.png.toString('base64') })),
        { '@odata.type': '#microsoft.graph.fileAttachment', name: assets.xlsxName, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBytes: assets.xlsx.toString('base64') },
      ],
    },
    saveToSentItems: true,
  }
  const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (r.status !== 202 && !r.ok) throw new Error(`Outlook send failed: ${r.status} ${await r.text()}`)
}

export function defaultReportDate(today = new Date()): string {
  // The report goes out on Wednesday; default to the most recent Wednesday on or before today.
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const back = (d.getUTCDay() - 3 + 7) % 7
  return addDays(d.toISOString().slice(0, 10), -back)
}
export { lastThursday }
