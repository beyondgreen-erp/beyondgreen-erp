/* eslint-disable @typescript-eslint/no-explicit-any */
// Per-product compliance packs for the website and the client portal.
// The team maps Documents & Knowledge files to product families in site_compliance_docs
// (with each certificate's expiry). A pack = one ZIP: a cover sheet PDF plus every
// current file for that family. Expired certificates are left out and listed on the cover.
import { createHash } from 'crypto'
import { jsPDF } from 'jspdf'
import { admin, notifyTeam, sendEmail, esc, likeExact, NOTIFY_SIGNUPS } from '@/lib/portalServer'
import { buildZip } from '@/lib/siteTemplates'

const DOC_BUCKET = 'erp-files'
const PACK_BUCKET = 'site-templates'
export const BPI_DIRECTORY = 'https://products.bpiworld.org/companies/beyondgreen-biotech-inc'
const today = () => new Date().toISOString().slice(0, 10)

// ── SKU → family (used by the portal to show packs for what a customer bought) ──
export function familyOfProduct(p: { sku?: string | null; product_name?: string | null; product_category?: string | null; category?: string | null }): string | null {
  const sku = String(p.sku || '').toUpperCase(), name = String(p.product_name || '').toLowerCase(), cat = String(p.product_category || p.category || '').toUpperCase()
  if (/^NK\d/.test(sku) || /kraft|paper bag/.test(name)) return 'kraft-paper-bags'
  if (cat === 'CUTLERY' || /cutlery|fork|knife|spoon|spork/.test(name)) return /kit|set|wrapped|napkin/.test(name) ? 'cutlery-kits' : 'cutlery'
  if (/straw|stirrer/.test(name) || /^STR/.test(sku)) return /bendy|flex/.test(name) ? 'bendy-straws' : 'straws'
  if (/cup|lid/.test(name) || /PCAC|PCLD|PCSLD/.test(sku)) return 'cups'
  if (cat === 'BAGS' || /bag|liner/.test(name)) {
    if (/litter/.test(name)) return 'cat-litter-bags'
    if (/dog|pet|poop|waste pick|doggie/.test(name)) return 'pet-waste-bags'
    if (/liner|trash|gallon|kitchen/.test(name)) return 'trash-liners'
    return 'film-bags'
  }
  return null
}

// Material used for SB 54 / EPR reporting when products.epr_material is blank.
export const FAMILY_MATERIAL: Record<string, string> = {
  cutlery: 'Compostable plastic (BASF ecovio blend)', 'cutlery-kits': 'Compostable plastic (cutlery) with compostable film wrap',
  straws: 'Compostable plastic (BASF ecovio FS 1606)', 'bendy-straws': 'Compostable plastic (BASF ecovio)',
  'film-bags': 'Compostable plastic film (BASF ecovio)', 'trash-liners': 'Compostable plastic film (BASF ecovio)',
  'pet-waste-bags': 'Compostable plastic film (BASF ecovio)', 'cat-litter-bags': 'Compostable plastic film (BASF ecovio)',
  cups: 'Paper, aqueous coated', 'kraft-paper-bags': 'Paper (kraft)',
}

export async function listFamilies(withDocs = true) {
  const { data: fams } = await admin.from('site_compliance_families').select('*').eq('is_active', true).order('sort')
  if (!withDocs) return (fams || []) as any[]
  const { data: docs } = await admin.from('site_compliance_docs').select('family_key, label, kind, covers, expires, sort').eq('is_active', true).order('sort')
  const t = today()
  return ((fams || []) as any[]).map(f => {
    const mine = ((docs || []) as any[]).filter(d => d.family_key === f.key)
    return {
      key: f.key, name: f.name, made_in: f.made_in, covers: f.covers, note: f.note,
      documents: mine.filter(d => !d.expires || d.expires >= t).map(d => ({ label: d.label, kind: d.kind, covers: d.covers, expires: d.expires })),
      on_request: [...mine.filter(d => d.expires && d.expires < t).map(d => `${d.label} (renewal on request)`), ...((f.missing || []) as string[])],
    }
  })
}

