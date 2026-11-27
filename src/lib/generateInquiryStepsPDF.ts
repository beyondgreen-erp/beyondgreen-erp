/* eslint-disable @typescript-eslint/no-explicit-any */
// "Your private label program: next steps" PDF for an inquiry reply. Built from the same form as the
// email, so the prices and steps in the attachment always match the email.
import jsPDF from 'jspdf'
import '@/lib/pdfSafeText'
import autoTable from 'jspdf-autotable'
import { type InquiryForm, CERTS, BPI_NOTE, buildSteps, specLines, tierRows, genRows, isBags, pricesForAlt, unitName, plural, money, money4, int } from './inquiryReply'

const GREEN: [number, number, number] = [27, 138, 58]
const INK: [number, number, number] = [31, 41, 55]
const GRAY: [number, number, number] = [107, 114, 128]

async function whiteLogo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const img = new Image()
    img.src = '/bG-logo.png'
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height)
    // Colored and black parts become white; the white "b" inside the green circle becomes see-through,
    // so the green header shows through it and the mark keeps its shape (a flat recolor made a solid white disc).
    for (let i = 0; i < d.data.length; i += 4) {
      const m = Math.min(d.data[i], d.data[i + 1], d.data[i + 2])
      const white = Math.max(0, (m - 150) / 105)
      d.data[i] = 255; d.data[i + 1] = 255; d.data[i + 2] = 255; d.data[i + 3] = Math.round(d.data[i + 3] * (1 - white))
    }
    g.putImageData(d, 0, 0)
    return { data: c.toDataURL('image/png'), w: c.width, h: c.height }
  } catch { return null }
}

export function stepsPdfName(f: InquiryForm) {
  const who = (f.brand || f.company || 'Customer').replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, ' ')
  return `${who} - ${isBags(f) ? 'Private Label Next Steps' : 'Project Next Steps'} - beyondGREEN.pdf`
}

