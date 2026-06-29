// GET /api/track/open?id=<outreach_id>
// Invisible 1x1 pixel embedded in campaign emails. When the recipient's mail client
// loads it, we record the open on the outreach row + the customer's Activity feed,
// and nudge the win-probability up on the FIRST open.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 1x1 transparent GIF
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function pixel() {
  return new NextResponse(GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return pixel();
  try {
    const { data: row } = await supabase
      .from('customer_outreach')
      .select('id, customer_id, subject, sent_at, opened_at, open_count, sent_by')
      .eq('id', id)
      .single();

    if (row) {
      // Ignore opens within 30s of send — that's almost always the sender's own
      // mail client rendering the copy in their Sent folder, not the recipient.
      const sentMs = row.sent_at ? new Date(row.sent_at).getTime() : 0;
      const tooSoon = sentMs && Date.now() - sentMs < 30000;
      if (!tooSoon) {
        const firstOpen = !row.opened_at;
        await supabase.from('customer_outreach').update({
          opened_at: row.opened_at || new Date().toISOString(),
          last_opened_at: new Date().toISOString(),
          open_count: (row.open_count || 0) + 1,
        }).eq('id', id);

        if (firstOpen) {
          await supabase.from('customer_activity').insert({
            customer_id: row.customer_id, activity_type: 'email_open', source_type: 'outreach',
            source_id: row.id, source_label: row.subject, author_email: row.sent_by,
            content: `Opened email: "${row.subject}"`,
          }).then(() => {}, () => {});
          const { data: c } = await supabase.from('customers').select('probability').eq('id', row.customer_id).single();
          const cur = Number(c?.probability ?? 30);
          await supabase.from('customers').update({ probability: Math.min(100, cur + 10) }).eq('id', row.customer_id);
        }
      }
    }
  } catch {
    /* always return the pixel, even on error */
  }
  return pixel();
}
