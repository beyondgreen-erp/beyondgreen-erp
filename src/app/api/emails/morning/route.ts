export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextResponse } from 'next/server'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const APP_URL = 'https://beyondgreen-erp.vercel.app'

const TEAM_EMAILS = [
  'dhanush.k@beyondgreenbiotech.com',
  'shipping@beyondgreenbiotech.com',
  'accounting@byndgrn.com',
  'manish@beyondgreenbiotech.com',
  'quality@beyondgreenbiotech.com',
  'rudyp@beyondgreenbiotech.com',
  'shea@beyondgreenbiotech.com',
  'tiya@beyondgreenbiotech.com',
  'finance@beyondgreenbiotech.com',
  'veejay.patell@byndgrn.com',
]

const MOTIVATIONAL_QUOTES = [
  "Every task completed is progress toward greatness.",
  "Your effort today is an investment in tomorrow's success.",
  "Excellence is not a destination, it's a journey.",
  "Together, we build the future of sustainable innovation.",
  "Small actions create big results.",
  "Focus on what you can control, then execute.",
  "Consistent effort over time creates extraordinary results.",
  "Your work matters. Your team depends on you.",
  "This is going to be a great day.",
  "Make today count.",
]

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function getMotivationalQuote(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  )
  return MOTIVATIONAL_QUOTES[dayOfYear % MOTIVATIONAL_QUOTES.length]
}

async function getTeamActivity() {
  const sb = getSb()
  const { data, error } = await sb
    .from('comments')
    .select('*')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Error fetching team activity:', error)
    return []
  }
  return data || []
}

async function getPendingTasks() {
  const sb = getSb()
  const { data, error } = await sb
    .from('tasks')
    .select('id, task_name, priority, assigned_to, due_date, status')
    .eq('status', 'pending')
    .or(`due_date.lte.${new Date().toISOString().slice(0, 10)},status.eq.due-soon`)
    .order('due_date', { ascending: true })
    .limit(10)

  if (error) {
    console.error('Error fetching pending tasks:', error)
    return []
  }
  return data || []
}

async function getOrderUpdates() {
  const sb = getSb()
  const { data, error } = await sb
    .from('sales_orders')
    .select('id, order_number, customers(company_name), status, total, created_at')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    console.error('Error fetching order updates:', error)
    return []
  }
  return data || []
}

async function getInventoryShorts() {
  const sb = getSb()

  // Check both walmart_inventory and standard inventory for stock issues
  const { data: walmartLow, error: walmartError } = await sb
    .from('walmart_inventory')
    .select('id, sku, product_name, srps_available, packs_available, safety_stock_srps')
    .lte('srps_available', 50)
    .order('srps_available', { ascending: true })
    .limit(5)

  if (walmartError) {
    console.error('Error fetching walmart inventory:', walmartError)
  }

  return (walmartLow || []).map((item) => ({
    sku: item.sku,
    product_name: item.product_name,
    quantity: item.srps_available,
    type: 'walmart',
  }))
}

async function getInvoiceHighlights() {
  const sb = getSb()
  const today = new Date().toISOString().slice(0, 10)

  // Get overdue invoices and recently created invoices
  const { data: overdue, error: overdueError } = await sb
    .from('invoices')
    .select('id, invoice_number_display, customers(company_name), balance_due, due_date')
    .eq('status', 'overdue')
    .eq('is_active', true)
    .limit(3)

  const { data: recent, error: recentError } = await sb
    .from('invoices')
    .select('id, invoice_number_display, customers(company_name), total_amount, created_at')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(3)

  if (overdueError) console.error('Error fetching overdue invoices:', overdueError)
  if (recentError) console.error('Error fetching recent invoices:', recentError)

  return {
    overdue: overdue || [],
    recent: recent || [],
  }
}

