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
  "Great work today. Rest well tonight.",
  "You've made progress. Tomorrow brings new opportunities.",
  "Your dedication makes a real difference.",
  "Every day closer to our mission.",
  "Well done. You earned your rest.",
  "Another day, another step forward.",
  "You showed up. That matters.",
  "Tomorrow is a fresh start.",
  "Be proud of what you accomplished.",
  "Sleep well. The team needs you ready.",
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

async function getTodayActivity() {
  const sb = getSb()
  const today = new Date().toISOString().slice(0, 10)
  
  const { data, error } = await sb
    .from('comments')
    .select('*')
    .gte('created_at', `${today}T00:00:00`)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Error fetching today activity:', error)
    return []
  }
  return data || []
}

async function getCompletedTasks() {
  const sb = getSb()
  const today = new Date().toISOString().slice(0, 10)
  
  const { data, error } = await sb
    .from('tasks')
    .select('id, task_name, assigned_to, completed_at, priority')
    .eq('status', 'completed')
    .gte('completed_at', `${today}T00:00:00`)
    .order('completed_at', { ascending: false })
    .limit(8)

  if (error) {
    console.error('Error fetching completed tasks:', error)
    return []
  }
  return data || []
}

async function getTodayOrders() {
  const sb = getSb()
  const today = new Date().toISOString().slice(0, 10)
  
  const { data, error } = await sb
    .from('sales_orders')
    .select('id, order_number, customers(company_name), status, total, created_at')
    .gte('created_at', `${today}T00:00:00`)
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    console.error('Error fetching today orders:', error)
    return []
  }
  return data || []
}

async function getShipmentsSent() {
  const sb = getSb()
  const today = new Date().toISOString().slice(0, 10)
  
  // Try to get shipment updates if the table exists
  const { data, error } = await sb
    .from('invoices')
    .select('id, invoice_number_display, customers(company_name), status, updated_at')
    .gte('updated_at', `${today}T00:00:00`)
    .in('status', ['shipped', 'delivered'])
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Error fetching shipments:', error)
    return []
  }
  return data || []
}

async function getUnresolvedIssues() {
  const sb = getSb()
  
  // Get tasks marked as blocked or with critical issues
  const { data, error } = await sb
    .from('tasks')
    .select('id, task_name, priority, assigned_to, status')
    .in('status', ['blocked', 'critical'])
    .order('priority', { ascending: true })
    .limit(5)

  if (error) {
    console.error('Error fetching unresolved issues:', error)
    return []
  }
  return data || []
}

async function getDayStatistics() {
  const sb = getSb()
  const today = new Date().toISOString().slice(0, 10)
  
  const { data: tasksData } = await sb
    .from('tasks')
    .select('id')
    .eq('status', 'completed')
    .gte('completed_at', `${today}T00:00:00`)
  
  const { data: ordersData } = await sb
    .from('sales_orders')
    .select('total')
    .gte('created_at', `${today}T00:00:00`)
  
  const tasksCompleted = tasksData?.length || 0
  const ordersCreated = ordersData?.length || 0
  const totalRevenue = ordersData?.reduce((sum, o) => sum + (Number(o.total) || 0), 0) || 0
  
  return {
    tasks_completed: tasksCompleted,
    orders_created: ordersCreated,
    revenue_today: totalRevenue,
  }
}

