'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SKUS = ['22GVS24', '22GVS48', '22GVF24', '22GVA24', '22GVA48', '22GVF48', '22GVK48'] as const
const NAME: Record<string, string> = { '22GVS24': 'Spoon 24CT', '22GVS48': 'Spoon 48CT', '22GVF24': 'Fork 24CT', '22GVA24': 'F/S/K 24CT', '22GVA48': 'F/S/K 48CT', '22GVF48': 'Fork 48CT', '22GVK48': 'Knife 48CT' }
const n = (x: any) => (Number(x) || 0).toLocaleString('en-US')
const md = (s?: string | null) => s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : ''
const NOTE_FIELDS: { key: string; label: string; hint: string; rows?: number }[] = [
  { key: 'certifications', label: 'Certification note', hint: 'Sentence(s) after the certification list. Leave blank for the standard line.' },
  { key: 'shipping', label: 'Pickup / routing notes', hint: 'What is going on with pickups this week (Stride, reroutes, asks about loads). Goes under the loads table.', rows: 5 },
  { key: 'production', label: 'Production note', hint: 'Anything to add under the production table (what the runs are weighted to, etc.).' },
  { key: 'forecast', label: 'Forecast note / questions', hint: 'Context on the forecast or the store increase, and any confirmations to ask for.', rows: 4 },
  { key: 'packaging', label: 'Packaging note', hint: 'Container arrivals, top-up orders placed, anything on SRPs or Unit Packaging.' },
  { key: 'asks', label: 'Asks for Walmart', hint: 'One per line. Rendered as a short bullet list near the end.', rows: 3 },
  { key: 'meeting', label: 'Meeting request', hint: 'Leave blank to skip the section.' },
  { key: 'closing', label: 'Closing line', hint: 'Leave blank for the standard closing.' },
]