async function fileFor(docId: string, sourcePath: string | null): Promise<{ path: string; name: string } | null> {
  const { data: att } = await admin.from('file_attachments').select('storage_path, file_name').eq('record_type', 'documents').eq('record_id', docId).order('created_at', { ascending: false }).limit(1)
  const a = (att || [])[0] as any
  if (a?.storage_path) return { path: a.storage_path, name: a.file_name || a.storage_path.split('/').pop() }
  if (sourcePath) return { path: sourcePath, name: sourcePath.split('/').pop() || 'document.pdf' }
  return null
}
const clean = (s: string) => s.replace(/[^\w .()+-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)

function coverPdf(f: any, included: any[], onRequest: string[]): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, M = 48
  doc.setFillColor(3, 127, 76); doc.rect(0, 0, W, 76, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('beyondGREEN compliance pack', M, 38)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(`${f.name}  |  Prepared ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, M, 58)
  doc.setTextColor(26, 29, 46)
  let y = 104
  const para = (t: string, size = 10, bold = false, gap = 6) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); const lines = doc.splitTextToSize(t, W - 2 * M); if (y + lines.length * size * 1.3 > 740) { doc.addPage(); y = 56 } doc.text(lines, M, y); y += lines.length * size * 1.3 + gap }
  para('Items covered', 12, true, 2); para(f.covers || f.name)
  if (f.note) { para('Read first', 12, true, 2); para(f.note) }
  para('In this pack', 12, true, 2)
  if (!included.length) para('No files are attached yet for this item. Contact us and we will send them.')
  included.forEach((d, i) => para(`${i + 1}. ${d.label}${d.covers ? `. Covers: ${d.covers}` : ''}${d.expires ? `. Valid to ${new Date(d.expires + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`, 10, false, 3))
  if (onRequest.length) { y += 4; para('Available on request', 12, true, 2); onRequest.forEach(t => para(`- ${t}`, 10, false, 2)) }
  y += 6
  para('How to use these documents', 12, true, 2)
  para('A certification applies only to the exact items and SKUs listed on that certificate. Please check the item list on each certificate before you use a certification mark or claim on your packaging, website or bid. You can verify our BPI listings at ' + BPI_DIRECTORY + '.')
  para('beyondGREEN biotech, Inc. makes plant-based foodservice products as an alternative to petroleum-based plastics. Questions: info@byndgrn.com or (866) 364-9466. 1202 E. Wakeham Ave., Santa Ana, CA 92705.', 9)
  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}

// Build (or reuse today's) pack ZIP and return a short-lived download link.
export async function packUrl(familyKey: string, ttl = 300): Promise<{ url: string; name: string } | null> {
  const { data: f } = await admin.from('site_compliance_families').select('*').eq('key', familyKey).eq('is_active', true).maybeSingle()
  if (!f) return null
  const { data: rows } = await admin.from('site_compliance_docs').select('document_id, label, kind, covers, expires, sort, documents(title, source_file_path, updated_at, is_active)').eq('family_key', familyKey).eq('is_active', true).order('sort')
  const t = today()
  const current = ((rows || []) as any[]).filter(r => (!r.expires || r.expires >= t) && r.documents && r.documents.is_active !== false)
  const expired = ((rows || []) as any[]).filter(r => r.expires && r.expires < t).map(r => `${r.label} (renewal on request)`)
  const sig = createHash('sha1').update(JSON.stringify([f.updated_at, f.missing, current.map(r => [r.document_id, r.label, r.documents?.updated_at]), expired])).digest('hex').slice(0, 10)
  const zipName = `beyondGREEN-compliance-pack-${familyKey}.zip`
  const path = `compliance-packs/${familyKey}/${t}-${sig}.zip`
  const { data: hit } = await admin.storage.from(PACK_BUCKET).list(`compliance-packs/${familyKey}`, { search: `${t}-${sig}` })
  if (!hit || !hit.length) {
    const files: { name: string; data: Uint8Array }[] = []
    const included: any[] = [], missingFiles: string[] = []
    for (const r of current) {
      const ff = await fileFor(r.document_id, r.documents?.source_file_path || null)
      const dl = ff ? await admin.storage.from(DOC_BUCKET).download(ff.path) : null
      if (!ff || !dl?.data) { missingFiles.push(r.label); continue }
      const ext = (ff.name.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '.pdf').toLowerCase()
      files.push({ name: `${String(included.length + 1).padStart(2, '0')} ${clean(r.label)}${ext}`, data: new Uint8Array(await dl.data.arrayBuffer()) })
      included.push(r)
    }
    const onRequest = [...expired, ...missingFiles, ...((f.missing || []) as string[])]
    files.unshift({ name: '00 Read me first - cover sheet.pdf', data: coverPdf(f, included, onRequest) })
    const zip = buildZip(files)
    const up = await admin.storage.from(PACK_BUCKET).upload(path, zip, { contentType: 'application/zip', upsert: true })
    if (up.error) return null
  }
  const { data: s } = await admin.storage.from(PACK_BUCKET).createSignedUrl(path, ttl, { download: zipName })
  return s?.signedUrl ? { url: s.signedUrl, name: zipName } : null
}

// Every website download or gated view is logged as a lead (same flow as spec sheet requests).
export async function logLead(o: { kind: string; topic: string; email: string; name?: string; company?: string; phone?: string; message: string; details?: any; page?: string; ip?: string; leadSource: string; notify?: boolean }) {
  const email = String(o.email || '').toLowerCase()
  if (!email) return null
  let customerId: string | null = null, created = false
  const { data: hit } = await admin.from('customers').select('id').ilike('email', likeExact(email)).not('is_merged', 'is', true).limit(1)
  if (hit && hit.length) customerId = (hit[0] as any).id
  else {
    const { data: c } = await admin.from('customers').insert({ company_name: o.company || o.name || email, contact_name: o.name || null, email, phone: o.phone || null, board: 'customer', customer_status: 'Lead', lead_source: o.leadSource, is_active: true, is_scraped_lead: false, notes: `${o.topic}: ${o.message}`.slice(0, 900) }).select('id').single()
    customerId = (c as any)?.id || null; created = true
  }
  await admin.from('website_inquiries').insert({ kind: o.kind, topic: o.topic, name: o.name || email, company: o.company || null, email, phone: o.phone || null, message: o.message, details: o.details || {}, page: o.page || null, ip: o.ip || null, customer_id: customerId })
  if (created || o.notify) {
    await notifyTeam({ to: NOTIFY_SIGNUPS, from: email, subject: `Website: ${o.topic} · ${o.company || o.name || email}`, message: `${o.topic} from ${o.name || email}${o.company ? ' at ' + o.company : ''}: ${o.message.slice(0, 200)}`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">${esc(o.topic)}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6"><strong>${esc(o.name || email)}</strong>${o.company ? ' · ' + esc(o.company) : ''}<br>${esc(email)}${o.phone ? '<br>' + esc(o.phone) : ''}</p><div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;font-size:14px;white-space:pre-wrap;line-height:1.5">${esc(o.message)}</div><p style="font-size:12px;color:#6b7280">${created ? 'New lead added to Customer/Leads.' : 'Linked to an existing customer or lead.'}</p>`, contextPath: customerId ? `/sales/customers?item=${customerId}` : '/bizdev/client-portals', replyTo: email }).catch(() => {})
  }
  return customerId
}

export { sendEmail }

// ── Client portal helpers ──
// Every line this customer bought (optionally within a date range), joined to product data.
export async function customerLines(customerId: string, from?: string | null, to?: string | null) {
  let q = admin.from('sales_orders').select('id, order_number, po_number, order_date, status').eq('customer_id', customerId).not('archived', 'is', true).not('is_active', 'is', false)
  if (from) q = q.gte('order_date', from)
  if (to) q = q.lte('order_date', to)
  const { data: orders } = await q.order('order_date', { ascending: true }).limit(2000)
  const os = ((orders || []) as any[]).filter(o => !['draft', 'cancelled', 'canceled'].includes(String(o.status || '').toLowerCase()))
  if (!os.length) return []
  const ids = os.map(o => o.id)
  const lines: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('sales_order_lines').select('sales_order_id, order_id, product_id, sku, description, quantity, qty, unit_of_measure, stock_qty, products(id, sku, product_name, category, product_category, unit_of_measure, pieces_per_pack, packs_per_case, weight_per_unit_grams, straw_weight_g, epr_material)').or(`sales_order_id.in.(${ids.slice(i, i + 200).join(',')}),order_id.in.(${ids.slice(i, i + 200).join(',')})`)
    lines.push(...((data || []) as any[]))
  }
  const byId = Object.fromEntries(os.map(o => [o.id, o]))
  return lines.map(l => ({ ...l, order: byId[l.sales_order_id || l.order_id] || null }))
}

// Convert an ordered quantity to pieces when the unit of measure allows it.
export function piecesOf(qty: number, uom: string | null, p: any): number | null {
  const u = String(uom || p?.unit_of_measure || '').toUpperCase().replace(/S$/, '')
  const ppp = Number(p?.pieces_per_pack) || 0, ppc = Number(p?.packs_per_case) || 0
  if (['EA', 'EACH', 'PC', 'PIECE', 'UNIT'].includes(u)) return qty
  if (['PK', 'PACK', 'PKG'].includes(u)) return ppp ? qty * ppp : null
  if (['CASE', 'C', 'CS', 'CTN', 'CARTON'].includes(u)) return ppp && ppc ? qty * ppc * ppp : null
  return null
}