function buildEmailHtml(
  teamActivity: any[],
  pendingTasks: any[],
  orderUpdates: any[],
  inventoryShorts: any[],
  invoiceData: any,
  quote: string
): string {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #0a0a0a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e5e7eb;
    }
    .container {
      max-width: 720px;
      margin: 0 auto;
      background: #111;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #222;
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      padding: 40px 32px;
      text-align: center;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      margin: 0;
      letter-spacing: -0.5px;
    }
    .greeting {
      font-size: 32px;
      margin: 12px 0 0;
      color: #fff;
    }
    .date-time {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.75);
      margin-top: 8px;
    }
    .content {
      padding: 32px;
    }
    .section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #10b981;
      margin: 0 0 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .section-content {
      background: #1a1a1a;
      border-radius: 10px;
      padding: 16px;
      border-left: 3px solid #10b981;
    }
    .item {
      padding: 12px 0;
      border-bottom: 1px solid #2a2a2a;
    }
    .item:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .item-title {
      font-weight: 600;
      color: #e5e7eb;
      font-size: 14px;
      margin: 0;
    }
    .item-meta {
      font-size: 12px;
      color: #9ca3af;
      margin: 4px 0 0;
    }
    .item-status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 8px;
    }
    .status-pending {
      background: #fef08a;
      color: #92400e;
    }
    .status-overdue {
      background: #fee2e2;
      color: #991b1b;
    }
    .status-new {
      background: #d1fae5;
      color: #065f46;
    }
    .empty-state {
      color: #6b7280;
      font-style: italic;
      font-size: 13px;
      padding: 12px;
    }
    .quote-box {
      background: #1f2937;
      border-left: 4px solid #10b981;
      padding: 20px;
      border-radius: 8px;
      margin: 24px 0;
      font-style: italic;
      color: #d1d5db;
      font-size: 15px;
      line-height: 1.6;
    }
    .cta-button {
      display: inline-block;
      background: #10b981;
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      padding: 12px 28px;
      border-radius: 10px;
      margin-top: 16px;
      transition: background 0.2s;
    }
    .cta-button:hover {
      background: #059669;
    }
    .footer {
      padding: 16px 32px;
      border-top: 1px solid #1f1f1f;
      font-size: 11px;
      color: #4b5563;
      text-align: center;
    }
    .footer a {
      color: #6b7280;
      text-decoration: none;
    }
    .priority-high {
      color: #ef4444;
    }
    .priority-medium {
      color: #f59e0b;
    }
    .priority-low {
      color: #10b981;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <p class="logo">beyondGREEN</p>
      <div class="greeting">Good Morning Team!</div>
      <div class="date-time">${dateStr} • ${timeStr} PT</div>
    </div>

    <!-- Main Content -->
    <div class="content">
      <!-- Team Activity -->
      <div class="section">
        <div class="section-title">Team Activity</div>
        <div class="section-content">
          ${
            teamActivity.length > 0
              ? teamActivity
                  .map(
                    (activity) =>
                      '<div class="item"><p class="item-title">' +
                      (activity.author_email || 'Unknown') +
                      '</p><p class="item-meta">Updated ' +
                      activity.record_type +
                      '</p></div>'
                  )
                  .join('')
              : '<div class="empty-state">No activity in the last 24 hours</div>'
          }
        </div>
      </div>

      <!-- Pending Tasks -->
      <div class="section">
        <div class="section-title">Pending Tasks</div>
        <div class="section-content">
          ${
            pendingTasks.length > 0
              ? pendingTasks
                  .map((task) => {
                    const isOverdue =
                      task.due_date && new Date(task.due_date) < new Date()
                    return (
                      '<div class="item"><p class="item-title">' +
                      task.task_name +
                      '<span class="item-status ' +
                      (isOverdue ? 'status-overdue' : 'status-pending') +
                      '">' +
                      (isOverdue ? 'OVERDUE' : 'DUE TODAY') +
                      '</span></p><p class="item-meta"><span class="priority-' +
                      (task.priority ? task.priority.toLowerCase() : 'low') +
                      '">' +
                      (task.priority || 'Normal') +
                      ' Priority</span> • Assigned to ' +
                      (task.assigned_to || 'Unassigned') +
                      ' • Due ' +
                      (task.due_date || 'No date') +
                      '</p></div>'
                    )
                  })
                  .join('')
              : '<div class="empty-state">No pending tasks</div>'
          }
        </div>
      </div>

      <!-- Order Updates -->
      <div class="section">
        <div class="section-title">Order Updates</div>
        <div class="section-content">
          ${
            orderUpdates.length > 0
              ? orderUpdates
                  .map((order) => {
                    const customer = Array.isArray(order.customers)
                      ? order.customers[0]?.company_name
                      : order.customers?.company_name
                    return (
                      '<div class="item"><p class="item-title">' +
                      order.order_number +
                      '</p><p class="item-meta">' +
                      (customer || 'Unknown Customer') +
                      ' • ' +
                      order.status +
                      ' • $' +
                      Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) +
                      '</p></div>'
                    )
                  })
                  .join('')
              : '<div class="empty-state">No new orders</div>'
          }
        </div>
      </div>

      <!-- Inventory Shorts -->
      <div class="section">
        <div class="section-title">Inventory Shorts</div>
        <div class="section-content">
          ${
            inventoryShorts.length > 0
              ? inventoryShorts
                  .map(
                    (item) =>
                      '<div class="item"><p class="item-title">' +
                      item.product_name +
                      '</p><p class="item-meta">SKU: ' +
                      item.sku +
                      ' • Stock: ' +
                      item.quantity +
                      ' units</p></div>'
                  )
                  .join('')
              : '<div class="empty-state">Inventory levels are healthy</div>'
          }
        </div>
      </div>

      <!-- Invoice Highlights -->
      <div class="section">
        <div class="section-title">Invoice Highlights</div>
        <div class="section-content">
          ${
            invoiceData.overdue.length > 0
              ? '<p style="margin: 0 0 12px; color: #ef4444; font-weight: 600;">Overdue Invoices:</p>' +
                invoiceData.overdue
                  .map((inv) => {
                    const customer = Array.isArray(inv.customers)
                      ? inv.customers[0]?.company_name
                      : inv.customers?.company_name
                    return (
                      '<div class="item"><p class="item-title">' +
                      inv.invoice_number_display +
                      '<span class="item-status status-overdue">OVERDUE</span></p><p class="item-meta">' +
                      (customer || 'Unknown') +
                      ' • Balance: $' +
                      Number(inv.balance_due || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) +
                      '</p></div>'
                    )
                  })
                  .join('')
              : ''
          }
          ${
            invoiceData.recent.length > 0
              ? '<p style="margin: 16px 0 12px; color: #10b981; font-weight: 600;">Recently Created:</p>' +
                invoiceData.recent
                  .map((inv) => {
                    const customer = Array.isArray(inv.customers)
                      ? inv.customers[0]?.company_name
                      : inv.customers?.company_name
                    return (
                      '<div class="item"><p class="item-title">' +
                      inv.invoice_number_display +
                      '<span class="item-status status-new">NEW</span></p><p class="item-meta">' +
                      (customer || 'Unknown') +
                      ' • Amount: $' +
                      Number(inv.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) +
                      '</p></div>'
                    )
                  })
                  .join('')
              : ''
          }
          ${
            invoiceData.overdue.length === 0 && invoiceData.recent.length === 0
              ? '<div class="empty-state">No activity</div>'
              : ''
          }
        </div>
      </div>

      <!-- Motivational Quote -->
      <div class="quote-box">
        "${quote}"
      </div>

      <a href="${APP_URL}/dashboard" class="cta-button">
        Open ERP Dashboard
      </a>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p style="margin: 0;">beyondGREEN ERP Automated Daily Brief</p>
      <p style="margin: 4px 0 0;">© beyondGREEN Biotech • Sent every weekday at 8:00 AM PT</p>
    </div>
  </div>
