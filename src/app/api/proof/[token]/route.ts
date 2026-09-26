/* eslint-disable @typescript-eslint/no-explicit-any */
// Public printer-proof API (token-gated, no ERP login). Exposes ONLY the shared design:
// the live working file, its images, the confirmed final files and this link's comment threads.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { loadLink } from '@/lib/packaging/proofServer'
import { approvalState, log } from '@/lib/packaging/approvalServer'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' }
const BUCKET = 'packaging'

function assetPaths(objs: any[], out: Set<string>) {
  for (const o of objs || []) {
    if (typeof o?.src === 'string' && o.src.startsWith('asset:')) out.add(o.src.slice(6))
    if (Array.isArray(o?.objects)) assetPaths(o.objects, out)
  }
  return out
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createSupabaseAdminClient()
  const r = await loadLink(admin, params.token)
  if (!r.link) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE })
  const link = r.link

  const { data: design } = await admin.from('packaging_designs')
    .select('id, name, customer_name, sku, product_type, status, width_pt, height_pt, unit, updated_at, doc_path').eq('id', link.design_id).maybeSingle()
  if (!design) return NextResponse.json({ error: 'This design is no longer available.' }, { status: 404, headers: NO_STORE })

  let doc: any = null
  if (design.doc_path) {
    const { data: blob } = await admin.storage.from(BUCKET).download(design.doc_path)
    if (blob) { try { doc = JSON.parse(await blob.text()) } catch { doc = null } }
  }
  // printers see the customer's company only — never their contact details
  if (doc?.proof?.customer) {
    const c = doc.proof.customer
    doc.proof.customer = { name: c.name || '', location: c.location || '', status: '', code: c.code || '' }
  }
  // only designs inside designs/{id}/ may be signed — defence in depth against crafted JSON
  const prefix = `designs/${design.id}/`
  const paths = Array.from(assetPaths(doc?.objects || [], new Set())).filter(p => p.startsWith(prefix))
  const assets: Record<string, string> = {}
  if (paths.length) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600)
    ;(signed || []).forEach((s: any) => { if (s.signedUrl && s.path) assets[s.path] = s.signedUrl })
  }

  // the original upload, byte-for-byte
  let source: any = null
  if (link.allow_download && doc?.source?.path && String(doc.source.path).startsWith(prefix)) {
    const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(doc.source.path, 3600, { download: doc.source.name || true })
    if (s?.signedUrl) source = { name: doc.source.name, size: doc.source.size, sha256: doc.source.sha256, uploaded_at: doc.source.uploaded_at, url: s.signedUrl }
  }
  if (doc?.source) doc.source = { name: doc.source.name, size: doc.source.size, sha256: doc.source.sha256, uploaded_at: doc.source.uploaded_at }

  let files: any[] = []
  if (link.allow_download) {
    const { data: rows } = await admin.from('packaging_design_files').select('id, format, file_name, file_path, size_bytes, created_at, options').eq('design_id', design.id).order('created_at', { ascending: false })
    files = await Promise.all((rows || []).map(async (f: any) => {
      const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(f.file_path, 3600, { download: f.file_name })
      return { id: f.id, format: f.format, file_name: f.file_name, size_bytes: f.size_bytes, created_at: f.created_at, label: f.options?.label || null, url: s?.signedUrl || null }
    }))
  }

  // this link's threads + every reply in them (team replies included); internal team notes stay private
  const { data: threads } = await admin.from('packaging_comments').select('*').eq('design_id', design.id).eq('share_link_id', link.id).is('parent_id', null).order('created_at')
  const ids = (threads || []).map((t: any) => t.id)
  const { data: replies } = ids.length ? await admin.from('packaging_comments').select('*').in('parent_id', ids).order('created_at') : { data: [] as any[] }
  const strip = (c: any) => ({ ...c, author_email: c.author_type === 'printer' ? c.author_email : null })

  if (req.nextUrl.searchParams.get('view') === '1') {
    await admin.from('packaging_share_links').update({ view_count: (link.view_count || 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', link.id)
    const who = req.nextUrl.searchParams.get('who') || ''
    await log(admin, { design_id: design.id, share_link_id: link.id, actor_type: 'printer', actor_name: who.slice(0, 120) || null, action: 'portal_opened' })
  }

  // approval status for this printer link + the shared activity trail
  const st = await approvalState(admin, design.id, link.id)
  let approval: any = null
  if (st) {
    const r = st.round
    let approvedUrl: string | null = null
    if (r.status === 'approved' && r.source_path && String(r.source_path).startsWith(prefix)) {
      const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(r.source_path, 3600, { download: r.source_name || true })
      approvedUrl = s?.signedUrl || null
    }
    approval = {
      round_no: r.round_no, status: r.status, submitted_at: r.submitted_at, submitted_by_name: r.submitted_by_name, printer_note: r.printer_note,
      approved_at: r.approved_at, approval_sent_at: r.approval_sent_at, closed_note: r.status === 'changes_requested' ? r.closed_note : null,
      source_name: r.source_name, source_sha256: r.source_sha256, approved_url: approvedUrl,
      approvers: st.approvers.map((a: any) => ({ name: a.name, decision: a.decision, decided_at: a.decided_at })), confirmed: st.confirmed, total: st.total,
    }
  }
  const { data: acts } = await admin.from('packaging_activity').select('actor_type, actor_name, action, details, created_at').eq('design_id', design.id)
    .or(`share_link_id.eq.${link.id},share_link_id.is.null`).in('action', ['portal_opened', 'downloaded', 'comment', 'reply', 'comment_resolved', 'submitted', 'confirmed', 'changes_requested', 'approved', 'approval_sent', 'round_cancelled', 'artwork_replaced'])
    .order('created_at', { ascending: false }).limit(200)
  const activity = (acts || []).map((a: any) => ({ ...a, details: { round: a.details?.round, file: a.details?.file, note: a.action === 'changes_requested' ? a.details?.note : undefined } }))

  return NextResponse.json({
    link: { printer_company: link.printer_company, printer_contact: link.printer_contact, printer_email: link.printer_email, message: link.message, allow_download: link.allow_download, allow_comments: link.allow_comments, expires_at: link.expires_at },
    design: { name: design.name, customer_name: design.customer_name, sku: design.sku, product_type: design.product_type, status: design.status, width_pt: design.width_pt, height_pt: design.height_pt, unit: design.unit, updated_at: design.updated_at },
    doc, assets, files, source, approval, activity,
    comments: [...(threads || []), ...(replies || [])].map(strip),
  }, { headers: NO_STORE })
}
