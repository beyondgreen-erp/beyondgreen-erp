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

const MORNING_QUOTES = [
  "Success is the sum of small efforts repeated day in and day out. – Robert Collier",
  "The only way to do great work is to love what you do. – Steve Jobs",
  "Believe you can and you're halfway there. – Theodore Roosevelt",
  "Excellence is not a destination; it is a continuous journey that never ends. – Brian Tracy",
  "Your time is limited, don't waste it living someone else's life. – Steve Jobs",
  "The future belongs to those who believe in the beauty of their dreams. – Eleanor Roosevelt",
  "It does not matter how slowly you go as long as you do not stop. – Confucius",
  "Success is not final, failure is not fatal. – Winston Churchill",
  "You are never too old to set another goal or to dream a new dream. – C.S. Lewis",
  "The only impossible journey is the one you never begin. – Tony Robbins"
]

export async function GET(request: NextRequest) {
  try {
    const sb = await createSupabaseServerClient()

    // Fetch data for the email
    const yesterday5pm = new Date()
    yesterday5pm.setDate(yesterday5pm.getDate() - 1)
    yesterday5pm.setHours(17, 0, 0, 0)

    const [tasks, orders, inventory, comments] = await Promise.all([
      sb.from('tasks').select('*').not('status', 'in', '("Done","Archived")').order('due_date', { ascending: true }).limit(15),
      sb.from('sales_orders').select('*').gt('created_at', yesterday5pm.toISOString()).limit(5),
      sb.from('walmart_inventory').select('*').lt('on_hand_qty', 'reorder_point').limit(10),
      sb.from('comments').select('*').gt('created_at', yesterday5pm.toISOString()).limit(3)
    ])

    const quote = MORNING_QUOTES[Math.floor(Math.random() * MORNING_QUOTES.length)]
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #3B6FE0; padding-bottom: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #0F1C2E; margin-bottom: 10px; }
        .greeting { font-size: 28px; font-weight: bold; color: #3B6FE0; margin: 10px 0; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: bold; color: #0F1C2E; background: #F0F4FF; padding: 10px 15px; border-left: 4px solid #3B6FE0; margin-bottom: 15px; }
        .task-item { padding: 10px; border-bottom: 1px solid #E2E8F0; }
        .task-item:last-child { border-bottom: none; }
        .priority-high { color: #DC2626; font-weight: bold; }
        .priority-medium { color: #EA580C; font-weight: bold; }
        .priority-low { color: #6B7280; font-weight: bold; }
        .quote-box { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; font-style: italic; text-align: center; margin: 20px 0; }
        .footer { text-align: center; font-size: 12px; color: #999; padding-top: 20px; border-top: 1px solid #E2E8F0; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🌱 beyondGREEN</div>
          <div class="greeting">Good Morning Team! 👋</div>
          <div style="color: #666; margin-top: 5px;">${today}</div>
        </div>

        <div class="section">
          <div class="section-title">📋 Pending Tasks (${tasks.data?.length || 0})</div>
          ${tasks.data && tasks.data.length > 0 ? tasks.data.map((t: any) => `
            <div class="task-item">
              <div style="font-weight: bold;">${t.name}</div>
              <div style="font-size: 13px; color: #666;">Due: ${t.due_date ? new Date(t.due_date).toLocaleDateString() : 'No due date'} | <span class="priority-${t.priority?.toLowerCase()}">${t.priority || 'Medium'}</span></div>
              <div style="font-size: 12px; color: #999;">Assigned to: ${t.assigned_to || 'Unassigned'}</div>
            </div>
          `).join('') : '<div style="padding: 10px; color: #999;">All caught up! ✓</div>'}
        </div>

        <div class="section">
          <div class="section-title">📦 New Orders (${orders.data?.length || 0})</div>
          ${orders.data && orders.data.length > 0 ? orders.data.map((o: any) => `
            <div class="task-item">
              <div style="font-weight: bold;">${o.order_number || 'Order #' + o.id.substring(0, 8)}</div>
              <div style="font-size: 13px; color: #666;">Status: ${o.status} | Amount: $${(o.total_amount || 0).toLocaleString()}</div>
            </div>
          `).join('') : '<div style="padding: 10px; color: #999;">No new orders today</div>'}
        </div>

        <div class="section">
          <div class="section-title">⚠️ Inventory Low (${inventory.data?.length || 0})</div>
          ${inventory.data && inventory.data.length > 0 ? inventory.data.map((i: any) => `
            <div class="task-item">
              <div style="font-weight: bold;">${i.sku}</div>
              <div style="font-size: 13px; color: #666;">On hand: ${i.on_hand_qty} | Reorder point: ${i.reorder_point}</div>
            </div>
          `).join('') : '<div style="padding: 10px; color: #999;">All stock levels healthy ✓</div>'}
        </div>

        <div class="quote-box">
          "${quote}"
        </div>

        <div class="footer">
          beyondGREEN ERP • Automated Daily Digest<br/>
          This email was sent to all team members at 8:00 AM Pacific Time
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
          subject: `Good Morning Team! 🌱 – ${today}`,
          html
        })
      )
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    return NextResponse.json({
      success: true,
      message: `Good morning emails sent: ${successful} successful, ${failed} failed`,
      sent_to: successful,
      failed: failed
    })
  } catch (error) {
    console.error('Morning email error:', error)
    return NextResponse.json(
      { error: 'Failed to send morning emails' },
      { status: 500 }
    )
  }
}