</body>
</html>`
}

export async function GET() {
  try {
    const quote = getMotivationalQuote()

    // Fetch all data in parallel
    const [teamActivity, pendingTasks, orderUpdates, inventoryShorts, invoiceData] =
      await Promise.all([
        getTeamActivity(),
        getPendingTasks(),
        getOrderUpdates(),
        getInventoryShorts(),
        getInvoiceHighlights(),
      ])

    const emailHtml = buildEmailHtml(
      teamActivity,
      pendingTasks,
      orderUpdates,
      inventoryShorts,
      invoiceData,
      quote
    )

    // Send to all team members
    const sendResults = await Promise.allSettled(
      TEAM_EMAILS.map((email) =>
        resend?.emails.send({
          from: 'beyondGREEN ERP <onboarding@resend.dev>',
          to: email,
          subject: `Good Morning! beyondGREEN Daily Brief — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
          html: emailHtml,
        })
      )
    )

    const successful = sendResults.filter((r) => r.status === 'fulfilled').length
    const failed = sendResults.filter((r) => r.status === 'rejected').length

    console.log(`Good morning emails: ${successful} sent, ${failed} failed`)

    return NextResponse.json({
      ok: true,
      sent: successful,
      failed,
      quote,
      summary: {
        team_activity: teamActivity.length,
        pending_tasks: pendingTasks.length,
        new_orders: orderUpdates.length,
        inventory_shorts: inventoryShorts.length,
        overdue_invoices: invoiceData.overdue.length,
        recent_invoices: invoiceData.recent.length,
      },
    })
  } catch (err: unknown) {
    console.error('Good morning email error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
