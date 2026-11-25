/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HTML for the Civil Doody daily order report email. Pure function, no imports, so it can be rendered
 * anywhere. Table-based layout with inline styles so it holds up in Outlook, Gmail and Apple Mail.
 * Nothing in it points at the ERP: the logo is served from the public storefront, and there are no links.
 */
const GREEN = '#00A84F'
const DARK = '#0B3D2E'
const INK = '#1A1D2E'
const MUTED = '#6B7280'
const LINE = '#E5E7EB'
const LOGO = 'https://byndgrn.com/cdn/shop/files/beyondGREEN_biotech_New_Logo.jpg?v=1782759037&width=480'
const FONT = "Arial,Helvetica,sans-serif"

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const TZ = 'America/Los_Angeles'
const day = (d: string) => new Date(d).toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' })
const shortDay = (d: string) => new Date(d).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' })
const dayTime = (d: string) => new Date(d).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function table(heads: string[], rows: string[][], widths?: string[]) {
  const th = `font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;color:#4B5563;text-align:left;padding:9px 10px;background:#F3F6F4;border-bottom:2px solid ${GREEN}`
  const td = (i: number) => `font-family:${FONT};font-size:13px;line-height:18px;color:${INK};padding:9px 10px;border-bottom:1px solid ${LINE};vertical-align:top;background:${i % 2 ? '#FAFBFA' : '#FFFFFF'}`
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid ${LINE}">
<tr>${heads.map((h, i) => `<th${widths?.[i] ? ` width="${widths[i]}"` : ''} style="${th}${widths?.[i] ? `;width:${/^\d+$/.test(widths[i]) ? widths[i] + 'px' : widths[i]};min-width:${/^\d+$/.test(widths[i]) ? widths[i] + 'px' : '130px'}` : ''}">${h}</th>`).join('')}</tr>
${rows.map((r, i) => `<tr>${r.map(c => `<td style="${td(i)}">${c}</td>`).join('')}</tr>`).join('\n')}
</table>`
}
const section = (title: string, count: number | null, body: string) => `<tr><td style="padding:26px 32px 0 32px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="font-family:${FONT};font-size:16px;font-weight:bold;color:${DARK};padding-bottom:10px">${title}${count === null ? '' : ` <span style="font-weight:normal;color:${MUTED}">(${count})</span>`}</td>
</tr></table>
${body}
</td></tr>`
const note = (t: string) => `<p style="font-family:${FONT};font-size:13px;line-height:19px;color:${MUTED};margin:0;padding:12px 14px;background:#F9FAFB;border:1px solid ${LINE}">${t}</p>`
const tile = (value: string | number, label: string, color: string) => `<td width="25%" style="padding:0 5px" valign="top">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid ${LINE};border-top:4px solid ${color};background:#FFFFFF"><tr><td height="78" valign="top" style="height:78px;padding:14px 10px 12px 14px">
<div style="font-family:${FONT};font-size:26px;line-height:30px;font-weight:bold;color:${INK}">${value}</div>
<div style="font-family:${FONT};font-size:11px;line-height:15px;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding-top:2px">${label}</div>
</td></tr></table></td>`

export function reportEmail(run: any, opts: { preview?: boolean; test?: boolean } = {}) {
  const testing = run.target === 'test'
  const tag = opts.test ? '[TEST] ' : opts.preview ? '[PREVIEW] ' : ''
  const subject = `${tag}Civil Doody Daily Order Report, ${shortDay(run.ran_at)}${testing ? ' (testing database)' : ''}`
  const p = run.pulled || {}
  const t = run.totals || {}
  const newO: any[] = run.new_orders || [], ship: any[] = run.shipments || [], prob: any[] = run.problems || []

  // New orders: a count by item first, then the order list (capped so a busy day stays readable).
  const byItem = new Map<string, number>()
  for (const o of newO) for (const part of String(o.items || '').split(', ')) {
    const m = part.match(/^(\d+(?:\.\d+)?) x (.+)$/); if (!m) continue
    byItem.set(m[2], (byItem.get(m[2]) || 0) + Number(m[1]))
  }
  const itemRows = Array.from(byItem.entries()).sort((a, b) => b[1] - a[1]).map(([name, q]) => [esc(name), `<b>${q.toLocaleString('en-US')}</b>`])
  const CAP = 25
  const orderRows = newO.slice(0, CAP).map(o => [`<b style="white-space:nowrap">${esc(o.order)}</b>`, esc(o.sale_order), esc(o.customer), esc(o.items), `<span style="white-space:nowrap">${esc(o.status)}</span>`])

  const banner = opts.test
    ? `<tr><td style="padding:0 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-family:${FONT};font-size:14px;line-height:20px;color:#7A4B00;background:#FFF6E0;border:1px solid #F2C94C;border-left:5px solid #F2A900;padding:12px 16px"><b>This is a test email.</b> We are testing the automated daily report between the Civil Doody Odoo store and beyondGREEN. The orders below are test orders from the Odoo testing database. No action is needed.</td></tr></table></td></tr><tr><td style="height:18px;line-height:18px;font-size:0">&nbsp;</td></tr>`
    : testing
      ? `<tr><td style="padding:0 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-family:${FONT};font-size:13px;line-height:19px;color:#7A4B00;background:#FFF6E0;border:1px solid #F2C94C;border-left:5px solid #F2A900;padding:10px 16px"><b>Testing database.</b> The orders in this report are test orders, not real customers.</td></tr></table></td></tr><tr><td style="height:18px;line-height:18px;font-size:0">&nbsp;</td></tr>`
      : ''

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF2EF">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#EEF2EF"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0" style="width:720px;max-width:100%;background:#FFFFFF;border:1px solid #DDE3DF">
<tr><td style="height:6px;line-height:6px;font-size:0;background:${GREEN}">&nbsp;</td></tr>
<tr><td style="padding:24px 32px 20px 32px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td valign="middle"><img src="${LOGO}" width="170" alt="beyondGREEN biotech" style="display:block;border:0;width:170px;height:auto"></td>
<td valign="middle" align="right" style="font-family:${FONT}">
<div style="font-size:20px;line-height:26px;font-weight:bold;color:${DARK}">Daily Order Report</div>
<div style="font-size:13px;line-height:19px;color:${MUTED}">Civil Doody &nbsp;|&nbsp; ${esc(day(run.ran_at))}</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 32px"><div style="height:1px;line-height:1px;font-size:0;background:${LINE}">&nbsp;</div></td></tr>
<tr><td style="height:20px;line-height:20px;font-size:0">&nbsp;</td></tr>
${banner}
<tr><td style="padding:0 32px;font-family:${FONT};font-size:14px;line-height:22px;color:${INK}">
<p style="margin:0 0 10px 0">Hi Shannan,</p>
<p style="margin:0">Here is the daily order report between the Civil Doody Odoo store and beyondGREEN. It shows the orders we received from Odoo and the shipments we sent back, with carrier and tracking.</p>
</td></tr>
<tr><td style="padding:22px 27px 0 27px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
${tile(newO.length.toLocaleString('en-US'), 'New orders received', GREEN)}
${tile(ship.length.toLocaleString('en-US'), 'Shipments sent to Odoo', '#0086C0')}
${tile((t.to_pack ?? 0).toLocaleString('en-US'), 'Ready to pack', '#F2A900')}
${tile(((t.on_hold ?? 0) + (t.waiting_on_stock ?? 0)).toLocaleString('en-US'), 'On hold or waiting on stock', '#8A8F98')}
</tr></table>
</td></tr>
${section('Shipments sent back to Odoo', ship.length, ship.length
    ? table(['Odoo delivery', 'Sale order', 'Customer', 'Shipped', 'Carrier', 'Tracking number', 'Ship date'],
      ship.map(s => [`<b style="white-space:nowrap">${esc(s.order)}</b>`, esc(s.sale_order), esc(s.customer), esc(s.items) + (s.partial ? `<br><span style="color:#B45309;font-size:12px">Partial shipment, backorder open</span>` : ''), esc(s.carrier), `<span style="font-family:Consolas,Menlo,monospace;font-size:12px;white-space:nowrap">${esc(s.tracking)}</span>`, s.shipped_at ? `<span style="white-space:nowrap">${esc(shortDay(s.shipped_at))}</span>` : '']), ['', '', '', '30%', '', '', ''])
    : note('No shipments since the last report.'))}
${section('New orders received from Odoo', newO.length, newO.length
    ? table(['Item', 'Quantity ordered'], itemRows, ['', '150'])
      + `<div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>`
      + table(['Odoo delivery', 'Sale order', 'Customer', 'Items', 'Status'], orderRows)
      + (newO.length > CAP ? `<p style="font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};margin:8px 0 0 0">Showing the first ${CAP} of ${newO.length.toLocaleString('en-US')} new orders. All of them are counted in the item totals above.</p>` : '')
    : note('No new orders since the last report.'))}
${prob.length ? section('Needs attention', prob.length, table(['Item', 'Detail'], prob.map(x => [esc(x.what), esc(x.detail)]))) : ''}
${section('Order status', null, table(['Open orders in Odoo', 'Ready to pack', 'On hold (pre-orders)', 'Waiting on stock', 'Shipped to date'],
    [[run.pulled ? esc(Number(p.open_in_odoo || 0).toLocaleString('en-US')) : 'Not available', String(t.to_pack ?? 0), String(t.on_hold ?? 0), String(t.waiting_on_stock ?? 0), String(t.shipped ?? 0)]]))}
<tr><td style="padding:26px 32px 0 32px;font-family:${FONT};font-size:14px;line-height:22px;color:${INK}">
<p style="margin:0 0 10px 0">Please reply to this email with any questions and it will reach Rudy Patel directly.</p>
<p style="margin:0">Thank you,<br><b>beyondGREEN biotech</b></p>
</td></tr>
<tr><td style="height:26px;line-height:26px;font-size:0">&nbsp;</td></tr>
<tr><td style="background:${DARK};padding:18px 32px;font-family:${FONT};font-size:12px;line-height:18px;color:#CFE3D8">
<b style="color:#FFFFFF">beyondGREEN biotech, Inc.</b><br>
1202 E. Wakeham Ave., Santa Ana, CA 92705 &nbsp;|&nbsp; (866) 364-9466 &nbsp;|&nbsp; beyondgreenbiotech.com<br>
<span style="color:#9DBFAE">Automated report generated ${esc(dayTime(run.ran_at))} Pacific. Covers activity since ${esc(dayTime(run.period_start || run.ran_at))} Pacific.</span>
</td></tr>
</table>
</td></tr></table>
</body></html>`
  return { subject, html }
}
