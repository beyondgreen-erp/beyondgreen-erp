// Opens print-ready browser windows for case labels, pallet labels, and BOL.
// Each window loads JsBarcode from CDN, renders barcodes, then auto-calls window.print().

export interface ShipAddress {
  name: string
  address1?: string
  address2?: string
  city?: string
  state?: string
  zip?: string
}

export interface CaseLabelPage {
  sku: string
  productName: string
  upc: string
  caseQty: number
  uom: string
  caseNumber: number
  totalCases: number
}

export interface CaseLabelData {
  shipTo: ShipAddress
  poNumber?: string
  orderNumber?: string
  labels: CaseLabelPage[]
}

export interface PalletLine {
  sku: string
  productName: string
  cases: number
  weightLbs: number
}

export interface PalletInfo {
  palletNumber: number
  totalPallets: number
  palletId: string
  lines: PalletLine[]
  totalCases: number
  totalWeightLbs: number
}

export interface PalletLabelData {
  shipTo: ShipAddress
  orderNumber?: string
  poNumber?: string
  pallets: PalletInfo[]
}

export interface BOLLine {
  palletNumber: number
  cases: number
  sku: string
  description: string
  weightLbs: number
}

export interface BOLData {
  shipTo: ShipAddress
  orderNumber?: string
  poNumber?: string
  carrierName?: string
  trailerNumber?: string
  proNumber?: string
  shipDate?: string
  freightValue?: number
  lines: BOLLine[]
  totalWeight: number
  totalCases: number
  totalPallets: number
}

const BC_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function addrBlock(a: ShipAddress): string {
  const parts = [
    a.address1 && `<div class="adr">${esc(a.address1)}</div>`,
    a.address2 && `<div class="adr">${esc(a.address2)}</div>`,
    [a.city, a.state, a.zip].filter(Boolean).length > 0 &&
      `<div class="adr">${esc([a.city, a.state, a.zip].filter(Boolean).join(', '))}</div>`,
  ].filter(Boolean)
  return parts.join('')
}

function openWindow(html: string, w = 520, h = 740) {
  const win = window.open('', '_blank', `width=${w},height=${h}`)
  if (win) { win.document.write(html); win.document.close() }
}

// ── Case Labels ────────────────────────────────────────────────────────────────

