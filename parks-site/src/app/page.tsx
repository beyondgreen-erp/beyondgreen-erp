/**
 * Public homepage — Pet Waste Bag Program for Cities, HOAs and More!
 * Served at https://pet-waste-bag-program.vercel.app/
 *
 * Also served at /gov-pet-waste-bags for backwards-compatibility with the
 * older /lp/gov-pet-waste-bags URLs still in outbound sequence emails.
 */
import Script from 'next/script'
import GovPetWasteLanding from '@/components/GovPetWasteLanding'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SLUG = 'gov-pet-waste-bags'

function TrackingBeacon() {
  return (
    <Script id="lp-track" strategy="afterInteractive">{`
      (function() {
        try {
          var K = 'bg_session';
          var sid = localStorage.getItem(K);
          if (!sid) { sid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now()); localStorage.setItem(K, sid); }
          var q = new URLSearchParams(location.search);
          var body = JSON.stringify({
            slug: ${JSON.stringify(SLUG)}, session_id: sid,
            recipient_id: q.get('r') || null,
            utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'),
            referrer: document.referrer || null,
          });
          if (navigator.sendBeacon) navigator.sendBeacon('/api/lp/track', new Blob([body], { type: 'application/json' }));
          else fetch('/api/lp/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){});
        } catch (e) { /* ignore */ }
      })();
    `}</Script>
  )
}

export default function Home() {
  return (
    <>
      <TrackingBeacon />
      <GovPetWasteLanding slug={SLUG} ctaUrl="https://beyondgreenbiotech.com" />
    </>
  )
}
