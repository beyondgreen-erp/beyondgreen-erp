'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Close-out summary for a Walmart work order (walmart_wo_summary RPC).
 *  1. Targets vs made by SKU   2. Where it went (PO / load)   3. Loose ends
 *  4. Who did the work         5. Materials used               6. Dates
 * mode="close": shown before closing out — the Close out button closes the WO and saves the PDF
 * to the work order's files. mode="view": read-only, with Download / Save PDF.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import jsPDF from 'jspdf'
import '@/lib/pdfSafeText'
import autoTable from 'jspdf-autotable'
import { uploadFile } from '@/lib/fileHelpers'

interface Props { sb: any; woId: string; mode: 'view' | 'close'; canEdit: boolean; userEmail: string; onClose: () => void; onClosedOut?: (msg: string) => void }
type S = any

const n = (v: any) => Number(v) || 0
const fmt = (v: any) => n(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
const dt = (v: any) => (v ? new Date(String(v).length <= 10 ? v + 'T12:00:00' : v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const short = (who: string) => (who || 'unknown').split('@')[0]

function derive(s: S) {
  const pos: any[] = s?.pos || []
  const openPos = pos.filter(p => !p.shipped && n(p.released) < n(p.ordered))
  const shortShipped = pos.filter(p => p.shipped && n(p.released) < n(p.ordered))
  const under = (s?.skus || []).filter((k: any) => n(k.diff) < 0)
  const over = (s?.skus || []).filter((k: any) => n(k.diff) > 0)
  const unreleased = s?.unreleased || []
  const looseCount = openPos.length + shortShipped.length + under.length + unreleased.length
  const byLoad = new Map<string, any[]>()
  for (const p of pos) { const k = p.load || 'No load'; if (!byLoad.has(k)) byLoad.set(k, []); byLoad.get(k)!.push(p) }
  return { pos, openPos, shortShipped, under, over, unreleased, looseCount, byLoad }
}

export function buildSummaryPdf(s: S): jsPDF {
  const d = derive(s), wo = s.wo
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  let y = 44
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(`Work Order Close-out Summary — ${wo.code}`, 40, y)
  y += 16; doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110)
  doc.text(`beyondGREEN biotech · Walmart Production · Status: ${wo.status}${wo.completed_at ? ' (closed ' + dt(wo.completed_at) + ')' : ''} · Generated ${new Date(wo.generated_at).toLocaleString('en-US')} by ${wo.generated_by || '—'}`, 40, y)
  doc.setTextColor(0); y += 14
  const head = { fillColor: [0, 113, 206] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, fontSize: 8 }
  const sec = (t: string) => { y = ((doc as any).lastAutoTable?.finalY ?? y) + 20; if (y > 700) { doc.addPage(); y = 44 } doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(t, 40, y); y += 6 }
  const tbl = (headRow: string[], body: any[][], opts: any = {}) => autoTable(doc, { startY: y, head: [headRow], body: body.length ? body : [[{ content: 'None', colSpan: headRow.length, styles: { textColor: 120 } }]], styles: { fontSize: 8, cellPadding: 3 }, headStyles: head, margin: { left: 40, right: 40 }, ...opts })

  sec('6. Dates')
  tbl(['Week of', 'Due', 'First log', 'Last log', 'Closed', 'Weeks open'], [[dt(wo.start_date), dt(wo.due_date), dt(wo.first_log), dt(wo.last_log), wo.completed_at ? dt(wo.completed_at) : 'Open', String(wo.weeks_open)]])
  sec('1. Targets vs made')
  tbl(['SKU', 'Product', 'Target', 'Made', 'Over / under'], (s.skus || []).map((k: any) => [k.sku, k.name || '', fmt(k.target), fmt(k.made), n(k.diff) === 0 ? '✓' : (n(k.diff) > 0 ? '+' : '') + fmt(k.diff)]),
    { foot: [['Total', '', fmt((s.skus || []).reduce((a: number, k: any) => a + n(k.target), 0)), fmt((s.skus || []).reduce((a: number, k: any) => a + n(k.made), 0)), '']], footStyles: { fillColor: [240, 242, 246], textColor: 20, fontStyle: 'bold', fontSize: 8 } })
  sec('2. Where it went — by load and PO')
  const rows: any[][] = []
  for (const [load, list] of Array.from(d.byLoad.entries())) for (const p of list)
    rows.push([load, p.po || '', p.sku, fmt(p.ordered), fmt(p.released), fmt(p.claimed), p.shipped ? 'Shipped' : (p.status || p.group || ''), p.shipped && n(p.released) < n(p.ordered) ? `Short ${fmt(n(p.ordered) - n(p.released))}` : !p.shipped && n(p.released) < n(p.ordered) ? `${fmt(n(p.ordered) - n(p.released))} open` : ''])
  tbl(['Load', 'PO', 'SKU', 'Ordered', 'Released', 'Claimed', 'Status', 'Flag'], rows)
  sec('3. Loose ends')
  const loose: any[][] = []
  for (const k of d.under) loose.push(['Under target', k.sku, `${fmt(-n(k.diff))} SRP short of ${fmt(k.target)}`])
  for (const u of d.unreleased) loose.push(['Made, not released', u.sku, `${fmt(u.available)} SRP sitting unreleased`])
  for (const p of d.openPos) loose.push(['PO still open', `${p.po} · ${p.sku}`, `${fmt(n(p.ordered) - n(p.released))} of ${fmt(p.ordered)} not released (load ${p.load || '—'})`])
  for (const p of d.shortShipped) loose.push(['Shipped short', `${p.po} · ${p.sku}`, `${fmt(n(p.ordered) - n(p.released))} short on load ${p.load || '—'}`])
  for (const w of s.writeoffs || []) loose.push(['Written off', `${w.po} · ${w.sku}`, w.note || ''])
  tbl(['Type', 'Item', 'Detail'], loose, { columnStyles: { 2: { cellWidth: 300 } } })
  sec('4. Who did the work')
  tbl(['Person', 'Logs', 'SRP logged', 'Days'], (s.people || []).map((p: any) => [p.who, fmt(p.logs), fmt(p.qty), fmt(p.days)]))
  if ((s.daily || []).length) { y = (doc as any).lastAutoTable.finalY + 8; tbl(['Date', 'Person', 'SKU', 'SRP'], (s.daily || []).map((r: any) => [dt(r.date), short(r.who), r.sku, fmt(r.qty)])) }
  if ((s.voids || []).length) { y = (doc as any).lastAutoTable.finalY + 8; tbl(['Voided entry', 'SKU', 'SRP', 'Logged by', 'Voided by', 'Reason'], (s.voids || []).map((v: any) => [dt(v.date), v.sku, fmt(v.qty), short(v.by), short(v.voided_by), v.reason || ''])) }
  sec('5. Materials used (net of voids)')
  tbl(['Item', 'Description', 'UOM', 'Used'], (s.materials || []).map((m: any) => [m.sku, m.name || '', m.uom || '', fmt(m.used)]))
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`${wo.code} close-out summary · page ${i} of ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' }) }
  return doc
}

export default function WalmartWoSummary({ sb, woId, mode, canEdit, userEmail, onClose, onClosedOut }: Props) {
  const [s, setS] = useState<S | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [showDaily, setShowDaily] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await sb.rpc('walmart_wo_summary', { p_wo: woId })
    if (error) setErr(error.message); else setS(data)
    return data as S
  }, [sb, woId])
  useEffect(() => { load() }, [load])
  const d = useMemo(() => (s ? derive(s) : null), [s])

  async function savePdf(sum: S) {
    const doc = buildSummaryPdf(sum)
    const name = `${sum.wo.code}_Closeout_Summary_${new Date().toISOString().slice(0, 10)}.pdf`
    const file = new File([doc.output('blob')], name, { type: 'application/pdf' })
    const up = await uploadFile(sb, file, 'work_order', woId, userEmail)
    if (!up.success) throw new Error(up.error || 'Could not save the PDF')
    return name
  }
  async function closeOut() {
    if (!s) return
    setErr(''); setBusy('Closing out…')
    const { error } = await sb.rpc('walmart_wo_set_status', { p_wo: woId, p_status: 'Complete' })
    if (error) { setErr(error.message); setBusy(''); return }
    try {
      setBusy('Saving the summary PDF…')
      const fresh = await load()
      const name = await savePdf(fresh || s)
      setBusy('')
      onClosedOut?.(`✓ ${s.wo.code} closed out. Summary saved to the work order (${name}).`)
    } catch (e) { setBusy(''); setErr('Closed out, but the PDF could not be saved: ' + (e as Error).message) }
  }
  async function saveOnly() {
    if (!s) return
    setErr(''); setBusy('Saving PDF…')
    try { const name = await savePdf(s); setBusy(''); setErr(''); alert(`Saved to the work order's files: ${name}`) } catch (e) { setBusy(''); setErr((e as Error).message) }
  }
  function download() { if (s) buildSummaryPdf(s).save(`${s.wo.code}_Closeout_Summary.pdf`) }

  const th = 'text-left text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2 py-1.5'
  const td = 'px-2 py-1.5 text-[12px] border-t border-[#F0F2F6]'
  const H = ({ n: num, t }: { n: number; t: string }) => <h3 className="mt-5 mb-2 text-sm font-bold text-[#1A1D2E] flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-[#0071ce] text-white text-[11px] flex items-center justify-center">{num}</span>{t}</h3>

  const body = (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full sm:max-w-3xl max-h-[94vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#ECEEF3] flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{mode === 'close' ? 'Review before closing out' : 'Work order summary'}</p>
            <h2 className="font-bold text-[#1A1D2E] text-lg">{s?.wo?.code || 'Loading…'}</h2>
            {s && <p className="text-xs text-gray-500">Week of {dt(s.wo.start_date)} · {s.wo.weeks_open} week{s.wo.weeks_open === 1 ? '' : 's'} open · {s.wo.status}</p>}
          </div>
          <button onClick={onClose} disabled={!!busy} className="text-gray-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {err && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          {!s || !d ? <p className="py-10 text-center text-sm text-gray-400">Building the summary…</p> : <>
            {mode === 'close' && <div className={`mt-4 rounded-xl px-3 py-2.5 text-sm ${d.looseCount ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>
              {d.looseCount ? `${d.looseCount} loose end${d.looseCount === 1 ? '' : 's'} below. You can still close out — they'll be recorded in the summary.` : 'No loose ends — everything was made, released and shipped.'}</div>}

            <H n={1} t="Targets vs made" />
            <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]"><table className="w-full"><thead><tr><th className={th}>SKU</th><th className={th + ' text-right'}>Target</th><th className={th + ' text-right'}>Made</th><th className={th + ' text-right'}>Over/under</th></tr></thead><tbody>
              {(s.skus || []).map((k: any) => <tr key={k.sku}><td className={td + ' font-mono'}>{k.sku}</td><td className={td + ' text-right'}>{fmt(k.target)}</td><td className={td + ' text-right'}>{fmt(k.made)}</td><td className={td + ' text-right font-semibold ' + (n(k.diff) < 0 ? 'text-red-600' : n(k.diff) > 0 ? 'text-amber-600' : 'text-emerald-600')}>{n(k.diff) === 0 ? '✓' : (n(k.diff) > 0 ? '+' : '') + fmt(k.diff)}</td></tr>)}
            </tbody></table></div>

            <H n={2} t="Where it went — by load and PO" />
            {Array.from(d.byLoad.entries()).map(([load, list]) => (
              <div key={load} className="mb-2 rounded-lg border border-[#ECEEF3] overflow-x-auto">
                <p className="px-2 py-1.5 bg-[#FAFBFD] text-[12px] font-semibold">Load {load}{list.every(p => p.shipped) ? <span className="ml-2 text-emerald-600">shipped</span> : null}</p>
                <table className="w-full"><thead><tr><th className={th}>PO</th><th className={th}>SKU</th><th className={th + ' text-right'}>Ordered</th><th className={th + ' text-right'}>Released</th><th className={th + ' text-right'}>Claimed</th><th className={th}></th></tr></thead><tbody>
                  {list.map((p, i) => { const gap = n(p.ordered) - n(p.released); return <tr key={i}><td className={td + ' font-mono'}>{p.po}</td><td className={td + ' font-mono'}>{p.sku}</td><td className={td + ' text-right'}>{fmt(p.ordered)}</td><td className={td + ' text-right'}>{fmt(p.released)}</td><td className={td + ' text-right'}>{fmt(p.claimed)}</td><td className={td + ' text-[11px] font-semibold ' + (gap > 0 ? (p.shipped ? 'text-amber-700' : 'text-red-600') : 'text-emerald-600')}>{gap > 0 ? (p.shipped ? `shipped ${fmt(gap)} short` : `${fmt(gap)} open`) : '✓'}</td></tr> })}
                </tbody></table>
              </div>))}

            <H n={3} t="Loose ends" />
            {d.looseCount === 0 && !(s.writeoffs || []).length ? <p className="text-sm text-gray-400">None.</p> : <ul className="space-y-1 text-[13px]">
              {d.under.map((k: any) => <li key={'u' + k.sku}>• <b>{k.sku}</b> under target by {fmt(-n(k.diff))} SRP</li>)}
              {d.unreleased.map((u: any) => <li key={'r' + u.sku}>• <b>{u.sku}</b>: {fmt(u.available)} SRP made but never released</li>)}
              {d.openPos.map((p: any, i: number) => <li key={'o' + i}>• PO <b>{p.po}</b> {p.sku}: {fmt(n(p.ordered) - n(p.released))} of {fmt(p.ordered)} not released (load {p.load || '—'})</li>)}
              {d.shortShipped.map((p: any, i: number) => <li key={'s' + i}>• PO <b>{p.po}</b> {p.sku}: shipped {fmt(n(p.ordered) - n(p.released))} short</li>)}
              {(s.writeoffs || []).map((w: any, i: number) => <li key={'w' + i} className="text-gray-600">• Written off — PO <b>{w.po}</b> {w.sku}: {w.note}</li>)}
            </ul>}

            <H n={4} t="Who did the work" />
            <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]"><table className="w-full"><thead><tr><th className={th}>Person</th><th className={th + ' text-right'}>Logs</th><th className={th + ' text-right'}>SRP</th><th className={th + ' text-right'}>Days</th></tr></thead><tbody>
              {(s.people || []).map((p: any) => <tr key={p.who}><td className={td}>{p.who}</td><td className={td + ' text-right'}>{fmt(p.logs)}</td><td className={td + ' text-right font-semibold'}>{fmt(p.qty)}</td><td className={td + ' text-right'}>{fmt(p.days)}</td></tr>)}
            </tbody></table></div>
            <button onClick={() => setShowDaily(v => !v)} className="mt-1.5 text-xs text-[#0071ce] font-semibold">{showDaily ? 'Hide' : 'Show'} day-by-day ({(s.daily || []).length}) · voided entries ({(s.voids || []).length})</button>
            {showDaily && <div className="mt-2 space-y-2">
              <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]"><table className="w-full"><thead><tr><th className={th}>Date</th><th className={th}>Person</th><th className={th}>SKU</th><th className={th + ' text-right'}>SRP</th></tr></thead><tbody>
                {(s.daily || []).map((r: any, i: number) => <tr key={i}><td className={td}>{dt(r.date)}</td><td className={td}>{short(r.who)}</td><td className={td + ' font-mono'}>{r.sku}</td><td className={td + ' text-right'}>{fmt(r.qty)}</td></tr>)}
              </tbody></table></div>
              {(s.voids || []).length > 0 && <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]"><table className="w-full"><thead><tr><th className={th}>Voided</th><th className={th}>SKU</th><th className={th + ' text-right'}>SRP</th><th className={th}>By</th><th className={th}>Reason</th></tr></thead><tbody>
                {(s.voids || []).map((v: any, i: number) => <tr key={i}><td className={td}>{dt(v.date)}</td><td className={td + ' font-mono'}>{v.sku}</td><td className={td + ' text-right'}>{fmt(v.qty)}</td><td className={td}>{short(v.voided_by)}</td><td className={td + ' text-gray-500'}>{v.reason || '—'}</td></tr>)}
              </tbody></table></div>}
            </div>}

            <H n={5} t="Materials used (net of voids)" />
            <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]"><table className="w-full"><thead><tr><th className={th}>Item</th><th className={th}>Description</th><th className={th + ' text-right'}>Used</th></tr></thead><tbody>
              {(s.materials || []).map((m: any) => <tr key={m.sku}><td className={td + ' font-mono'}>{m.sku}</td><td className={td + ' text-gray-600'}>{m.name || ''}</td><td className={td + ' text-right'}>{fmt(m.used)} <span className="text-gray-400 text-[10px]">{m.uom || ''}</span></td></tr>)}
            </tbody></table></div>

            <H n={6} t="Dates" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px]">
              {[['Week of', dt(s.wo.start_date)], ['Due', dt(s.wo.due_date)], ['First log', dt(s.wo.first_log)], ['Last log', dt(s.wo.last_log)], ['Closed', s.wo.completed_at ? dt(s.wo.completed_at) : 'Still open'], ['Weeks open', String(s.wo.weeks_open)]].map(([k, v]) =>
                <div key={k} className="rounded-lg border border-[#ECEEF3] px-2.5 py-2"><p className="text-[10px] uppercase text-gray-400">{k}</p><p className="font-semibold text-[#1A1D2E]">{v}</p></div>)}
            </div>
          </>}
        </div>
        <div className="px-5 py-3 border-t border-[#ECEEF3] flex flex-wrap gap-2 justify-end">
          {busy && <span className="mr-auto self-center text-xs text-gray-500">{busy}</span>}
          <button onClick={download} disabled={!s || !!busy} className="text-sm font-semibold rounded-xl px-3 py-2 border border-[#E4E6EE] text-gray-600 disabled:opacity-40">⬇ Download PDF</button>
          {mode === 'view' && canEdit && <button onClick={saveOnly} disabled={!s || !!busy} className="text-sm font-semibold rounded-xl px-3 py-2 border border-[#E4E6EE] text-gray-600 disabled:opacity-40">Save PDF to work order</button>}
          {mode === 'close' && canEdit && <button onClick={closeOut} disabled={!s || !!busy} className="text-sm font-semibold rounded-xl px-4 py-2 text-white bg-[#00a85a] disabled:opacity-40">✓ Close out &amp; save summary</button>}
          <button onClick={onClose} disabled={!!busy} className="text-sm font-semibold rounded-xl px-3 py-2 border border-[#E4E6EE] text-gray-600">{mode === 'close' ? 'Cancel' : 'Close'}</button>
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(body, document.body)
}