export function generateCaseLabels(data: CaseLabelData): void {
  const pages = data.labels.map(L => `
<div class="page">
  <div class="head">
    <div class="hname">beyondGREEN Biotech, Inc.</div>
    <div class="haddr">1202 E. Wakeham Ave., Santa Ana, CA 92705</div>
  </div>
  <hr/>
  <div class="sec">
    <div class="slbl">SHIP TO</div>
    <div class="sname">${esc(data.shipTo.name)}</div>
    ${addrBlock(data.shipTo)}
  </div>
  <hr/>
  <div class="pname">${esc(L.productName)}</div>
  <div class="pmeta">SKU: <b>${esc(L.sku)}</b>&nbsp;&nbsp;|&nbsp;&nbsp;Case Qty: <b>${L.caseQty} ${esc(L.uom)}</b></div>
  <hr/>
  <div class="bcwrap"><svg data-bc="${esc(L.upc || L.sku)}"></svg></div>
  <div class="upcnum">${esc(L.upc)}</div>
  <hr/>
  <div class="foot">
    <span><b>Case ${L.caseNumber} of ${L.totalCases}</b></span>
    <span>${data.poNumber ? `PO: ${esc(data.poNumber)}` : ''}${data.orderNumber ? (data.poNumber ? ' | ' : '') + esc(data.orderNumber) : ''}</span>
  </div>
</div>`).join('\n')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Case Labels — ${esc(data.orderNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,'Arial Narrow',sans-serif;background:#fff}
@page{size:4in 6in;margin:0}
.page{width:4in;height:6in;padding:.18in .22in;display:flex;flex-direction:column;page-break-after:always;overflow:hidden}
.head{text-align:center;padding-bottom:3px}
.hname{font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.3px}
.haddr{font-size:8px;color:#555;margin-top:1px}
hr{border:none;border-top:1.5px solid #111;margin:5px 0}
.sec{margin:2px 0}
.slbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#777;margin-bottom:2px}
.sname{font-size:17px;font-weight:700;line-height:1.2}
.adr{font-size:11px;color:#333;line-height:1.5}
.pname{font-size:14px;font-weight:700;line-height:1.3;margin:3px 0 2px}
.pmeta{font-size:10px;color:#444}
.bcwrap{display:flex;justify-content:center;flex:1;align-items:center}
.bcwrap svg{max-width:100%}
.upcnum{text-align:center;font-size:9px;font-family:'Courier New',monospace;color:#555;margin-top:1px}
.foot{display:flex;justify-content:space-between;font-size:9px;font-weight:700;margin-top:3px}
</style></head><body>
${pages}
<script src="${BC_CDN}"></script>
<script>
window.onload=function(){
  document.querySelectorAll('[data-bc]').forEach(function(el){
    var v=el.getAttribute('data-bc');if(!v)return;
    try{JsBarcode(el,v,{format:'CODE128',width:1.8,height:58,displayValue:false,margin:4,background:'#fff',lineColor:'#000'});}catch(err){}
  });
  setTimeout(function(){window.print();},400);
};
</script></body></html>`

  openWindow(html)
}

// ── Pallet Labels ──────────────────────────────────────────────────────────────

export function generatePalletLabels(data: PalletLabelData): void {
  const pages = data.pallets.map(P => {
    const rows = P.lines.map(l =>
      `<tr><td>${esc(l.sku)}</td><td style="text-align:center">${l.cases}</td><td style="text-align:right">${l.weightLbs.toFixed(1)}</td></tr>`
    ).join('')
    return `
<div class="page">
  <div class="head">
    <div class="hname">beyondGREEN Biotech, Inc.</div>
    <div class="hsub">PALLET LABEL</div>
  </div>
  <hr/>
  <div class="sec">
    <div class="slbl">SHIP TO</div>
    <div class="sname">${esc(data.shipTo.name)}</div>
    ${addrBlock(data.shipTo)}
  </div>
  <hr/>
  <div class="pnum">Pallet ${P.palletNumber} of ${P.totalPallets}</div>
  <div class="ptot"><b>${P.totalCases}</b> cases &bull; <b>${P.totalWeightLbs.toFixed(0)} lbs</b></div>
  <table>
    <thead><tr><th>SKU</th><th style="text-align:center">Cases</th><th style="text-align:right">Lbs</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr/>
  <div class="bcwrap"><svg data-bc="${esc(P.palletId)}"></svg></div>
  <div class="pid">${esc(P.palletId)}</div>
  <hr/>
  <div class="foot">
    <span>${data.orderNumber ? esc(data.orderNumber) : ''}</span>
    <span>${data.poNumber ? 'PO: ' + esc(data.poNumber) : ''}</span>
  </div>
</div>`
  }).join('\n')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Pallet Labels — ${esc(data.orderNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#fff}
@page{size:4in 6in;margin:0}
.page{width:4in;height:6in;padding:.18in .22in;display:flex;flex-direction:column;page-break-after:always;overflow:hidden}
.head{text-align:center}
.hname{font-weight:700;font-size:11px;text-transform:uppercase}
.hsub{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:2px}
hr{border:none;border-top:1.5px solid #111;margin:5px 0}
.sec{margin:2px 0}
.slbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#777;margin-bottom:1px}
.sname{font-size:13px;font-weight:700;line-height:1.2}
.adr{font-size:10px;color:#333;line-height:1.4}
.pnum{font-size:24px;font-weight:700;text-align:center;margin:3px 0}
.ptot{font-size:11px;text-align:center;margin-bottom:3px}
table{width:100%;border-collapse:collapse;font-size:9px}
th{background:#222;color:#fff;padding:2px 4px;font-size:8px;text-transform:uppercase;text-align:left}
td{padding:2px 4px;border-bottom:1px solid #eee}
.bcwrap{display:flex;justify-content:center;flex:1;align-items:center}
.bcwrap svg{max-width:100%}
.pid{text-align:center;font-size:9px;font-family:'Courier New',monospace;color:#555}
.foot{display:flex;justify-content:space-between;font-size:9px;font-weight:700;margin-top:3px}
</style></head><body>
${pages}
<script src="${BC_CDN}"></script>
<script>
window.onload=function(){
  document.querySelectorAll('[data-bc]').forEach(function(el){
    var v=el.getAttribute('data-bc');if(!v)return;
    try{JsBarcode(el,v,{format:'CODE128',width:1.8,height:48,displayValue:false,margin:4,background:'#fff',lineColor:'#000'});}catch(err){}
  });
  setTimeout(function(){window.print();},400);
};
</script></body></html>`

  openWindow(html)
}

// ── Bill of Lading (8.5" × 11") ───────────────────────────────────────────────

export function generateBOL(data: BOLData): void {
  const rows = data.lines.map(l => `
<tr>
  <td style="text-align:center">${l.palletNumber}</td>
  <td style="text-align:center">${l.cases}</td>
  <td>${esc(l.sku)}</td>
  <td>${esc(l.description)}</td>
  <td style="text-align:right">${l.weightLbs.toFixed(0)} lbs</td>
</tr>`).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Bill of Lading — ${esc(data.orderNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;background:#fff;color:#000;padding:.5in}
@page{size:8.5in 11in;margin:.5in}
h1{font-size:22px;text-align:center;letter-spacing:2px;margin-bottom:4px;text-transform:uppercase}
.sub{text-align:center;font-size:10px;color:#555;margin-bottom:16px;border-bottom:2px solid #000;padding-bottom:8px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}
.box{border:1.5px solid #999;padding:8px 10px}
.bt{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#666;margin-bottom:3px}
.bn{font-size:14px;font-weight:700}
.ba{font-size:11px;color:#333;line-height:1.6;margin-top:2px}
.ir{display:flex;gap:14px;margin-bottom:12px;flex-wrap:wrap}
.ii{flex:1;min-width:80px}
.il{font-size:8px;text-transform:uppercase;color:#999;font-weight:700}
.iv{font-size:12px;font-weight:700;border-bottom:1px solid #bbb;padding-bottom:2px;min-height:20px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th{background:#1a1a1a;color:#fff;padding:5px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:left}
td{padding:5px 8px;border-bottom:1px solid #ddd;font-size:11px}
.tf td{font-weight:700;border-top:2px solid #000;border-bottom:2px solid #000}
.note{font-size:8.5px;color:#444;border:1px solid #ccc;padding:8px;margin:12px 0;line-height:1.5}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}
.sl{border-top:1.5px solid #000;padding-top:5px;font-size:9px;color:#555}
.fbox{border:1.5px solid #222;padding:8px 12px;margin-bottom:12px}
</style></head><body>
<h1>Bill of Lading</h1>
<div class="sub">beyondGREEN Biotech, Inc. &nbsp;|&nbsp; 1202 E. Wakeham Ave., Santa Ana, CA 92705 &nbsp;|&nbsp; Ship Date: ${esc(data.shipDate ?? new Date().toLocaleDateString())}</div>
<div class="g2">
  <div class="box">
    <div class="bt">Shipper / From</div>
    <div class="bn">beyondGREEN Biotech, Inc.</div>
    <div class="ba">1202 E. Wakeham Ave.<br/>Santa Ana, CA 92705</div>
  </div>
  <div class="box">
    <div class="bt">Consignee / Ship To</div>
    <div class="bn">${esc(data.shipTo.name)}</div>
    <div class="ba">
      ${data.shipTo.address1 ? esc(data.shipTo.address1) + '<br/>' : ''}
      ${data.shipTo.address2 ? esc(data.shipTo.address2) + '<br/>' : ''}
      ${esc([data.shipTo.city, data.shipTo.state, data.shipTo.zip].filter(Boolean).join(', '))}
    </div>
  </div>
</div>
<div class="ir">
  <div class="ii"><div class="il">Order #</div><div class="iv">${esc(data.orderNumber ?? '')}</div></div>
  <div class="ii"><div class="il">PO Number</div><div class="iv">${esc(data.poNumber ?? '')}</div></div>
  <div class="ii"><div class="il">Carrier</div><div class="iv">${esc(data.carrierName ?? '')}</div></div>
  <div class="ii"><div class="il">Trailer #</div><div class="iv">${esc(data.trailerNumber ?? '')}</div></div>
  <div class="ii"><div class="il">PRO #</div><div class="iv">${esc(data.proNumber ?? '')}</div></div>
  <div class="ii"><div class="il">Total Pallets</div><div class="iv">${data.totalPallets}</div></div>
</div>
<table>
  <thead><tr><th>Pallet #</th><th style="text-align:center"># Cases</th><th>SKU</th><th>Description</th><th style="text-align:right">Weight</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="tf">
    <td></td>
    <td style="text-align:center">${data.totalCases}</td>
    <td></td>
    <td>TOTAL</td>
    <td style="text-align:right">${data.totalWeight.toFixed(0)} lbs</td>
  </tr></tfoot>
</table>
${data.freightValue ? `<div class="fbox"><b>Declared Freight Value:</b> $${data.freightValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : ''}
<div class="note"><b>RECEIVED, subject to individually determined rates or contracts that have been agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications, and rules that have been established by the carrier and are available to the shipper on request and all applicable state and federal regulations.</b></div>
<div class="sg">
  <div><div class="sl">Shipper Signature &amp; Date</div><div style="margin-top:6px;font-size:9px;color:#777">beyondGREEN Biotech, Inc.</div></div>
  <div><div class="sl">Carrier / Driver Signature &amp; Date</div><div style="margin-top:6px;font-size:9px;color:#777">${esc(data.carrierName ?? 'Carrier')}</div></div>
</div>
</body></html>`

  openWindow(html, 950, 800)
}
