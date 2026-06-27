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
  "The only impossible journey is the one you never begin. – Tony Robbins",
  "Great things never come from comfort zones. – Unknown",
  "Dream it, believe it, build it. – Unknown",
  "Success usually comes to those who are too busy to be looking for it. – Henry David Thoreau",
  "The way to get started is to quit talking and begin doing. – Walt Disney",
  "You miss 100% of the shots you don't take. – Wayne Gretzky",
  "Don't watch the clock; do what it does. Keep going. – Sam Levenson",
  "The only limit to our realization of tomorrow will be our doubts of today. – Franklin D. Roosevelt",
  "Greatness is not a function of circumstance. It's a function of conscious choice. – James C. Collins",
  "Opportunities don't happen. You create them. – Chris Grosser",
  "Success is not about getting rich. It's about getting better. – Unknown",
  "Your limitation—it's only your imagination. – Unknown",
  "Wake up with determination. Go to bed with satisfaction. – Unknown",
  "Do what you feel in your heart to be right. – Eleanor Roosevelt",
  "The most common way people give up their power is by thinking they don't have any. – Alice Walker",
  "Believe in yourself. You are braver than you believe, stronger than you seem, and smarter than you think. – A.A. Milne",
  "The harder you work for something, the greater you'll feel when you achieve it. – Unknown",
  "Dream bigger. Do bigger. – Unknown",
  "Don't stop when you're tired. Stop when you're done. – Unknown",
  "Wake up with purpose. – Unknown",
  "Do something today that your future self will thank you for. – Unknown",
  "Little things make big days. – Unknown",
  "It's going to be hard, but hard does not mean impossible. – Unknown",
  "Don't wait for opportunity. Create it. – Unknown",
  "Sometimes we're tested not to show our weaknesses, but to discover our strengths. – Unknown",
  "The key to success is to focus on goals, not obstacles. – Unknown",
  "Dream as if you'll live forever. Live as if you'll die today. – James Dean",
  "Strive for progress, not perfection. – Unknown",
  "Everything you want is on the other side of fear. – George Addair",
  "Believe you can and you're halfway there. – Theodore Roosevelt",
  "The best time to plant a tree was 20 years ago. The second best time is now. – Chinese Proverb",
  "Your limitation—it's only your imagination. – Unknown",
  "Push yourself, because no one else is going to do it for you. – Unknown",
  "Sometimes we do not realize our worth until someone comes along and reminds us. – Unknown",
  "Don't be afraid to fail. Be afraid not to try. – Unknown",
  "Fail forward. Failure is the stepping stone to success. – Unknown",
  "You don't have to be perfect to be amazing. – Unknown",
  "Passion is the genesis of genius. – Tony Robbins",
  "Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing. – Pelé",
  "The only place success comes before work is in the dictionary. – Vince Lombardi",
  "Your limitation—it's only your imagination. – Unknown",
  "Forget all the reasons why it won't work and believe the one reason why it will. – Unknown",
  "Courage is resistance to fear, mastery of fear—not absence of fear. – Mark Twain",
  "You must be the change you wish to see in the world. – Mahatma Gandhi",
  "Everything is possible to him who believes. – Mark 9:23",
  "Nothing is impossible to a willing heart. – John Heywood",
  "Only a man's character is the real criterion of worth. – Eleanor Roosevelt",
  "You know you're in love when you can't fall asleep because reality is finally better than your dreams. – Dr. Seuss",
  "Get busy living or get busy dying. – Stephen King",
  "The future belongs to those who believe in the beauty of their dreams. – Eleanor Roosevelt",
  "It is during our darkest moments that we must focus to see the light. – Aristotle",
  "The only impossible journey is the one you never begin. – Tony Robbins",
  "In the end, we only regret the chances we didn't take. – Lewis Carroll",
  "Life is what happens when you're busy making other plans. – John Lennon",
  "The way to do is to be. – Lao Tzu",
  "Success is not final, failure is not fatal: it is the courage to continue that counts. – Winston Churchill",
  "Believe you can and you're halfway there. – Theodore Roosevelt",
  "The best revenge is massive success. – Frank Sinatra",
  "Amateurs built the Ark, professionals built the Titanic. – Unknown",
  "Whoever is happy will make others happy too. – Anne Frank",
  "You will face many defeats in life, but never let yourself be defeated. – Maya Angelou",
  "In the middle of difficulty lies opportunity. – Albert Einstein",
  "The only time to eat diet food is while you're waiting for the steak to cook. – Julia Child",
  "Whoever is happy will make others happy too. – Anne Frank",
  "You will face many defeats in life, but never let yourself be defeated. – Maya Angelou",
  "Never bend your head. Always hold it high. Look the world straight in the eye. – Helen Keller",
  "Why fit in when you were born to stand out? – Dr. Seuss",
  "No matter what happens, or how bad it seems today, life does go on, and it will be better tomorrow. – Maya Angelou",
  "Don't let yesterday take up too much of today. – Will Rogers",
  "You learn more from failure than from success. – Unknown",
  "It's not whether you get knocked down, it's whether you get up. – Vince Lombardi",
  "If you are working on something that you really care about, you don't have to be pushed. The vision pulls you. – Steve Jobs",
  "People who are crazy enough to think they can change the world, are the ones who do. – Rob Siltanen",
  "Failure is success if we learn from it. – Malcolm S. Forbes",
  "The only person you are destined to become is the person you decide to be. – Ralph Waldo Emerson",
  "Life has got all those twists and turns. You've got to hold on to what you've got now. – Tom Hanks",
  "Go for it now. The future is promised to no one. – Wayne Gretzky",
  "You can either experience the pain of discipline or the pain of regret. – Jim Rohn",
  "Do what you have to do, to do what you want to do. – Oprah Winfrey",
  "Success is walking from failure to failure with no loss of enthusiasm. – Winston Churchill",
  "Don't watch the clock; do what it does. Keep going. – Sam Levenson",
  "The best way to predict the future is to create it. – Peter Drucker",
  "You don't have to be great to start, but you have to start to be great. – Zig Ziglar",
  "Failure is the condiment that gives success its flavor. – Truman Capote",
  "What's the point of being alive if you don't at least try to do something remarkable? – John Green",
  "Life is like riding a bicycle. To keep your balance, you must keep moving. – Albert Einstein",
  "Only a life lived for others is a life worthwhile. – Albert Einstein",
  "You have within you right now, everything you need to deal with whatever the world can throw at you. – Brian Tracy",
  "Believe in yourself. You are braver than you believe, stronger than you seem, and smarter than you think. – A.A. Milne",
  "I am not afraid of storms, for I am learning how to sail my ship. – Louisa May Alcott",
  "The only way to do great work is to love what you do. – Steve Jobs",
  "Your time is limited, so don't waste it living someone else's life. – Steve Jobs",
  "The future belongs to those who believe in the beauty of their dreams. – Eleanor Roosevelt",
  "It is during our darkest moments that we must focus to see the light. – Aristotle",
  "The only impossible journey is the one you never begin. – Tony Robbins",
  "In the middle of difficulty lies opportunity. – Albert Einstein",
  "Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing. – Pelé",
  "The only place success comes before work is in the dictionary. – Vince Lombardi",
  "Don't be afraid to give up the good to go for the great. – John D. Rockefeller",
  "I find that the harder I work, the more luck I seem to have. – Thomas Jefferson",
  "The road to success and the road to failure are almost exactly the same. – Colin R. Davis",
  "Success is not the key to happiness. Happiness is the key to success. If you love what you are doing, you will be successful. – Albert Schweitzer",
  "Success usually comes to those who are too busy to be looking for it. – Henry David Thoreau",
  "Don't let what you cannot do interfere with what you can do. – John Wooden",
  "You miss 100 percent of the shots you never take. – Wayne Gretzky",
  "Whether you think you can, or you think you can't—you're right. – Henry Ford",
  "The question isn't who is going to let me; it's who is going to stop me. – Ayn Rand",
  "When you have a dream, you've got to grab it and never let go. – Carol Burnett",
  "Nothing is impossible. The word itself says I'm possible! – Audrey Hepburn",
  "There is nothing impossible to they that will try. – Alexander the Great",
  "The bad news is time flies. The good news is you're the pilot. – Michael Altshuler",
  "Life has got all those twists and turns. It's up to us to choose where to go from here. – Tom Hanks",
  "The only limits you will ever face are the ones you believe in. – Unknown",
  "Your limitation—it's only your imagination. – Unknown",
  "With the right attitude, you can turn obstacles into opportunities. – Unknown",
  "Success is the sum of small efforts repeated day in and day out. – Robert Collier",
  "The greatest glory in living lies not in never falling, but in rising every time we fall. – Nelson Mandela",
  "The way to get started is to quit talking and begin doing. – Walt Disney",
  "Don't let yesterday take up too much of today. – Will Rogers",
  "You learn more from failure than from success. – Unknown",
  "It's not whether you get knocked down, it's whether you get up. – Vince Lombardi",
  "If you are working on something that you really care about, you don't have to be pushed. – Steve Jobs",
  "People who are crazy enough to think they can change the world, are the ones that do. – Rob Siltanen",
  "Failure is success if we learn from it. – Malcolm S. Forbes",
  "The only person you are destined to become is the person you decide to be. – Ralph Waldo Emerson",
  "You have within you right now, everything you need to deal with whatever the world can throw at you. – Brian Tracy",
  "Believe in yourself. You are braver than you believe, stronger than you seem, and smarter than you think. – A.A. Milne",
  "I am not afraid of storms, for I am learning how to sail my ship. – Louisa May Alcott",
  "The only way to do great work is to love what you do. – Steve Jobs",
  "Your time is limited, so don't waste it living someone else's life. – Steve Jobs",
  "The future belongs to those who believe in the beauty of their dreams. – Eleanor Roosevelt",
  "It is during our darkest moments that we must focus to see the light. – Aristotle",
  "The only impossible journey is the one you never begin. – Tony Robbins",
  "In the middle of difficulty lies opportunity. – Albert Einstein",
  "Don't be afraid to give up the good to go for the great. – John D. Rockefeller",
  "I find that the harder I work, the more luck I seem to have. – Thomas Jefferson",
  "The road to success and the road to failure are almost exactly the same. – Colin R. Davis",
  "Success is not the key to happiness. Happiness is the key to success. – Albert Schweitzer",
  "Success usually comes to those who are too busy to be looking for it. – Henry David Thoreau",
  "Don't let what you cannot do interfere with what you can do. – John Wooden",
  "You miss 100 percent of the shots you never take. – Wayne Gretzky",
  "Whether you think you can, or you think you can't—you're right. – Henry Ford",
  "The question isn't who is going to let me; it's who is going to stop me. – Ayn Rand",
  "When you have a dream, you've got to grab it and never let go. – Carol Burnett",
  "Nothing is impossible. The word itself says I'm possible! – Audrey Hepburn",
  "The bad news is time flies. The good news is you're the pilot. – Michael Altshuler",
  "Life is what happens when you're busy making other plans. – John Lennon",
  "The way to do is to be. – Lao Tzu",
  "An unexamined life is not worth living. – Socrates",
  "Turn your wounds into wisdom. – Oprah Winfrey",
  "Do what you feel in your heart to be right. – Eleanor Roosevelt",
  "The most common way people give up their power is by thinking they don't have any. – Alice Walker",
  "Nothing will work unless you do. – Maya Angelou",
  "The question is not who is going to let me; it's who is going to stop me. – Ayn Rand",
  "Fortune favors the bold. – Virgil",
  "A good plan violently executed now is better than a perfect plan next week. – George S. Patton",
  "Practice makes perfect. – Unknown",
  "Rome was not built in a day. – Unknown",
  "Slow and steady wins the race. – Aesop",
  "You must be willing to do the things today others won't do, in order to have the things tomorrow others won't have. – Les Brown",
  "The greatest threat to our success is success itself. – Unknown",
  "You don't rise to the level of your goals, you fall to the level of your systems. – James Clear",
  "Success is not a destination, it is a journey. – Unknown",
  "Your dreams are only impossible until they are not. – Unknown",
  "The best time to plant a tree was 20 years ago. The second best time is now. – Chinese Proverb",
  "Act as if what you do makes a difference. It does. – William James",
  "Everything you want is just outside your comfort zone. – Jack Canfield",
  "Great minds discuss ideas, average minds discuss events, small minds discuss people. – Eleanor Roosevelt",
  "Your education is a dress for life. – B.B. King",
  "Quality is not an act, it is a habit. – Aristotle",
  "The way to predict the future is to invent it. – Peter Drucker",
  "Do not go where the path may lead, go instead where there is no path and leave a trail. – Ralph Waldo Emerson",
  "It is not our differences that divide us. It is our inability to recognize, accept, and celebrate those differences. – Audre Lorde",
  "The only limit to our realization of tomorrow will be our doubts of today. – Franklin D. Roosevelt",
  "All our dreams can come true, if we have the courage to pursue them. – Walt Disney",
  "Yesterday is not ours to recover, but tomorrow is ours to win or lose. – Lyndon B. Johnson",
  "To handle yourself, use your head; to handle others, use your heart. – Eleanor Roosevelt",
  "Do what you have to do to do what you want to do. – Oprah Winfrey",
  "You don't fail until you stop trying. – Unknown",
  "It is impossible to fail completely as long as you learn something. – Unknown",
  "Your perspective determines your reality. – Unknown",
  "One step at a time is good walking. – Chinese Proverb",
  "The only way to discover the limits of the possible is to go beyond them into the impossible. – Arthur C. Clarke"
]

export async function GET(request: NextRequest) {
  try {
    const sb = createSupabaseServerClient()

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
        .quote-box { background: #3B6FE0; color: white; padding: 25px; border-radius: 8px; font-style: italic; text-align: center; margin: 20px 0; font-size: 16px; line-height: 1.6; border-left: 4px solid #0F1C2E; }
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