function buildEmailHtml(
  todayActivity: any[],
  completedTasks: any[],
  todayOrders: any[],
  shipmentsSent: any[],
  unresolvedIssues: any[],
  stats: any,
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
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
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
      color: #3b82f6;
      margin: 0 0 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .section-content {
      background: #1a1a1a;
      border-radius: 10px;
      padding: 16px;
      border-left: 3px solid #3b82f6;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-box {
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .stat-number {
      font-size: 28px;
      font-weight: 700;
      color: #3b82f6;
      margin: 0;
    }
    .stat-label {
      font-size: 12px;
      color: #9ca3af;
      margin: 4px 0 0;
      text-transform: uppercase;
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
    .status-completed {
      background: #d1fae5;
      color: #065f46;
    }
    .status-shipped {
      background: #dbeafe;
      color: #1e40af;
    }
    .status-critical {
      background: #fee2e2;
      color: #991b1b;
    }
    .empty-state {
      color: #6b7280;
      font-style: italic;
      font-size: 13px;
      padding: 12px;
    }
    .quote-box {
      background: #1f2937;
      border-left: 4px solid #3b82f6;
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
      background: #3b82f6;
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
      background: #2563eb;
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
      color: #3b82f6;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <p class="logo">beyondGREEN</p>
      <div class="greeting">Good Evening Team!</div>
      <div class="date-time">${dateStr} • ${timeStr} PT</div>
    </div>

    <!-- Main Content -->
    <div class="content">
      <!-- Daily Stats -->
      <div class="section">
        <div class="section-title">Today's Achievements</div>
        <div class="stats-grid">
          <div class="stat-box">
            <p class="stat-number">${stats.tasks_completed}</p>
            <p class="stat-label">Tasks Completed</p>
          </div>
          <div class="stat-box">
            <p class="stat-number">${stats.orders_created}</p>
            <p class="stat-label">Orders Created</p>
          </div>
          <div class="stat-box">
            <p class="stat-number">$${Number(stats.revenue_today).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
            <p class="stat-label">Revenue</p>
          </div>
        </div>
      </div>

      <!-- Completed Tasks -->
      <div class="section">
        <div class="section-title">Completed Today</div>
        <div class="section-content">
          ${
            completedTasks.length > 0
              ? completedTasks
                  .map(
                    (task) =>
                      '<div class="item"><p class="item-title">' +
                      task.task_name +
                      '<span class="item-status status-completed">DONE</span></p><p class="item-meta">' +
                      (task.assigned_to || 'Completed') +
                      '</p></div>'
                  )
                  .join('')
              : '<div class="empty-state">No tasks completed today</div>'
          }
        </div>
      </div>

      <!-- Orders Today -->
      <div class="section">
        <div class="section-title">Orders This Day</div>
        <div class="section-content">
          ${
            todayOrders.length > 0
              ? todayOrders
                  .map((order) => {
                    const customer = Array.isArray(order.customers)
                      ? order.customers[0]?.company_name
                      : order.customers?.company_name
                    return (
                      '<div class="item"><p class="item-title">' +
                      order.order_number +
                      '</p><p class="item-meta">' +
                      (customer || 'Unknown Customer') +
                      ' • $' +
                      Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) +
                      ' • ' +
                      order.status +
                      '</p></div>'
                    )
                  })
                  .join('')
              : '<div class="empty-state">No orders created today</div>'
          }
        </div>
      </div>

      <!-- Shipments Sent -->
      ${
        shipmentsSent.length > 0
          ? '<div class="section"><div class="section-title">Shipments Sent</div><div class="section-content">' +
            shipmentsSent
              .map((ship) => {
                const customer = Array.isArray(ship.customers)
                  ? ship.customers[0]?.company_name
                  : ship.customers?.company_name
                return (
                  '<div class="item"><p class="item-title">' +
                  ship.invoice_number_display +
                  '<span class="item-status status-shipped">' +
                  ship.status.toUpperCase() +
                  '</span></p><p class="item-meta">' +
                  (customer || 'Unknown') +
                  '</p></div>'
                )
              })
              .join('') +
            '</div></div>'
          : ''
      }

      <!-- Unresolved Issues -->
      ${
        unresolvedIssues.length > 0
          ? '<div class="section"><div class="section-title">Needs Attention</div><div class="section-content">' +
            unresolvedIssues
              .map(
                (issue) =>
                  '<div class="item"><p class="item-title">' +
                  issue.task_name +
                  '<span class="item-status status-critical">ACTION NEEDED</span></p><p class="item-meta"><span class="priority-' +
                  (issue.priority ? issue.priority.toLowerCase() : 'low') +
                  '">' +
                  (issue.priority || 'Normal') +
                  '</span> • ' +
                  (issue.assigned_to || 'Unassigned') +
                  '</p></div>'
              )
              .join('') +
            '</div></div>'
          : ''
      }

      <!-- Motivational Quote -->
      <div class="quote-box">
        "${quote}"
      </div>

      <a href="${APP_URL}/dashboard" class="cta-button">
        Check Dashboard
      </a>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p style="margin: 0;">beyondGREEN ERP Evening Recap</p>
      <p style="margin: 4px 0 0;">© beyondGREEN Biotech • Sent daily at 5:00 PM PT</p>
    </div>
  </div>
</body>
</html>`
}

export async function GET() {
  try {
    const quote = getMotivationalQuote()

    // Fetch all data in parallel
    const [todayActivity, completedTasks, todayOrders, shipmentsSent, unresolvedIssues, stats] =
      await Promise.all([
        getTodayActivity(),
        getCompletedTasks(),
        getTodayOrders(),
        getShipmentsSent(),
        getUnresolvedIssues(),
        getDayStatistics(),
      ])

    const emailHtml = buildEmailHtml(
      todayActivity,
      completedTasks,
      todayOrders,
      shipmentsSent,
      unresolvedIssues,
      stats,
      quote
    )

    // Send to all team members
    const sendResults = await Promise.allSettled(
      TEAM_EMAILS.map((email) =>
        resend?.emails.send({
          from: 'beyondGREEN ERP <erp@beyondgreenbiotech.com>',
          to: email,
          subject: `Good Evening! beyondGREEN Daily Recap — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
          html: emailHtml,
        })
      )
    )

    const successful = sendResults.filter((r) => r.status === 'fulfilled').length
    const failed = sendResults.filter((r) => r.status === 'rejected').length

    console.log(`Good evening emails: ${successful} sent, ${failed} failed`)

    return NextResponse.json({
      ok: true,
      sent: successful,
      failed,
      quote,
      stats,
      summary: {
        today_activity: todayActivity.length,
        tasks_completed: completedTasks.length,
        orders_today: todayOrders.length,
        shipments_sent: shipmentsSent.length,
        unresolved_issues: unresolvedIssues.length,
      },
    })
  } catch (err: unknown) {
    console.error('Good evening email error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