export default function WalmartWeeklyReport() {
  const [ov, setOv] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [reportDate, setReportDate] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [openingOverride, setOpeningOverride] = useState<Record<string, string> | null>(null)
  const [report, setReport] = useState<any>(null)
  const [preview, setPreview] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showUploads, setShowUploads] = useState(false)
  const [settings, setSettings] = useState<any>(null)
  const [sendTo, setSendTo] = useState(''); const [sendCc, setSendCc] = useState('')
  const [confirmSend, setConfirmSend] = useState(false)
  const [planSkus, setPlanSkus] = useState<string[]>(['22GVS24', '22GVF24'])
  const [manualDate, setManualDate] = useState(''); const [manualQty, setManualQty] = useState('')
  const fileRefs = { forecast: useRef<HTMLInputElement>(null), plan: useRef<HTMLInputElement>(null), history: useRef<HTMLInputElement>(null) }

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/walmart/weekly-report', { cache: 'no-store' }); const j = await r.json()
    if (!r.ok) { setErr(j.error || 'Could not load'); setLoading(false); return }
    setOv(j); setSettings(j.settings)
    setReportDate(d => d || j.defaultReportDate)
    setSendTo(j.settings.recipients.to.join(', ')); setSendCc(j.settings.recipients.cc.join(', '))
    const last = (j.reports || [])[0]
    if (last?.inputs?.notes && !Object.keys(notes).length) setNotes({ meeting: last.inputs.notes.meeting || '', closing: last.inputs.notes.closing || '' })
    setLoading(false)
  }, [notes])
  useEffect(() => { load() }, [load])  // eslint-disable-line react-hooks/exhaustive-deps

  const prior = useMemo(() => (ov?.reports || []).find((r: any) => r.report_date < reportDate), [ov, reportDate])

  async function generate(existingId?: string) {
    setBusy('generate'); setErr(''); setMsg('')
    try {
      const body: any = { reportDate, notes, id: existingId }
      if (openingOverride) body.openingPosition = Object.fromEntries(SKUS.map(k => [k, Number(openingOverride[k]) || 0]))
      const r = await fetch('/api/walmart/weekly-report/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Generate failed')
      setReport(j.report); setPreview(j.preview); setMsg(`Report generated for WM WK ${j.report.wm_week} (${j.report.subject}). Review the preview, then download or send.`)
      await load()
    } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }
  async function send() {
    if (!report) return
    setBusy('send'); setErr(''); setMsg('')
    try {
      const split = (s: string) => s.split(/[,;]\s*/).map(x => x.trim()).filter(Boolean)
      const r = await fetch('/api/walmart/weekly-report/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: report.id, to: split(sendTo), cc: split(sendCc) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Send failed')
      setConfirmSend(false); setMsg(`Sent from your Outlook to ${j.sentTo.to.join(', ')}${j.sentTo.cc.length ? ` (cc ${j.sentTo.cc.join(', ')})` : ''}. It is in your Sent folder.`)
      setReport({ ...report, status: 'sent' }); await load()
    } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }
  async function upload(kind: 'forecast' | 'plan' | 'history') {
    const f = fileRefs[kind].current?.files?.[0]; if (!f) { setErr('Choose a file first.'); return }
    setBusy('upload-' + kind); setErr(''); setMsg('')
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('kind', kind)
      if (kind === 'plan') { fd.append('skus', planSkus.join(',')); if (manualDate && manualQty) { fd.append('manualDate', manualDate); fd.append('manualQty', manualQty) } }
      const r = await fetch('/api/walmart/weekly-report/upload', { method: 'POST', body: fd })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Upload failed')
      setMsg(kind === 'forecast' ? `Forecast loaded: ${j.rows} rows, ${md(j.first)} to ${md(j.last)}${j.runDate ? `, run ${md(j.runDate)}` : ''}${j.carriedPlan ? '. The comp-store plan from the previous upload was carried over.' : ''}`
        : kind === 'plan' ? `Plan applied to ${j.skus.map((s: string) => NAME[s]).join(' and ')}: ${j.weeks} weeks, ${n(j.total)} units each, from the ${md(j.firstOrder)} order.`
        : `PO history updated: ${n(j.pos)} POs, orders ${md(j.first)} to ${md(j.last)}.`)
      if (fileRefs[kind].current) fileRefs[kind].current!.value = ''
      await load()
    } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }
  async function saveSettings() {
    setBusy('settings'); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/walmart/weekly-report/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Save failed')
      setSettings(j.settings); setMsg('Settings saved. Regenerate the report to apply them.')
    } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }
  async function openReport(id: string) {
    setBusy('open'); setErr('')
    try {
      const r = await fetch(`/api/walmart/weekly-report/file?id=${id}&kind=html`); if (!r.ok) throw new Error('Could not open that report')
      const html = await r.text(); const row = (ov.reports || []).find((x: any) => x.id === id)
      setReport(row); setPreview(html); setReportDate(row.report_date); setNotes(row.inputs?.notes || {})
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }
  const dl = (kind: string) => report && window.open(`/api/walmart/weekly-report/file?id=${report.id}&kind=${kind}`, '_blank')
  const res = report?.results
  const card = 'bg-white rounded-xl border border-gray-200 shadow-sm p-5'
  const input = 'border border-gray-300 rounded-lg px-3 py-2 text-sm w-full'
  const btn = (color: string) => `px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${color}`

  if (loading && !ov) return <div className="text-sm text-gray-500 p-4">Loading…</div>
  return (
    <div className="space-y-5">
      {(err || msg) && <div className={`rounded-lg px-4 py-3 text-sm ${err ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>{err || msg}</div>}

      {/* data status */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Walmart Weekly Report (bG Weekly Update)</h2>
            <p className="text-xs text-gray-500 mt-0.5">Pulls POs, loads and pickups from the Walmart board, production from the production board, and packaging from the ERP inventory. You add the week&apos;s notes, it builds the workbook and the email.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowUploads(s => !s)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-300 text-gray-700">Uploads</button>
            <button onClick={() => setShowSettings(s => !s)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-300 text-gray-700">Settings</button>
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Forecast on file" value={ov?.forecast ? `${md(ov.forecast.first)} to ${md(ov.forecast.last)}` : 'none'} sub={ov?.forecast ? `${ov.forecast.name}${Object.keys(ov.forecast.plan || {}).length ? ` · plan on ${Object.keys(ov.forecast.plan).map(k => NAME[k]).join(', ')}` : ''}` : 'Upload the Walmart order forecast'} warn={!ov?.forecast} />
          <Stat label="PO history (MABDs, comments)" value={ov?.history?.pos ? `${n(ov.history.pos)} POs` : 'none'} sub={ov?.history?.latestOrder ? `latest order ${md(ov.history.latestOrder)}` : 'Upload the WM Ordered vs Ship report'} warn={!ov?.history?.pos} />
          <Stat label="Production board" value={ov?.productionLast ? `logged through ${md(ov.productionLast)}` : 'no entries'} warn={!ov?.productionLast} />
          <Stat label="Last report" value={ov?.reports?.[0] ? `WK ${ov.reports[0].wm_week}, ${md(ov.reports[0].report_date)}` : 'none yet'} sub={ov?.reports?.[0] ? (ov.reports[0].status === 'sent' ? `sent ${new Date(ov.reports[0].sent_at).toLocaleDateString()}` : 'draft, not sent') : ''} />
        </div>
      </div>

      {showUploads && (
        <div className={card}>
          <h3 className="font-bold text-gray-900 mb-3">Uploads</h3>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="border rounded-lg p-3">
              <div className="font-bold text-gray-800">Walmart order forecast</div>
              <p className="text-xs text-gray-500 mb-2">The Sales and Order Forecast workbook from Retail Link (Order Forecast sheet). Upload when Walmart sends a new run.</p>
              <input ref={fileRefs.forecast} type="file" accept=".xlsx,.xls" className="text-xs mb-2" />
              <button disabled={!!busy} onClick={() => upload('forecast')} className={btn('bg-[#0071CE]')}>{busy === 'upload-forecast' ? 'Loading…' : 'Load forecast'}</button>
            </div>
            <div className="border rounded-lg p-3">
              <div className="font-bold text-gray-800">Comp-store supply plan (CSV)</div>
              <p className="text-xs text-gray-500 mb-2">ORDER_WK, WM_YEAR, Order_Qty. Replaces the forecast for the chosen items from the first plan week. Optional one-time manual order.</p>
              <div className="flex flex-wrap gap-2 mb-2">{SKUS.map(k => <label key={k} className="text-xs flex items-center gap-1"><input type="checkbox" checked={planSkus.includes(k)} onChange={e => setPlanSkus(p => e.target.checked ? [...p, k] : p.filter(x => x !== k))} />{NAME[k]}</label>)}</div>
              <div className="flex gap-2 mb-2"><input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className={input} /><input type="number" placeholder="manual order units" value={manualQty} onChange={e => setManualQty(e.target.value)} className={input} /></div>
              <input ref={fileRefs.plan} type="file" accept=".csv,.txt" className="text-xs mb-2" />
              <button disabled={!!busy || !ov?.forecast} onClick={() => upload('plan')} className={btn('bg-[#0071CE]')}>{busy === 'upload-plan' ? 'Loading…' : 'Apply plan'}</button>
            </div>
            <div className="border rounded-lg p-3">
              <div className="font-bold text-gray-800">WM Ordered vs Ship report</div>
              <p className="text-xs text-gray-500 mb-2">Manish&apos;s workbook. Brings in MABDs, pickup comments and the PO history from before the Walmart board. Safe to re-upload every week.</p>
              <input ref={fileRefs.history} type="file" accept=".xlsx,.xls" className="text-xs mb-2" />
              <button disabled={!!busy} onClick={() => upload('history')} className={btn('bg-[#0071CE]')}>{busy === 'upload-history' ? 'Loading…' : 'Update PO history'}</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && settings && (
        <div className={card}>
          <h3 className="font-bold text-gray-900 mb-3">Settings</h3>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-bold text-gray-800 mb-1">Store counts</div>
              {(['base', 'comp48', 'comp24'] as const).map(g => <label key={g} className="flex items-center gap-2 mb-1 text-xs"><span className="w-28">{g === 'base' ? 'Base program' : g === 'comp48' ? 'Comp 48CT' : 'Comp 24CT'}</span><input type="number" value={settings.stores[g]} onChange={e => setSettings({ ...settings, stores: { ...settings.stores, [g]: Number(e.target.value) } })} className={input} /></label>)}
              <div className="font-bold text-gray-800 mb-1 mt-3">Reset date</div>
              <input type="date" value={settings.resetDate} onChange={e => setSettings({ ...settings, resetDate: e.target.value })} className={input} />
              <div className="font-bold text-gray-800 mb-1 mt-3">Greeting</div>
              <input value={settings.greeting} onChange={e => setSettings({ ...settings, greeting: e.target.value })} className={input} />
            </div>
            <div>
              <div className="font-bold text-gray-800 mb-1">Items: USW, store group, SRP on order, Unit Packaging on order</div>
              {SKUS.map(k => <div key={k} className="grid grid-cols-5 gap-1 items-center mb-1 text-xs"><span>{NAME[k]}</span>
                <input type="number" step="0.01" value={settings.usw[k]} onChange={e => setSettings({ ...settings, usw: { ...settings.usw, [k]: Number(e.target.value) } })} className={input} title="USW" />
                <select value={settings.storeGroup[k]} onChange={e => setSettings({ ...settings, storeGroup: { ...settings.storeGroup, [k]: e.target.value } })} className={input}><option value="base">base</option><option value="comp48">comp48</option><option value="comp24">comp24</option></select>
                <input type="number" value={settings.srpOnOrder[k] || 0} onChange={e => setSettings({ ...settings, srpOnOrder: { ...settings.srpOnOrder, [k]: Number(e.target.value) } })} className={input} title="SRPs on order" />
                <input type="number" value={settings.unitPkgOnOrder[k] || 0} onChange={e => setSettings({ ...settings, unitPkgOnOrder: { ...settings.unitPkgOnOrder, [k]: Number(e.target.value) } })} className={input} title="Unit Packaging on order" />
              </div>)}
              <div className="text-[10px] text-gray-500">columns: USW · store group · SRPs on order · Unit Packaging on order</div>
              <label className="text-xs block mt-2">SRP order reference <input value={settings.srpPoNote} onChange={e => setSettings({ ...settings, srpPoNote: e.target.value })} className={input} /></label>
              <label className="text-xs block mt-2">Unit Packaging note (workbook) <input value={settings.unitPkgNote || ''} onChange={e => setSettings({ ...settings, unitPkgNote: e.target.value })} className={input} /></label>
            </div>
            <div>
              <div className="font-bold text-gray-800 mb-1">Recipients</div>
              <label className="text-xs block">To <textarea value={settings.recipients.to.join('\n')} onChange={e => setSettings({ ...settings, recipients: { ...settings.recipients, to: e.target.value.split('\n').map((x: string) => x.trim()).filter(Boolean) } })} className={input} rows={2} /></label>
              <label className="text-xs block mt-1">Cc <textarea value={settings.recipients.cc.join('\n')} onChange={e => setSettings({ ...settings, recipients: { ...settings.recipients, cc: e.target.value.split('\n').map((x: string) => x.trim()).filter(Boolean) } })} className={input} rows={3} /></label>
              <div className="font-bold text-gray-800 mb-1 mt-3">Certifications (name | status, one per line)</div>
              <textarea value={settings.certifications.map((c: any) => `${c.name} | ${c.status}`).join('\n')} onChange={e => setSettings({ ...settings, certifications: e.target.value.split('\n').filter((l: string) => l.trim()).map((l: string) => { const [name, ...rest] = l.split('|'); return { name: name.trim(), status: rest.join('|').trim() } }) })} className={input} rows={5} />
            </div>
          </div>
          <button disabled={!!busy} onClick={saveSettings} className={btn('bg-gray-800') + ' mt-3'}>{busy === 'settings' ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}

      {/* this week */}
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-xs font-bold text-gray-700">Report date<br /><input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className={input + ' w-44'} /></label>
          <div className="text-xs text-gray-500 pb-2">{prior ? `Rolls forward from the ${md(prior.report_date)} report (WK ${prior.wm_week}).` : 'No earlier report on file: set the opening position below.'}</div>
          <div className="flex-1" />
          <button disabled={!!busy || !reportDate} onClick={() => generate()} className={btn('bg-[#2BA84A]')}>{busy === 'generate' ? 'Building…' : (report && report.report_date === reportDate ? 'Regenerate report' : 'Generate report')}</button>
        </div>
        <details className="mb-3" open={!prior}>
          <summary className="text-xs font-bold text-gray-700 cursor-pointer">Opening position by item (units, after last week&apos;s order shipped){openingOverride ? ' · override on' : ''}</summary>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mt-2">
            {SKUS.map(k => <label key={k} className="text-[11px]">{NAME[k]}<input type="number" value={openingOverride?.[k] ?? (prior?.results?.position?.closing?.[k] ?? '')} onChange={e => setOpeningOverride({ ...(openingOverride || Object.fromEntries(SKUS.map(s => [s, String(prior?.results?.position?.closing?.[s] ?? 0)]))), [k]: e.target.value })} className={input} /></label>)}
          </div>
          {openingOverride && <button onClick={() => setOpeningOverride(null)} className="text-xs text-blue-700 mt-1">Use the prior report&apos;s closing position</button>}
        </details>
        <div className="grid md:grid-cols-2 gap-3">
          {NOTE_FIELDS.map(f => <label key={f.key} className="text-xs"><span className="font-bold text-gray-700">{f.label}</span><span className="text-gray-400"> · {f.hint}</span><textarea rows={f.rows || 2} value={notes[f.key] || ''} onChange={e => setNotes({ ...notes, [f.key]: e.target.value })} className={input + ' mt-1'} /></label>)}
        </div>
      </div>

      {/* result */}
      {report && (
        <div className={card}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="font-bold text-gray-900">{report.subject}</div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${report.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{report.status === 'sent' ? 'sent' : 'draft'}</span>
            <div className="flex-1" />
            <button onClick={() => dl('xlsx')} className={btn('bg-gray-700')}>Download workbook</button>
            <button onClick={() => dl('eml')} className={btn('bg-gray-700')}>Download .eml (opens in Outlook)</button>
            <button onClick={() => dl('html')} className={btn('bg-gray-500')}>HTML</button>
            <button disabled={!!busy} onClick={() => setConfirmSend(true)} className={btn('bg-[#0071CE]')}>Send from my Outlook</button>
          </div>
          {res && <div className="grid sm:grid-cols-5 gap-2 text-xs mb-3">
            <Stat label={`WK ${res.orderWeek > 52 ? res.orderWeek - 52 : res.orderWeek} order`} value={`${n(res.thisOrder.units)} units`} sub={`${res.thisOrder.pos} POs`} />
            <Stat label="Position after it ships" value={n(res.position.closingTotal)} sub={res.reqTotals.weeksSupply != null ? `${res.reqTotals.weeksSupply.toFixed(1)} weeks at ${settings?.stores?.base} stores` : ''} />
            <Stat label="3-week req. after increases" value={n(res.reqTotals.req3After)} sub={`build ${n(res.reqTotals.build)}`} />
            <Stat label="Supply plan avg / week" value={n(res.reqTotals.spAvg)} sub={res.forecast.manualTotal ? `+ ${n(res.forecast.manualTotal)} manual` : ''} />
            <Stat label="YTD" value={`${n(res.ytd.shipped)} shipped`} sub={`${res.ytd.fullWeeks} full weeks at 100%`} />
          </div>}
          {confirmSend && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-3 text-sm">
              <div className="font-bold text-blue-900 mb-2">Send this email from your Outlook with the workbook attached?</div>
              <label className="text-xs block">To <input value={sendTo} onChange={e => setSendTo(e.target.value)} className={input} /></label>
              <label className="text-xs block mt-1">Cc <input value={sendCc} onChange={e => setSendCc(e.target.value)} className={input} /></label>
              <div className="flex gap-2 mt-2"><button disabled={!!busy} onClick={send} className={btn('bg-[#0071CE]')}>{busy === 'send' ? 'Sending…' : 'Yes, send it'}</button><button onClick={() => setConfirmSend(false)} className="px-4 py-2 rounded-lg text-sm font-bold border border-gray-300">Cancel</button></div>
            </div>
          )}
          <iframe title="Email preview" srcDoc={preview} className="w-full border border-gray-200 rounded-lg bg-white" style={{ height: '80vh' }} />
        </div>
      )}

      {/* history */}
      {!!ov?.reports?.length && (
        <div className={card}>
          <h3 className="font-bold text-gray-900 mb-2">Past reports</h3>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500"><th className="py-1">Report</th><th>Status</th><th>By</th><th>Sent</th><th></th></tr></thead>
            <tbody>{ov.reports.map((r: any) => <tr key={r.id} className="border-t border-gray-100">
              <td className="py-1.5 font-medium">{r.subject || `WK ${r.wm_week} ${r.report_date}`}</td>
              <td>{r.status}</td><td>{r.created_by}</td><td>{r.sent_at ? new Date(r.sent_at).toLocaleString() : ''}</td>
              <td className="text-right space-x-2"><button onClick={() => openReport(r.id)} className="text-blue-700 font-bold">Open</button><a href={`/api/walmart/weekly-report/file?id=${r.id}&kind=xlsx`} className="text-blue-700" target="_blank" rel="noreferrer">Workbook</a><a href={`/api/walmart/weekly-report/file?id=${r.id}&kind=eml`} className="text-blue-700" target="_blank" rel="noreferrer">.eml</a></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return <div className={`rounded-lg border p-2.5 ${warn ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}><div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div><div className="font-bold text-gray-900 text-sm">{value}</div>{sub && <div className="text-[11px] text-gray-500 truncate" title={sub}>{sub}</div>}</div>
}
