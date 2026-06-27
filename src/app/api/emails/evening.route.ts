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
  "Greatness is not a function of circumstance. It's a function of conscious choice. – James C. Collins",
  "Rest when you're weary. Refresh when you're tired. Restore when you're drained. – Unknown",
  "Today you were just as you needed to be. Tomorrow you'll be better. – Unknown",
  "A day well spent deserves a night well rested. – Unknown",
  "End your day with gratitude for what you have learned and achieved. – Unknown",
  "You made it through another day. That's a victory worth celebrating. – Unknown",
  "Tonight, rest your body and mind. Tomorrow brings new possibilities. – Unknown",
  "The best part of the day is knowing you gave it your all. – Unknown",
  "Close your eyes to yesterday, and rest for tomorrow. – Unknown",
  "A good night's sleep is the best remedy for tomorrow. – Unknown",
  "Celebrate the small wins, rest well, and rise ready. – Unknown",
  "You've earned this rest. Sleep well and wake renewed. – Unknown",
  "As the day ends, let go of the stress and embrace the peace. – Unknown",
  "The night is a canvas for tomorrow's masterpiece. – Unknown",
  "Rest is not a reward for completing work; it is a requirement for good work. – Unknown",
  "Every sunset brings the promise of a new dawn. – Ralph Waldo Emerson",
  "The stars are visible because of the darkness. – Unknown",
  "Sleep is the golden chain that ties health and our bodies together. – Thomas Dekker",
  "Let tonight be the beginning of your peaceful tomorrow. – Unknown",
  "You did good today. Now rest well. – Unknown",
  "Close the day with a grateful heart. – Unknown",
  "Reflect on today's wins, rest easy, wake stronger. – Unknown",
  "The night offers silence, peace, and renewal. – Unknown",
  "A restful night is the best preparation for success. – Unknown",
  "Today is done. You did your best. Now rest. – Unknown",
  "Peace comes to those who let go and rest. – Unknown",
  "The day has been lived. Now it's time to dream. – Unknown",
  "Tomorrow waits. Tonight, rest. – Unknown",
  "Breathe. Relax. You've done enough for today. – Unknown",
  "The night is your sanctuary. Enjoy it. – Unknown",
  "As day turns to night, turn toward peace. – Unknown",
  "You survived another day. Rest assured, you'll do it again tomorrow. – Unknown",
  "The goal is not to achieve more, but to rest deeper. – Unknown",
  "Sleep tight. Tomorrow is a brand new page. – Unknown",
  "In the quiet of the night, find peace in knowing you gave your best. – Unknown",
  "Rest is productivity. Sleep is success. – Unknown",
  "The best time to reflect is at the end of the day. The best time to rest is in the night. – Unknown",
  "Forgive yourself for today's mistakes and rest easy. – Unknown",
  "Night time reminds us that rest is not laziness—it's survival. – Unknown",
  "You are stronger because you rested. – Unknown",
  "The day is complete. Your efforts have value. Now rest. – Unknown",
  "Sleep is the most valuable investment you can make in tomorrow. – Unknown",
  "As the sun sets, let your worries set with it. – Unknown",
  "A mind at peace brings a body at rest. – Unknown",
  "Tonight, be proud of yourself. Tomorrow, be yourself. – Unknown",
  "Rest isn't giving up, it's gearing up. – Unknown",
  "The night is nature's way of saying 'try again tomorrow.' – Unknown",
  "You've planted the seeds today. Tonight, rest as they grow. – Unknown",
  "Peace is not the absence of struggle; it's the presence of rest. – Unknown",
  "Sleep well, knowing you've made progress. – Unknown",
  "Tomorrow will thank you for resting tonight. – Unknown",
  "The day has ended, but your impact continues. Rest with that knowledge. – Unknown",
  "Every night is a chance to recharge and reimagine. – Unknown",
  "You deserve this rest. Take it with gratitude. – Unknown",
  "Night comes after day. Rest comes after effort. Both are necessary. – Unknown",
  "Close your eyes. Not to forget, but to remember you gave your best. – Unknown",
  "A peaceful night is earned by a purposeful day. – Unknown",
  "The night is your reward for the day. Enjoy it. – Unknown",
  "Let tomorrow worry about itself. Tonight, rest. – Unknown",
  "You're stronger for having tried. You're wiser for having fallen. Rest with that power. – Unknown",
  "Sleep is not lost time; it's time well invested. – Unknown",
  "As darkness falls, let peace rise. – Unknown",
  "The best part of today is knowing you'll have a chance to do better tomorrow. – Unknown",
  "Rest well. You've earned it. – Unknown",
  "Night is the world's way of saying 'you did enough.' – Unknown",
  "In the silence of night, hear the applause for your effort. – Unknown",
  "A good day ends with good rest. – Unknown",
  "Tomorrow is waiting. Tonight, recharge. – Unknown",
  "Let the evening calm your mind and the night renew your spirit. – Unknown",
  "You are progress in progress. Rest on that. – Unknown",
  "Night falls. Worries fade. Peace prevails. – Unknown",
  "Sleep is a gift you give yourself. – Unknown",
  "The day may be over, but your legacy continues. Rest proudly. – Unknown",
  "Quiet nights create powerful days. – Unknown",
  "As you close your eyes, open your heart to tomorrow's possibilities. – Unknown",
  "Rest is not a reward for the accomplished; it's fuel for the ambitious. – Unknown",
  "Tonight, celebrate not perfection, but effort. – Unknown",
  "The night is long enough for all your dreams. – Unknown",
  "You did it. You made it through. Now rest. – Unknown",
  "Peace is just a good night's sleep away. – Unknown",
  "Sleep well, dream big, wake ready. – Unknown",
  "The day gave its best. Now it's night's turn to offer rest. – Unknown",
  "Let tonight be a thank you to your body for another day. – Unknown",
  "Rest is courage. – Unknown",
  "As the world sleeps, know that your efforts matter. – Unknown",
  "Night brings rest, dreams, and hope for tomorrow. – Unknown",
  "The best revenge on a hard day is a good night's sleep. – Unknown",
  "You've done enough for today. More than enough. Now rest. – Unknown",
  "Every night is a chance to start fresh. – Unknown",
  "Sleep tight, dream brightly, wake mightily. – Unknown",
  "The night doesn't judge your day. It just heals it. – Unknown",
  "Rest easy knowing you're becoming who you meant to be. – Unknown",
  "As the evening falls, let gratitude rise. – Unknown",
  "You don't have to be perfect to deserve rest. – Unknown",
  "Night is proof that light returns. Rest knowing tomorrow comes. – Unknown",
  "A well-rested person is a well-prepared person. – Unknown",
  "Let the quiet of night strengthen your resolve for tomorrow. – Unknown",
  "You're not behind. You're exactly where you need to be. Rest on that. – Unknown",
  "Peace is available every night. All you have to do is claim it. – Unknown",
  "Rest isn't a reward for perfection; it's a requirement for growth. – Unknown",
  "The night holds no judgment. Only peace. – Unknown",
  "Tomorrow waits for the rested version of you. – Unknown",
  "A good day's work calls for a good night's rest. – Unknown",
  "As you drift to sleep, drift into gratitude. – Unknown",
  "You survived. You thrived. You rest. – Unknown",
  "The night is nature's reset button. – Unknown",
  "Sleep is self-care in its purest form. – Unknown",
  "Let tonight heal what today tested. – Unknown",
  "Rest well, so you can rise well. – Unknown",
  "The day is done. You are enough. Now rest. – Unknown",
  "Night falls to remind us: rest is not laziness, it's wisdom. – Unknown",
  "Close your eyes on today's effort. Open them on tomorrow's opportunity. – Unknown",
  "A rested mind is a powerful mind. – Unknown",
  "The night is your reset. Use it. – Unknown",
  "You've done what you could. That's all you can do. Rest with that. – Unknown",
  "Sleep is the body's love letter to the soul. – Unknown",
  "As the night deepens, let your peace deepen too. – Unknown",
  "Rest is an action, not an absence. – Unknown",
  "You're not losing time by sleeping. You're gaining tomorrow. – Unknown",
  "The night is long and full of rest. – Unknown",
  "Rest well. You're worth it. – Unknown"
]

export async function GET(request: NextRequest) {
  try {
    const sb = createSupabaseServerClient()

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
        .quote-box { background: #9333EA; color: white; padding: 25px; border-radius: 8px; font-style: italic; text-align: center; margin: 20px 0; font-size: 16px; line-height: 1.6; border-left: 4px solid #0F1C2E; }
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
