import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

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
  'veejay.patell@byndgrn.com'
]

const EVENING_QUOTES = [
  "Every accomplishment starts with the decision to try. – John F. Kennedy",
  "Don't watch the clock; do what it does. Keep going. – Sam Levenson",
  "The only limit to our realization of tomorrow will be our doubts of today. – Franklin D. Roosevelt",
  "You miss 100% of the shots you don't take. – Wayne Gretzky",
  "The way to get started is to quit talking and begin doing. – Walt Disney",
  "Great things never come from comfort zones. – Unknown",
  "Dream it, believe it, build it. – Unknown",
  "Success usually comes to those who are too busy to be looking for it. – Henry David Thoreau",
  "The future is yours to build. – Unknown",
  "Greatness is not a function of circumstance. It's a function of conscious choice. – James C. Collins"
]

export async function GET(request: NextRequest) {
  try {
    const sb = await createSupabaseServerClient()

    // Fetch today's data
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [completedTasks, completedOrders, shipments, criticalTasks] = await Promise.all([
      sb.from('tasks').select('*').eq('status', 'Done').gte('updated_at', todayStart.toISOString()).limit(5),
      sb.from('sales_orders').select('*').gte('created_at', todayStart.toISOString()).limit(5),
      sb.from('shipments').select('*').gte('created_at', todayStart.toISOString()).limit(5),
      sb.from('tasks').select('*').in('status', ['Blocked', 'Review']).limit(5)
    ])

    const quote = EVENING_QUOTES[Math.floor(Math.random() * EVENING_QUOTES.length)]
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #9333EA; padding-bottom: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #0F1C2E; margin-bottom: 10px; }
        .greeting { font-size: 28px; font-weight: bold; color: #9333EA; margin: 10px 0; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: bold; color: #0F1C2E; background: #F3E8FF; padding: 10px 15px; border-left: 4px solid #9333EA; margin-bottom: 15px; }
        .item { padding: 10px; border-bottom: 1px solid #E2E8F0; }
        .item:last-child { border-bottom: none; }
        .status-done { color: #16A34A; }
        .status-blocked { color: #DC2626; }
        .quote-box { background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); color: white; padding: 20px; border-radius: 8px; font-style: italic; text-align: center; margin: 20px 0; }
        .achievement { background: #F0FDF4; border-left: 4px solid #16A34A; padding: 10px; margin-bottom: 10px; }
        .footer { text-align: center; font-size: 12px; color: #999; padding-top: 20px; border-top: 1px solid #E2E8F0; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🌱 beyondGREEN</div>
          <div class="greeting">Good Evening Team! 🌙</div>
          <div style="color: #666; margin-top: 5px;">${today}</div>
        </div>

        <div class="section">
          <div class="section-title">✅ Today's Achievements (${completedTasks.data?.length || 0} completed)</div>
          ${completedTasks.data && completedTasks.data.length > 0 ? completedTasks.data.map((t: any) => `
            <div class="achievement">
              <div style="font-weight: bold; color: #16A34A;">✓ ${t.name}</div>
              <div style="font-size: 12px; color: #666;">Completed by ${t.assigned_to || 'team member'}</div>
            </div>
          `).join('') : '<div style="padding: 10px; color: #999;">Great work will come tomorrow!</div>'}
        </div>

        <div class="section">
          <div class="section-title">📦 Orders Created Today (${completedOrders.data?.length || 0})</div>
          ${completedOrders.data && completedOrders.data.length > 0 ? completedOrders.data.map((o: any) => `
            <div class="item">
              <div style="font-weight: bold;">${o.order_number || 'Order #' + o.id.substring(0, 8)}</div>
              <div style="font-size: 13px; color: #666;">Amount: $${(o.total_amount || 0).toLocaleString()} | Status: ${o.status}</div>
            </div>
          `).join('') : '<div style="padding: 10px; color: #999;">No new orders today</div>'}
        </div>

        <div class="section">
          <div class="section-title">🚚 Shipments Sent Today (${shipments.data?.length || 0})</div>
          ${shipments.data && shipments.data.length > 0 ? shipments.data.map((s: any) => `
            <div class="item">
              <div style="font-weight: bold;">Shipment ${s.id.substring(0, 8)}</div>
              <div style="font-size: 13px; color: #666;">Items: ${s.item_count || 1} | Status: ${s.status || 'Shipped'}</div>
            </div>
          `).join('') : '<div style="padding: 10px; color: #999;">Rest well, logistics managed smoothly today</div>'}
        </div>

        <div class="section">
          <div class="section-title">🚨 Needs Attention (${criticalTasks.data?.length || 0})</div>
          ${criticalTasks.data && criticalTasks.data.length > 0 ? criticalTasks.data.map((t: any) => `
            <div class="item">
              <div style="font-weight: bold; color: #DC2626;">⚠️ ${t.name}</div>
              <div style="font-size: 13px; color: #666;">Status: ${t.status} | Assigned to: ${t.assigned_to || 'Unassigned'}</div>
            </div>
          `).join('') : '<div style="padding: 10px; color: #999;">All critical tasks handled! 👏</div>'}
        </div>

        <div class="quote-box">
          "${quote}"
        </div>

        <div class="footer">
          beyondGREEN ERP • Automated Daily Digest<br/>
          This email was sent to all team members at 5:00 PM Pacific Time<br/>
          Have a great evening! 😊
        </div>
      </div>
    </body>
    </html>
    `

    // Send to all team members
    const results = await Promise.allSettled(
      TEAM_EMAILS.map(email =>
        resend.emails.send({
          from: 'beyondGREEN ERP <noreply@beyondgreeninc.com>',
          to: email,
          subject: `Good Evening! 🌙 – ${today}`,
          html
        })
      )
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    return NextResponse.json({
      success: true,
      message: `Good evening emails sent: ${successful} successful, ${failed} failed`,
      sent_to: successful,
      failed: failed
    })
  } catch (error) {
    console.error('Evening email error:', error)
    return NextResponse.json(
      { error: 'Failed to send evening emails' },
      { status: 500 }
    )
  }
}
