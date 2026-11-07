'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import PortalShell, { api, GREEN, INK, cardCls, inputCls, labelCls, btnCls, btnGhostCls, Empty, fmtDate, qty } from '@/components/portal/PortalShell'

const iso = (d: Date) => d.toISOString().slice(0, 10)
function quarters(n = 8) {
  const out: { label: string; from: string; to: string }[] = []
  const now = new Date(); let y = now.getFullYear(), q = Math.floor(now.getMonth() / 3)
  for (let i = 0; i < n; i++) {
    const from = new Date(Date.UTC(y, q * 3, 1)), to = new Date(Date.UTC(y, q * 3 + 3, 0))
    out.push({ label: `Q${q + 1} ${y}`, from: iso(from), to: iso(to) })
    q--; if (q < 0) { q = 3; y-- }
  }
  return out
}
const kg = (n: number | null | undefined) => n == null ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })

function csvDownload(name: string, rows: (string | number | null)[][]) {
  const body = rows.map(r => r.map(c => { const s = c == null ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = name; a.click()
}

async function pdfDoc(title: string, sub: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  doc.setFillColor(3, 127, 76); doc.rect(0, 0, 612, 70, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(title, 40, 34)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(sub, 40, 54)
  doc.setTextColor(26, 29, 46)
  return doc
}
function table(doc: any, y: number, cols: { h: string; w: number; a?: 'r' }[], rows: string[][]) {
  const draw = (cells: string[], bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8)
    const wrapped = cells.map((c, i) => doc.splitTextToSize(c || '', cols[i].w - 6))
    const h = Math.max(...wrapped.map((w: string[]) => w.length)) * 10 + 6
    if (y + h > 750) { doc.addPage(); y = 50 }
    let x = 40
    wrapped.forEach((w: string[], i: number) => { doc.text(w, cols[i].a === 'r' ? x + cols[i].w - 4 : x + 2, y + 10, { align: cols[i].a === 'r' ? 'right' : 'left' }); x += cols[i].w })
    y += h; doc.setDrawColor(230, 232, 238); doc.line(40, y - 2, 572, y - 2)
  }
  draw(cols.map(c => c.h), true); rows.forEach(r => draw(r, false))
  return y
}

function StockHeld() {
  const [rows, setRows] = useState<any[] | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [f, setF] = useState({ requested_ship_date: '', po_number: '', ship_to: '', notes: '' })
  const [st, setSt] = useState<{ busy?: boolean; err?: string; ok?: string }>({})
  useEffect(() => { api('stock-held').then(r => setRows(r.data.rows || [])) }, [])
  async function send() {
    const lines = (rows || []).map((r, i) => ({ ...r, quantity: Number(pick[i]) || 0 })).filter(l => l.quantity > 0)
    if (lines.some(l => l.quantity > l.on_hand)) { setSt({ err: 'A release quantity is more than we hold for you.' }); return }
    setSt({ busy: true })
    const r = await api('stock-release', { ...f, lines: lines.map(l => ({ sku: l.sku, name: l.name, quantity: l.quantity, unit: l.unit, stock_id: l.stock_id })) })
    setSt(r.ok ? { ok: `Release request ${r.data.request_number} sent. We will confirm the ship date.` } : { err: r.data.error || 'Please try again.' })
    if (r.ok) setPick({})
  }
  if (rows === null) return <Empty>Loading…</Empty>
  if (!rows.length) return <Empty>We are not holding stock for you right now. Ask us about stock and release: we build ahead and hold it at no charge, then ship when you call it off.</Empty>
  const any = Object.values(pick).some(v => Number(v) > 0)
  return (
    <div className="space-y-3">
      <div className="divide-y divide-[#F1F3F9]">
        {rows.map((r, i) => (
          <div key={i} className="py-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold" style={{ color: INK }}>{r.name}</p><p className="text-xs text-gray-500">{r.sku}{r.ref ? ` · ${r.ref}` : ''}{r.updated_at ? ` · updated ${fmtDate(r.updated_at)}` : ''}</p></div>
            <div className="text-right"><p className="text-sm font-bold" style={{ color: GREEN }}>{qty(r.on_hand)}</p><p className="text-[11px] text-gray-500">{r.unit} on hand</p></div>
            <input className={inputCls + ' !w-28'} inputMode="numeric" placeholder="Release" value={pick[i] || ''} onChange={e => setPick({ ...pick, [i]: e.target.value.replace(/[^\d]/g, '') })} aria-label={`Release quantity for ${r.sku}`} />
          </div>
        ))}
      </div>
      {any && (
        <div className="grid sm:grid-cols-2 gap-3 pt-2">
          <div><label className={labelCls}>Ship by</label><input type="date" className={inputCls} value={f.requested_ship_date} onChange={e => setF({ ...f, requested_ship_date: e.target.value })} /></div>
          <div><label className={labelCls}>PO number (optional)</label><input className={inputCls} value={f.po_number} onChange={e => setF({ ...f, po_number: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Ship to</label><textarea className={inputCls} rows={2} value={f.ship_to} onChange={e => setF({ ...f, ship_to: e.target.value })} placeholder="Leave blank to use your account address" /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Notes</label><textarea className={inputCls} rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
        </div>
      )}
      {st.err && <p className="text-sm text-red-600">{st.err}</p>}
      {st.ok && <p className="text-sm font-semibold" style={{ color: GREEN }}>{st.ok}</p>}
      <button className={btnCls} style={{ background: GREEN }} disabled={!any || st.busy} onClick={send}>{st.busy ? 'Sending…' : 'Request release / ship'}</button>
    </div>
  )
}

function Missing({ list }: { list: any[] }) {
  if (!list?.length) return null
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
      <p className="font-bold mb-1">Data we are still filling in ({list.length} SKU{list.length > 1 ? 's' : ''})</p>
      <ul className="space-y-0.5">{list.map((m: any) => <li key={m.sku}><b>{m.sku}</b> {m.name !== m.sku ? `(${m.name})` : ''}: {m.needs.join(', ')}</li>)}</ul>
      <p className="mt-1">Totals for these SKUs are left blank, not estimated. Our team has been asked to complete them.</p>
    </div>
  )
}

function Epr() {
  const qs = useMemo(() => quarters(), [])
  const [from, setFrom] = useState(qs[1].from), [to, setTo] = useState(qs[1].to)
  const [d, setD] = useState<any | null>(null), [busy, setBusy] = useState(false)
  async function load() { setBusy(true); const r = await api(`epr?from=${from}&to=${to}`); setD(r.data); setBusy(false) }
  const fname = `beyondGREEN-EPR-data-${from}-to-${to}`
  function csv() {
    csvDownload(fname + '.csv', [['SKU', 'Item', 'Product family', 'Material type', 'Ordered', 'Units (pieces)', 'Weight per unit (g)', 'Total weight (kg)', 'Orders'], ...d.rows.map((r: any) => [r.sku, r.name, r.family || '', r.material || 'MISSING', r.ordered, r.pieces_known ? r.pieces : 'MISSING', r.grams_each ?? 'MISSING', r.total_kg ?? '', r.orders])])
  }
  async function pdf() {
    const doc = await pdfDoc('SB 54 / EPR data export', `${d.company || ''} · ${fmtDate(from)} to ${fmtDate(to)} · prepared ${fmtDate(new Date().toISOString())}`)
    const y = table(doc, 90, [{ h: 'SKU', w: 70 }, { h: 'Item', w: 120 }, { h: 'Material', w: 110 }, { h: 'Ordered', w: 70 }, { h: 'Pieces', w: 55, a: 'r' }, { h: 'g each', w: 45, a: 'r' }, { h: 'Total kg', w: 62, a: 'r' }], d.rows.map((r: any) => [r.sku, r.name, r.material || 'Missing', r.ordered, r.pieces_known ? qty(r.pieces) : 'Missing', r.grams_each != null ? String(r.grams_each) : 'Missing', r.total_kg != null ? kg(r.total_kg) : '']))
    const total = d.rows.reduce((s: number, r: any) => s + (r.total_kg || 0), 0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(`Total weight of SKUs with complete data: ${kg(total)} kg`, 40, y + 14)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(doc.splitTextToSize('Weights are per unit as recorded by beyondGREEN for the finished item. SKUs marked Missing are still being measured and are not included in the total. For producer reporting, confirm figures against your own records.', 532), 40, y + 30)
    doc.save(fname + '.pdf')
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className={labelCls}>From</label><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className={labelCls}>To</label><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></div>
        <select className={inputCls + ' !w-auto'} onChange={e => { const q = qs[Number(e.target.value)]; if (q) { setFrom(q.from); setTo(q.to) } }} defaultValue="" aria-label="Pick a quarter"><option value="" disabled>Pick a quarter</option>{qs.map((q, i) => <option key={q.label} value={i}>{q.label}</option>)}</select>
        <button className={btnCls} style={{ background: GREEN }} onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Show data'}</button>
      </div>
      {d && (d.rows.length ? (
        <>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[640px]">
              <thead><tr className="text-left text-gray-500"><th className="py-1.5 pr-2">SKU</th><th className="pr-2">Item</th><th className="pr-2">Material</th><th className="pr-2">Ordered</th><th className="pr-2 text-right">Pieces</th><th className="pr-2 text-right">g each</th><th className="text-right">Total kg</th></tr></thead>
              <tbody>{d.rows.map((r: any) => (
                <tr key={r.sku} className="border-t border-[#F1F3F9] align-top"><td className="py-1.5 pr-2 font-semibold">{r.sku}</td><td className="pr-2">{r.name}</td><td className="pr-2">{r.material || <span className="text-amber-700">Missing</span>}</td><td className="pr-2">{r.ordered}</td><td className="pr-2 text-right">{r.pieces_known ? qty(r.pieces) : <span className="text-amber-700">Missing</span>}</td><td className="pr-2 text-right">{r.grams_each ?? <span className="text-amber-700">Missing</span>}</td><td className="text-right">{kg(r.total_kg)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Missing list={d.missing} />
          <div className="flex flex-wrap gap-2"><button className={btnGhostCls} onClick={csv}>Download CSV</button><button className={btnGhostCls} onClick={pdf}>Download PDF</button></div>
        </>
      ) : <Empty>No orders in this date range.</Empty>)}
    </div>
  )
}

function Impact() {
  const qs = useMemo(() => quarters(), [])
  const [i, setI] = useState(1), [busy, setBusy] = useState(false), [d, setD] = useState<any | null>(null)
  async function make() {
    setBusy(true)
    const q = qs[i]; const r = await api(`impact?from=${q.from}&to=${q.to}`); setBusy(false)
    const data = r.data; setD(data)
    if (!data.rows?.length) return
    const doc = await pdfDoc(`Quarterly impact report: ${q.label}`, `${data.company || ''} · ${fmtDate(q.from)} to ${fmtDate(q.to)}`)
    let y = 96
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    const intro = doc.splitTextToSize(`This quarter ${data.company || 'your team'} bought ${data.rows.length} beyondGREEN item${data.rows.length > 1 ? 's' : ''}, made as an alternative to petroleum-based plastics. Here is what you bought by category and the certifications that cover each category.`, 532)
    doc.text(intro, 40, y); y += intro.length * 13 + 10
    y = table(doc, y, [{ h: 'Category', w: 150 }, { h: 'SKUs', w: 40, a: 'r' }, { h: 'Units (pieces)', w: 80, a: 'r' }, { h: 'Certifications covering this category', w: 262 }], data.categories.map((c: any) => [c.name, String(c.skus), c.pieces_known ? qty(c.pieces) : (c.pieces ? qty(c.pieces) + ' +' : 'See note'), c.certs.length ? c.certs.join('; ') : 'None listed']))
    y += 12
    doc.setFontSize(8)
    const notes = ['Certifications apply only to the exact items listed on each certificate. Ask us for the certificate for any single SKU.', 'Climate and carbon figures are not shown. We will add them once our life cycle assessment is complete.', data.missing?.length ? `Unit counts for ${data.missing.length} SKU(s) are still being converted from cases or packs and are not fully counted above.` : '']
    notes.filter(Boolean).forEach(n => { const w = doc.splitTextToSize(n, 532); doc.text(w, 40, y); y += w.length * 10 + 4 })
    doc.save(`beyondGREEN-impact-report-${q.label.replace(' ', '-')}.pdf`)
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className={labelCls}>Quarter</label><select className={inputCls + ' !w-auto'} value={i} onChange={e => setI(Number(e.target.value))}>{qs.map((q, k) => <option key={q.label} value={k}>{q.label}</option>)}</select></div>
        <button className={btnCls} style={{ background: GREEN }} onClick={make} disabled={busy}>{busy ? 'Building…' : 'Download impact report (PDF)'}</button>
      </div>
      {d && !d.rows?.length && <Empty>No orders in that quarter.</Empty>}
      {d?.missing?.length ? <Missing list={d.missing} /> : null}
      <p className="text-xs text-gray-500">Units by category and the certifications that cover them. Carbon and CO2 figures will be added after our life cycle assessment is finished.</p>
    </div>
  )
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return <section className={`${cardCls} p-4 sm:p-5`}><h2 className="text-base font-bold" style={{ color: INK }}>{title}</h2><p className="text-xs text-gray-500 mb-3">{sub}</p>{children}</section>
}

export default function ReportsPage() {
  return (
    <PortalShell title="Reports" subtitle="Stock we hold for you, EPR data for your filings and quarterly impact reports.">
      <div className="space-y-4">
        <Section title="Stock held for you" sub="Items we build ahead and warehouse for you at no charge. Request a release and we ship it.">
          <StockHeld />
        </Section>
        <Section title="SB 54 / EPR data export" sub="Each SKU you bought in a date range, with units, material type and weight per unit and in total.">
          <Epr />
        </Section>
        <Section title="Quarterly impact report" sub="Units purchased by category and the certifications that cover them.">
          <Impact />
        </Section>
      </div>
    </PortalShell>
  )
}
