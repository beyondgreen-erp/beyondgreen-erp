/**
 * Public marketing landing page. Rendered outside the ERP auth boundary
 * (see middleware.ts). Server-fetches the page config from Supabase and
 * fires a visit-tracking beacon on load.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound } from 'next/navigation'
import Script from 'next/script'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getPage(slug: string) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data } = await sb.from('landing_pages').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()
  return data
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) notFound()

  const benefits: { title: string; desc: string }[] = Array.isArray(page.benefits) ? page.benefits : []

  return (
    <div style={{ margin: 0, background: '#F5F7FA', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif', color: '#1A1D2E' }}>
      {/* Tracking beacon — fires once per page load with query params */}
      <Script id="lp-track" strategy="afterInteractive">{`
        (function() {
          try {
            var K = 'bg_session';
            var sid = localStorage.getItem(K);
            if (!sid) { sid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now()); localStorage.setItem(K, sid); }
            var q = new URLSearchParams(location.search);
            var body = JSON.stringify({
              slug: ${JSON.stringify(slug)},
              session_id: sid,
              recipient_id: q.get('r') || null,
              utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'),
              referrer: document.referrer || null,
            });
            if (navigator.sendBeacon) {
              navigator.sendBeacon('/api/lp/track', new Blob([body], { type: 'application/json' }));
            } else {
              fetch('/api/lp/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){});
            }
          } catch (e) { /* ignore */ }
        })();
      `}</Script>

      {/* Green branded header */}
      <div style={{ background: 'linear-gradient(135deg, #00A84F 0%, #037f4c 100%)', color: '#fff', padding: '28px 20px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1 }}>beyondGREEN</div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: '#B6F0D0', marginTop: 4 }}>biotech · professional</div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'right' }}>Made in USA<br />Certified Compostable</div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: page.hero_image_url ? '1.15fr 1fr' : '1fr', gap: 40, alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 14px', fontSize: 38, fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.5 }}>{page.headline}</h1>
            {page.subhead && <p style={{ margin: '0 0 24px', fontSize: 18, lineHeight: 1.55, color: '#5A6E8A' }}>{page.subhead}</p>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href={page.cta_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: '#00A84F', color: '#fff', padding: '14px 26px', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 15, boxShadow: '0 4px 12px rgba(0,168,79,0.25)' }}>
                {page.cta_label} →
              </a>
              <a href={`mailto:rudyp@beyondGREENbiotech.com?subject=Interested%20in%20${encodeURIComponent(page.title)}`} style={{ display: 'inline-block', background: '#fff', color: '#0F1C2E', padding: '14px 26px', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 15, border: '1px solid #E4E6EE' }}>
                Request free samples
              </a>
            </div>
          </div>
          {page.hero_image_url && (
            <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}>
              <img src={page.hero_image_url} alt="" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 12 }} />
            </div>
          )}
        </div>
      </div>

      {/* Benefits grid */}
      {benefits.length > 0 && (
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px 48px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {benefits.map((b, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '20px 22px', border: '1px solid #E4E6EE' }}>
                <div style={{ fontWeight: 700, fontSize: 17, color: '#0F1C2E', marginBottom: 6 }}>{b.title}</div>
                <div style={{ fontSize: 14, color: '#5A6E8A', lineHeight: 1.55 }}>{b.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom body HTML if provided */}
      {page.body_html && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px 48px' }} dangerouslySetInnerHTML={{ __html: page.body_html }} />
      )}

      {/* Bottom CTA */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 64px', textAlign: 'center' }}>
        <div style={{ background: '#fff', border: '1px solid #E4E6EE', borderRadius: 16, padding: '40px 32px' }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 26, fontWeight: 800 }}>Ready to see it in your park?</h2>
          <p style={{ margin: '0 0 22px', color: '#5A6E8A', fontSize: 16 }}>Grab free samples or explore the full compostable product line.</p>
          <a href={page.cta_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: '#00A84F', color: '#fff', padding: '14px 30px', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 15 }}>
            {page.cta_label} →
          </a>
        </div>
      </div>

      {/* Dark footer */}
      <div style={{ background: '#0F1C2E', color: '#B8C3D2', padding: '28px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 12, lineHeight: 1.6 }}>
          <div>
            <div style={{ color: '#00E68C', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>beyondGREEN biotech</div>
            1202 E. Wakeham Ave., Santa Ana, CA 92705<br />(866) 364-9466 · rudyp@beyondGREENbiotech.com
          </div>
          <div>
            <a href="https://beyondgreenbiotech.com" style={{ color: '#00E68C', textDecoration: 'none', fontWeight: 600 }}>beyondgreenbiotech.com</a>
          </div>
        </div>
      </div>
    </div>
  )
}
