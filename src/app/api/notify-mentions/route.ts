import { createClient } from '@supabase/supabase-js'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const RECORD_TABLES: Record<string, string> = {
  purchasing_request: 'purchasing_requests',
  vault_item: 'vault_items',
  sample_submission: 'sample_submissions', sample_submissions: 'sample_submissions',
  customer: 'customers', customers: 'customers',
  sales_order: 'sales_orders', sales_orders: 'sales_orders',
  quotation: 'quotations', quotations: 'quotations', quotation_art: 'quotations',
  shipment: 'shipments', shipments: 'shipments',
  invoice: 'invoices', invoices: 'invoices',
  fba_shipment: 'fba_shipments', fba_shipments: 'fba_shipments',
  lead: 'leads', leads: 'leads',
  walmart_order: 'walmart_board_orders', walmart_board_order: 'walmart_board_orders',
  task: 'tasks', tasks: 'tasks',
}
const NAME_COLS = ['name','task_name','order_number','company_name','quote_number','invoice_number_display','external_invoice_number','customer_name','shipment_number','load_number','po_number','title','contact_name']

function esc(x: string) {
  return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function lookupRecordName(sb: any, recordType?: string, recordId?: string): Promise<string | null> {
  if (!recordType || !recordId) return null
  const isCustom = recordType.startsWith('board:')
  const table = isCustom ? 'custom_board_items' : RECORD_TABLES[recordType]
  if (!table) return null
  try {
    const { data } = await sb.from(table).select('*').eq('id', recordId).maybeSingle()
    if (!data) return null
    if (isCustom && data.data && typeof data.data === 'object') {
      const v = Object.values(data.data).find((x: any) => typeof x === 'string' && String(x).trim())
      if (v) return String(v).slice(0, 140)
    }
    for (const c of NAME_COLS) {
      const v = (data as any)[c]
      if (v !== null && v !== undefined && String(v).trim() && String(v).trim() !== '0') {
        if (c === 'shipment_number') return 'Shipment #' + v
        if (c === 'invoice_number_display' || c === 'external_invoice_number') return 'Invoice ' + v
        if (c === 'quote_number' && /^\d+$/.test(String(v))) return 'Quote #' + v
        if (c === 'order_number' && /^\d+$/.test(String(v))) return 'Order #' + v
        return String(v).slice(0, 140)
      }
    }
  } catch (e) {
    console.error('[notify-mentions] name lookup failed for', table, e)
  }
  return null
}

// Pull extra context fields (customer, PO#, status, ship date) for order-type records
// so the notification tells you WHICH order without opening the ERP.
async function lookupRecordContext(sb: any, recordType?: string, recordId?: string): Promise<[string, string][]> {
  if (!recordType || !recordId) return []
  const fields: [string, string][] = []
  try {
    const isSalesOrder = recordType === 'sales_order' || recordType === 'sales_orders'
    const isWalmart = recordType === 'walmart_order' || recordType === 'walmart_board_order'
    if (isSalesOrder || isWalmart) {
      const table = isWalmart ? 'walmart_board_orders' : 'sales_orders'
      const { data } = await sb
        .from(table)
        .select('po_number, status, required_ship_date, ship_date, customer:customers(company_name)')
        .eq('id', recordId)
        .maybeSingle()
      if (data) {
        const cust = data.customer?.company_name
        if (cust) fields.push(['Customer', String(cust)])
        if (data.po_number && String(data.po_number).trim()) fields.push(['PO #', String(data.po_number)])
        if (data.status && String(data.status).trim()) fields.push(['Status', String(data.status)])
        const ship = data.required_ship_date || data.ship_date
        if (ship) fields.push(['Ship date', String(ship)])
      }
    }
  } catch (e) {
    console.error('[notify-mentions] context lookup failed', e)
  }
  return fields
}

export async function POST(req: Request) {
  try {
    const { mentions, body, authorName, authorEmail, recordId, recordType, recordUrl } = await req.json()

    if (!mentions?.length || !authorEmail) {
      return Response.json({ ok: true, skipped: true })
    }

    const sb = getSb()

    // Look up user profiles to resolve @mentions to real emails
    const { data: profiles } = await sb
      .from('user_profiles')
      .select('email, full_name')
      .not('email', 'is', null)

    if (!profiles?.length) return Response.json({ ok: true, notified: 0 })

    // Build name -> email lookup
    const nameToEmail: Record<string, string> = {}
    for (const p of profiles) {
      if (!p.email || !p.full_name) continue
      const normalized = p.full_name.toLowerCase().replace(/\s+/g, '')
      nameToEmail[normalized] = p.email; nameToEmail[(p.email||'').toLowerCase()] = p.email; nameToEmail[((p.email||'').split('@')[0]||'').toLowerCase()] = p.email
      const first = p.full_name.split(' ')[0].toLowerCase()
      if (!nameToEmail[first]) nameToEmail[first] = p.email
    }

    // Resolve mention tokens to recipient emails (skip self-mentions)
    const recipientEmails = new Set<string>()
    for (const token of mentions) {
      const normalized = token.toLowerCase().replace(/\s+/g, '')
      const recipEmail = nameToEmail[normalized]
      if (recipEmail && recipEmail !== authorEmail) {
        recipientEmails.add(recipEmail)
      }
    }

    if (recipientEmails.size === 0) return Response.json({ ok: true, notified: 0 })

    const pageLabel = recordType ? (recordType.charAt(0).toUpperCase() + recordType.slice(1).replace(/_/g, ' ')) : 'ERP'
    // Build a deep link straight to the tagged item (?item=<id>) so the record board opens it.
    const RECORD_PATHS: Record<string, string> = {
      vault_item: '/bizdev/vault',
      sample_submission: '/operations/samples', sample_submissions: '/operations/samples',
      customer: '/sales/customers', customers: '/sales/customers',
      sales_order: '/sales/orders', sales_orders: '/sales/orders',
      quotation: '/sales/quotations', quotations: '/sales/quotations', quotation_art: '/sales/quotations',
      shipment: '/shipments', shipments: '/shipments',
      invoice: '/sales/invoices', invoices: '/sales/invoices',
      fba_shipment: '/operations/fba', fba_shipments: '/operations/fba',
      lead: '/sales/leads', leads: '/sales/leads',
    }
    const boardPath = recordType ? RECORD_PATHS[recordType] : undefined
    const contextUrl = (boardPath && recordId)
      ? `${SITE_URL}${boardPath}?item=${recordId}`
      : (recordUrl || `${SITE_URL}/${recordType || ''}`)
    const snippet = body ? body.replace(/<[^>]+>/g, '').substring(0, 200) : ''
    const recordName = await lookupRecordName(sb, recordType, recordId)
    const contextFields = await lookupRecordContext(sb, recordType, recordId)
    // Email: a compact "Customer / PO # / Status / Ship date" block under the record title.
    const contextHtml = contextFields.length
      ? `<table style="width:100%;border-collapse:collapse;margin:0 0 20px">${contextFields.map(([label, value]) =>
          `<tr><td style="padding:4px 12px 4px 0;font-size:13px;color:#5A6E8A;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:4px 0;font-size:13px;color:#0F1C2E;font-weight:600">${esc(value)}</td></tr>`
        ).join('')}</table>`
      : ''
    // Bell/title: append the customer so the notification list is self-explanatory too.
    const customerName = (contextFields.find(([l]) => l === 'Customer') || [])[1]
    const notifTitle = recordName
      ? `${pageLabel}: ${recordName}${customerName ? ` — ${customerName}` : ''}`
      : pageLabel

    let notified = 0
    let emailed = 0
    const emailErrors: string[] = []
    for (const recipEmail of Array.from(recipientEmails)) {
      // 1. Write to notifications table (shows in bell) — always attempt, independent of email
      try {
        await sb.from('notifications').insert({
          recipient_email: recipEmail,
          sender_email: authorEmail,
          title: notifTitle,
          message: customerName ? `${customerName} · ${snippet}` : snippet,
          page: pageLabel,
          record_type: recordType || null,
          record_id: recordId || null,
          is_read: false,
          context_url: contextUrl,
        })
        notified++
      } catch (e) {
        console.error('[notify-mentions] notification insert failed for', recipEmail, e)
      }

      // 2. Send email via Resend
      if (RESEND_API_KEY) {
        const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F7F8FA;margin:0;padding:32px 16px">
<div style="max-width:500px;margin:0 auto">
  <div style="background:#1A2035;border-radius:14px 14px 0 0;padding:24px 28px;display:flex;align-items:center;gap:12px">
    <div style="background:#3B6FE0;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:13px;text-align:center">bG</div>
    <span style="color:rgba(255,255,255,0.85);font-size:14px;font-weight:600">beyondGREEN ERP</span>
  </div>
  <div style="background:white;border-radius:0 0 14px 14px;padding:32px 28px;border:1px solid #E2E8F0;border-top:none">
    <p style="font-size:16px;font-weight:700;color:#0F1C2E;margin:0 0 6px">
      ${authorName || authorEmail.split('@')[0]} mentioned you
    </p>
    <p style="font-size:13px;color:#5A6E8A;margin:0 0 ${recordName ? '2px' : '20px'}">
      in <strong style="color:#0F1C2E">${pageLabel}</strong> board
    </p>
    ${recordName ? `<p style="font-size:15px;font-weight:700;color:#0F1C2E;margin:0 0 ${contextHtml ? '12px' : '20px'}">\u{1F4CB} ${esc(recordName)}</p>` : ''}
    ${contextHtml}
    ${snippet ? `<div style="background:#F7F8FA;border-left:3px solid #3B6FE0;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#0F1C2E;margin-bottom:24px;line-height:1.6">${snippet}</div>` : ''}
    <a href="${contextUrl}" style="display:inline-block;background:#3B6FE0;color:white;padding:12px 24px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700">
      View in ERP
    </a>
  </div>
  <p style="text-align:center;font-size:11px;color:#8A9FC0;margin-top:20px">beyondGREEN Biotech &middot; Internal ERP</p>
</div>
</body></html>`

        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: `beyondGREEN ERP <${FROM_EMAIL}>`,
              to: [recipEmail],
              cc: ['info@byndgrn.com'],
              reply_to: [authorEmail],
              subject: `${authorName || authorEmail.split('@')[0]} mentioned you in ${pageLabel}${recordName ? `: ${recordName}` : ''}`,
              html,
            }),
          })
          if (emailRes.ok) {
            emailed++
          } else {
            const errBody = await emailRes.text().catch(() => '')
            console.error('[notify-mentions] Resend send failed', emailRes.status, 'to', recipEmail, errBody)
            emailErrors.push(`${recipEmail}: ${emailRes.status} ${errBody.slice(0, 200)}`)
          }
        } catch (e) {
          console.error('[notify-mentions] Resend fetch threw for', recipEmail, e)
          emailErrors.push(`${recipEmail}: ${String(e)}`)
        }
      }
    }

    return Response.json({ ok: true, notified, emailed, emailErrors })
  } catch (err) {
    console.error('[notify-mentions]', err)
    return Response.json({ error: 'Failed to send notifications' }, { status: 500 })
  }
}