export async function generateInquiryStepsPDF(f: InquiryForm, opts: { download?: boolean } = {}): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 40, R = W - 40
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const un = unitName(f)

  const header = async () => {
    doc.setFillColor(...GREEN); doc.rect(0, 0, W, 78, 'F')
    const logo = await whiteLogo()
    if (logo) doc.addImage(logo.data, 'PNG', L, 18, 42 * (logo.w / logo.h), 42)
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
    doc.text(isBags(f) ? 'YOUR PRIVATE LABEL PROGRAM' : 'YOUR PROJECT WITH US', R, 38, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.text(`Next steps to launch  |  ${today}`, R, 56, { align: 'right' })
  }
  const footer = () => {
    const pages = doc.getNumberOfPages()
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      doc.setDrawColor(...GREEN); doc.setLineWidth(1.5); doc.line(L, H - 42, R, H - 42)
      doc.setFontSize(8); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal')
      doc.text('beyondGREEN biotech, Inc.  |  1202 E. Wakeham Ave., Santa Ana, CA 92705', L, H - 28)
      doc.text(`(866) 364-9466  |  beyondgreenbiotech.com  |  Page ${p} of ${pages}`, R, H - 28, { align: 'right' })
    }
  }
  const section = (title: string, y: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GREEN)
    doc.text(title.toUpperCase(), L, y)
    return y + 8
  }

  await header()
  let y = 104
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(`Prepared for ${[f.contactFull || f.contactFirst, f.company].filter(Boolean).join(', ')}${f.brand && f.brand !== f.company ? ` (${f.brand})` : ''}`, L, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GRAY)
  y += 15
  doc.text([`Prepared by ${f.preparedBy || 'the beyondGREEN team'}`, f.quoteNumber ? `Quote ${f.quoteNumber}` : '', f.launch ? `Your launch timing: ${f.launch}` : ''].filter(Boolean).join('   |   '), L, y)
  y += 22

  // What you asked for
  y = section('What you asked for', y)
  autoTable(doc, {
    startY: y, margin: { left: L, right: L }, theme: 'grid', body: specLines(f),
    styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: [225, 229, 234] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 140, fillColor: [244, 248, 244] } },
  })
  y = (doc as any).lastAutoTable.finalY + 20

  // Pricing
  const gen = !isBags(f) ? genRows(f).filter(r => r.price != null) : []
  if (!isBags(f)) {
    y = section('Pricing', y)
    const t = f.tooling
    if (gen.length) {
      autoTable(doc, {
        startY: y, margin: { left: L, right: L }, theme: 'grid', head: [['Quantity', `Price per ${un}`, 'Total']],
        body: [...(pricesForAlt(f) ? [[{ content: `Stock option: ${f.alternative.trim()}`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [247, 247, 247] } } as any]] : []), ...gen.map(r => [`${int(r.qty)} ${plural(un, r.qty)}`, money4(r.price!), money(r.total!)]),
          ...(t?.needed && Number(t.cost) > 0 ? [[`${t.kind || 'Tooling'} (one time)`, '', money(Number(t.cost), 0)]] : [])],
        styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: [225, 229, 234] },
        headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
      })
      y = (doc as any).lastAutoTable.finalY + 12
    }
    doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal')
    const notes = [gen.length ? `Prices are ${f.basis}. ${f.freightNote}` : `Pricing follows once the details are confirmed. ${f.freightNote}`]
    if (t?.needed) notes.push(`${t.kind || 'Tooling'}: ${Number(t.cost) > 0 ? `${money(Number(t.cost), 0)} one time` : 'quoted separately'}${t.moq ? `, minimum run ${t.moq}` : ''}${t.leadTime ? `, about ${t.leadTime} to make` : ''}.`)
    if (pricesForAlt(f)) notes.push('The prices above are for our stock option. Pricing for your custom item comes with the tooling quote.')
    else if (f.alternative.trim()) notes.push(`Also available now: ${f.alternative.trim()}.`)
    const wrapped = doc.splitTextToSize(notes.join(' '), R - L)
    doc.text(wrapped, L, y); y += wrapped.length * 11 + 14
  }
  const rows = isBags(f) ? tierRows(f) : []
  if (rows.length) {
    y = section('Pricing', y)
    const showRoll = rows.some(r => r.pricePerRoll != null), showPkg = rows.some(r => r.packagingEach != null), showDisp = rows.some(r => r.dispenserQty > 0)
    const head = ['Order size', 'Bags', showRoll ? 'Per roll' : 'Per bag', ...(showPkg ? [`Packaging per ${un}`] : []), `Per ${un}`, ...(showDisp ? ['Dispensers'] : []), 'Order total']
    autoTable(doc, {
      startY: y, margin: { left: L, right: L }, theme: 'grid', head: [head],
      body: rows.map(r => [`${int(r.units)} ${plural(un, r.units)}`, int(r.bags), showRoll ? money4(r.pricePerRoll || 0) : money4(r.pricePerBag),
        ...(showPkg ? [r.packagingEach != null ? money(r.packagingEach) : 'TBC'] : []), money(r.pricePerUnit),
        ...(showDisp ? [r.dispenserQty ? `${int(r.dispenserQty)} x ${money(r.dispenserTotal / r.dispenserQty)}` : ''] : []), money(r.total)]),
      styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: [225, 229, 234] },
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
    })
    y = (doc as any).lastAutoTable.finalY + 12
    doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal')
    const notes = [`Prices are ${f.basis}. ${f.freightNote}`]
    if (rows.some(r => r.packagingEach == null) && f.packaging !== 'Bulk case (no retail packaging)') notes.push('Packaging cost is confirmed once we have your final artwork.')
    if (f.bagPrint === '1 color print' && Number(f.plateCharge) > 0) notes.push(`Bag printing has a one-time plate charge of ${money(Number(f.plateCharge))} per design.`)
    if (Number(f.moldCost) > 0) notes.push(`Dispenser mold: ${money(Number(f.moldCost), 0)} one time, and the mold is your property.`)
    const wrapped = doc.splitTextToSize(notes.join(' '), R - L)
    doc.text(wrapped, L, y); y += wrapped.length * 11 + 14
  }

  // Steps
  if (y > H - 220) { doc.addPage(); await header(); y = 104 }
  y = section('Your steps to launch', y)
  const steps = buildSteps(f)
  autoTable(doc, {
    startY: y, margin: { left: L, right: L }, theme: 'plain',
    head: [['', 'Step', 'Who', 'What happens', 'Status']],
    body: steps.map((s, i) => [String(i + 1), s.title, s.who, s.detail, s.status === 'done' ? 'Done' : s.status === 'next' ? 'Next' : 'Coming up']),
    styles: { fontSize: 9, cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }, textColor: INK, valign: 'top' },
    headStyles: { textColor: GRAY, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 0: { cellWidth: 18, fontStyle: 'bold', textColor: GREEN }, 1: { cellWidth: 112, fontStyle: 'bold' }, 2: { cellWidth: 70 }, 4: { cellWidth: 62, fontStyle: 'bold' } },
    didParseCell: (d: any) => {
      if (d.section === 'body' && d.column.index === 4) {
        const v = d.cell.raw
        d.cell.styles.textColor = v === 'Done' ? GREEN : v === 'Next' ? [180, 83, 9] : GRAY
      }
    },
    didDrawCell: (d: any) => {
      if (d.section === 'body' && d.column.index === 0) { doc.setDrawColor(230, 233, 237); doc.setLineWidth(0.5); doc.line(L, d.cell.y + d.row.height, R, d.cell.y + d.row.height) }
    },
  })
  y = (doc as any).lastAutoTable.finalY + 20

  // Certifications
  const certs = CERTS.filter(c => f.certs.includes(c.key))
  if (certs.length) {
    if (y > H - 150) { doc.addPage(); await header(); y = 104 }
    y = section(isBags(f) ? 'Certifications' : 'Certifications and documents', y)
    doc.setFontSize(9); doc.setTextColor(...INK); doc.setFont('helvetica', 'normal')
    for (const c of certs) { doc.setFont('helvetica', 'bold'); doc.text(c.label, L, y + 4); doc.setFont('helvetica', 'normal'); doc.text(c.detail, L + 200, y + 4); y += 14 }
    doc.setFontSize(8.5); doc.setTextColor(...GRAY)
    if (isBags(f)) {
      const t = doc.splitTextToSize(`${BPI_NOTE} Compostability claims on your packaging are covered by our Private Label Environmental Compliance Agreement.`, R - L)
      doc.text(t, L, y + 8); y += t.length * 11 + 14
    } else y += 8
  }

  // Contact
  if (y > H - 90) { doc.addPage(); await header(); y = 104 }
  doc.setFontSize(9.5); doc.setTextColor(...INK)
  doc.text(`Questions at any step: ${f.preparedBy || 'beyondGREEN'}, (866) 364-9466.`, L, y + 6)

  footer()
  const blob = doc.output('blob')
  if (opts.download) doc.save(stepsPdfName(f))
  return blob
}
