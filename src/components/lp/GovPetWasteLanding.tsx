'use client'
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
import { useEffect, useMemo, useState } from 'react'

/**
 * Government pet waste bags landing page — client-rendered so we can wire up
 * the ad-revenue calculator, sample-request form submission, and FAQ accordion.
 * Renders inside /lp/[slug]/page.tsx when the slug is 'gov-pet-waste-bags'.
 */

interface Props {
  slug: string
  ctaUrl: string
}

// Real product images pulled from the beyondGREEN Shopify CDN — actual dog
// poop bag rolls, single-pull dispensers, and park waste stations. These are
// the same images the storefront serves, so no external dependency risk.
const IMAGES = {
  bagRoll1:    'https://byndgrn.com/cdn/shop/files/dog-waste-bags-200-count-core-roll-8-x-13-bulk-refill-made-in-usa-beyondgreen-1-roll-200-bags-dog-waste-bags-beyondgreen-2748026.png',
  bagRoll2:    'https://byndgrn.com/cdn/shop/files/dog-waste-bags-200-count-core-roll-8-x-13-bulk-refill-made-in-usa-beyondgreen-1-roll-200-bags-dog-waste-bags-beyondgreen-3667880.png',
  bagRoll3:    'https://byndgrn.com/cdn/shop/files/dog-waste-bags-200-count-core-roll-8-x-13-bulk-refill-made-in-usa-beyondgreen-1-roll-200-bags-dog-waste-bags-beyondgreen-3705470.png',
  bagRoll4:    'https://byndgrn.com/cdn/shop/files/ROLL_BACK_NO_BACKGROUND.png',
  dispBlack:   'https://byndgrn.com/cdn/shop/files/beyondgreen-single-pull-dog-waste-bag-dispenser-wallpole-mount-compatible-with-single-pull-header-packs-heavy-duty-construction-black-poop-bag-dispenser-beyondg-6921484.webp',
  dispBlack2:  'https://byndgrn.com/cdn/shop/files/beyondgreen-single-pull-dog-waste-bag-dispenser-wallpole-mount-compatible-with-single-pull-header-packs-heavy-duty-construction-black-poop-bag-dispenser-beyondg-8532421.png',
  dispGray:    'https://byndgrn.com/cdn/shop/files/beyondgreen-single-pull-dog-waste-bag-dispenser-wallpole-mount-compatible-with-single-pull-header-packs-heavy-duty-construction-gray-poop-bag-dispenser-beyondgr-4954045.png',
  dispClear:   'https://byndgrn.com/cdn/shop/files/DISPENSER_NO_BACKGROUND_fdd4cbc4-5f03-4e37-8f04-8ee952181000.png',
  parkStation:  'https://byndgrn.com/cdn/shop/files/dog-poop-bag-dispenser-wall-pole-mount-dog-waste-station-front-load-made-in-usa-beyondgreen-black-poop-bag-dispenser-beyondgreen-1585543.png',
  parkStation2: 'https://byndgrn.com/cdn/shop/files/dog-poop-bag-dispenser-wall-pole-mount-dog-waste-station-front-load-made-in-usa-beyondgreen-black-poop-bag-dispenser-beyondgreen-7970668.png',
  parkStationG: 'https://byndgrn.com/cdn/shop/files/dog-poop-bag-dispenser-wall-pole-mount-dog-waste-station-front-load-made-in-usa-beyondgreen-gray-poop-bag-dispenser-beyondgreen-1814244.png',
}

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const BENEFITS = [
  { emoji: '💰', title: 'Turn cost into revenue', desc: "Sell local ad space on every bag — vets, pet stores, groomers, insurance. Your city collects the cost of the bags, plus profit." },
  { emoji: '🇺🇸', title: 'Made in the USA', desc: 'Domestic manufacturing in Santa Ana, CA. No overseas tariffs, no supply-chain surprises, no political headline risk.' },
  { emoji: '🌱', title: 'Certified compostable', desc: 'BPI-certified, ASTM D6400. Breaks down alongside actual pet waste — no PLA-lined claims-only greenwash.' },
  { emoji: '🏷️', title: 'Your city, your branding', desc: 'City seal, park logo, sponsor ad, QR code, whatever fits. First run in 4 weeks.' },
  { emoji: '📦', title: 'Turn-key logistics', desc: 'Auto-ship on your parks schedule. We handle warehousing and staging. Your team just refills.' },
  { emoji: '📈', title: 'Real revenue model', desc: 'Public-works departments in TX, CA and NC are already using ad-supported bags. We can share their playbook.' },
]

const FAQS = [
  {
    q: 'Wait — cities can actually sell ads on pet waste bags?',
    a: 'Yes. Bag ads are considered "in-park signage" under most municipal codes, which are typically less restrictive than street signage. Cities like Austin (TX), Boulder (CO) and Cary (NC) run ad-supported dog-park programs. We include a legal-review checklist in your sample kit.'
  },
  {
    q: 'Who buys the sponsorship slots?',
    a: 'Local businesses that reach dog owners: veterinary practices, groomers, pet food stores, doggy daycare, dog trainers, plus regional insurance and real estate. Two common pricing structures: a flat annual sponsorship (typical $250–$1,500/slot/year for one sponsor to appear on every bag that year), or per print run ($10–$30 per 1,000 bags per slot). Cities pick whichever their finance office prefers to invoice.'
  },
  {
    q: 'What does the city pay?',
    a: 'You have three options: (1) Buy bags outright at $0.037 each. (2) Buy at cost, then sell ad space yourself and keep the margin. (3) Zero-cost program — beyondGREEN sells the ads and revenue-shares with your city. Most cities pick option 2.'
  },
  {
    q: 'How long from PO to first shipment?',
    a: '4 weeks for a first custom run, then auto-ship on the cadence your parks team sets (usually every 30 or 60 days). Rush orders in 10 business days when you need them.'
  },
  {
    q: 'Are they actually compostable in the field?',
    a: 'Yes. Home-compostable in typical park compost setups, industrial-compostable in municipal facilities. Certifications on request: BPI, ASTM D6400, TÜV OK Compost HOME.'
  },
  {
    q: 'Can we start with a small pilot?',
    a: 'Yes — pilot with one park district (usually 5,000–20,000 bags), measure, then roll out. We include a case-study template so your team can present the results internally.'
  },
]

export default function GovPetWasteLanding({ slug, ctaUrl }: Props) {
  // Ad revenue calculator state — physical-product pricing, not impressions.
  // Two realistic pricing models cities actually use:
  //   'annual'   → charge each advertiser a flat annual fee for their slot on every bag.
  //   'per-order' → charge per print run (per 1,000 bags per slot).
  const [pricingModel, setPricingModel] = useState<'annual' | 'per-order'>('annual')
  const [bagsPerYear, setBagsPerYear] = useState(500_000)
  const [adsPerBag, setAdsPerBag] = useState(2)
  const [annualFeePerSlot, setAnnualFeePerSlot] = useState(500)   // $ per advertiser per year
  const [ratePer1000Bags, setRatePer1000Bags] = useState(15)      // $ per 1,000 printed bags per slot
  const bagCost = 0.037

  const annualCost = bagsPerYear * bagCost
  const annualRevenue = pricingModel === 'annual'
    ? adsPerBag * annualFeePerSlot
    : Math.round((bagsPerYear / 1000) * ratePer1000Bags * adsPerBag)
  const netToCity = Math.round(annualRevenue - annualCost)
  const isProfit = netToCity > 0

  // FAQ open state
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  // Sample request form state
  const [form, setForm] = useState({ facility: '', name: '', email: '', address: '', note: '' })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ ok: boolean; msg: string } | null>(null)
  const recipientId = useMemo(() => {
    if (typeof window === 'undefined') return null
    const q = new URLSearchParams(window.location.search)
    return q.get('r')
  }, [])
  const sessionId = useMemo(() => {
    if (typeof window === 'undefined') return null
    try {
      let id = localStorage.getItem('bg_session')
      if (!id) { id = crypto.randomUUID(); localStorage.setItem('bg_session', id) }
      return id
    } catch { return null }
  }, [])

  async function submitSampleRequest(e: React.FormEvent) {
    e.preventDefault(); setDone(null); setSubmitting(true)
    try {
      const res = await fetch('/api/lp/sample-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, slug, recipient_id: recipientId, session_id: sessionId }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) setDone({ ok: false, msg: j.error || 'Something went wrong. Try emailing rudyp@beyondgreenbiotech.com.' })
      else setDone({ ok: true, msg: j.message || 'Request received.' })
    } catch (e: any) {
      setDone({ ok: false, msg: e?.message || 'Network error.' })
    }
    setSubmitting(false)
  }

  const [galleryIdx, setGalleryIdx] = useState(0)
  // Rotating hero shows: bag roll → single-pull dispenser (black+gray) → park waste station
  const galleryImages = [IMAGES.bagRoll1, IMAGES.dispBlack, IMAGES.parkStation, IMAGES.bagRoll3, IMAGES.dispGray, IMAGES.parkStationG]
  useEffect(() => {
    const t = setInterval(() => setGalleryIdx(i => (i + 1) % galleryImages.length), 3800)
    return () => clearInterval(t)
  }, [galleryImages.length])

  const sliderStyle = { width: '100%' as const }

  return (
    <div style={{ background: '#F5F7FA', minHeight: '100vh', color: '#1A1D2E', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif' }}>
      {/* Green banner */}
      <div style={{ background: 'linear-gradient(135deg,#00A84F 0%,#037f4c 100%)', color: '#fff', padding: '20px 20px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1 }}>beyondGREEN</div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: '#B6F0D0', marginTop: 4 }}>biotech · professional</div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'right' }}>Made in USA<br />Certified Compostable</div>
        </div>
      </div>

      {/* HERO */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 40, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'inline-block', background: '#DBFCE8', color: '#0D6B3E', fontWeight: 700, fontSize: 11, padding: '6px 12px', borderRadius: 999, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 18 }}>
              For city parks & procurement teams
            </div>
            <h1 style={{ margin: '0 0 14px', fontSize: 42, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }}>
              Turn pet waste bags into a <span style={{ color: '#00A84F' }}>revenue stream</span> for your city.
            </h1>
            <p style={{ margin: '0 0 20px', fontSize: 17, lineHeight: 1.55, color: '#4A5A73' }}>
              Made-in-USA, certified-compostable bags — customized with your city seal, park logo, or <b>local business ads that pay for the whole program</b>. Free samples, no obligation.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a href="#request" style={btnPrimary}>Request free samples →</a>
              <a href="#calculator" style={btnSecondary}>See the revenue math</a>
            </div>
            <div style={{ marginTop: 20, fontSize: 12, color: '#5A6E8A', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <span>✅ BPI-certified compostable</span>
              <span>✅ 4-week lead time</span>
              <span>✅ No minimums for pilots</span>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ background: '#fff', borderRadius: 24, padding: 18, boxShadow: '0 10px 40px rgba(0,168,79,0.15)' }}>
              <img key={galleryIdx} src={galleryImages[galleryIdx]} alt="" style={{ width: '100%', height: 320, objectFit: 'contain', borderRadius: 14, transition: 'opacity 0.4s' }} />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 12 }}>
                {galleryImages.map((_, i) => (
                  <button key={i} onClick={() => setGalleryIdx(i)} aria-label={`Show image ${i + 1}`} style={{ width: 8, height: 8, borderRadius: '50%', border: 0, cursor: 'pointer', background: i === galleryIdx ? '#00A84F' : '#D4D9E1' }} />
                ))}
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: -18, right: -8, background: '#0F1C2E', color: '#fff', padding: '10px 18px', borderRadius: 14, fontSize: 12, fontWeight: 600, boxShadow: '0 8px 20px rgba(0,0,0,0.15)' }}>
              $0.037/bag &nbsp;·&nbsp; USA-made
            </div>
          </div>
        </div>
      </div>

      {/* AD REVENUE CALCULATOR */}
      <div id="calculator" style={{ maxWidth: 1100, margin: '32px auto 0', padding: '0 24px' }}>
        <div style={{ background: 'linear-gradient(135deg, #0F1C2E 0%, #1E3A5F 100%)', color: '#fff', borderRadius: 24, padding: '36px 32px', boxShadow: '0 12px 40px rgba(15,28,46,0.25)' }}>
          <div style={{ display: 'inline-block', background: 'rgba(0,230,140,0.15)', color: '#00E68C', fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', padding: '6px 14px', borderRadius: 999, marginBottom: 14 }}>
            The math your council will ask about
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>Ad-revenue calculator</h2>
          <p style={{ color: '#93A5C5', fontSize: 13, margin: '0 0 20px', lineHeight: 1.55 }}>
            Pick how your city wants to charge sponsors. Bags are a physical product, so pricing is either a flat annual sponsorship fee or per print run — not CPM.
          </p>

          {/* Pricing model toggle */}
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 4, marginBottom: 24 }}>
            <button onClick={() => setPricingModel('annual')} style={{ ...pillBtn, background: pricingModel === 'annual' ? '#00E68C' : 'transparent', color: pricingModel === 'annual' ? '#0F1C2E' : '#B8C3D2' }}>
              Flat annual fee per slot
            </button>
            <button onClick={() => setPricingModel('per-order')} style={{ ...pillBtn, background: pricingModel === 'per-order' ? '#00E68C' : 'transparent', color: pricingModel === 'per-order' ? '#0F1C2E' : '#B8C3D2' }}>
              Rate per 1,000 bags
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={calcLabel}>Bags your parks use per year</label>
                <input type="range" min={50_000} max={5_000_000} step={50_000} value={bagsPerYear} onChange={e => setBagsPerYear(Number(e.target.value))} style={sliderStyle} />
                <div style={calcValue}>{bagsPerYear.toLocaleString()} bags</div>
              </div>
              <div>
                <label style={calcLabel}>Ad slots on each bag <span style={{ color: '#93A5C5', fontWeight: 500 }}>(one sponsor per slot per year)</span></label>
                <input type="range" min={1} max={4} step={1} value={adsPerBag} onChange={e => setAdsPerBag(Number(e.target.value))} style={sliderStyle} />
                <div style={calcValue}>{adsPerBag} slot{adsPerBag > 1 ? 's' : ''}</div>
              </div>
              {pricingModel === 'annual' ? (
                <div>
                  <label style={calcLabel}>Annual sponsorship fee per slot <span style={{ color: '#93A5C5', fontWeight: 500 }}>(typical: $250–$1,500 depending on city size)</span></label>
                  <input type="range" min={100} max={3000} step={50} value={annualFeePerSlot} onChange={e => setAnnualFeePerSlot(Number(e.target.value))} style={sliderStyle} />
                  <div style={calcValue}>${annualFeePerSlot.toLocaleString()} / slot / year</div>
                </div>
              ) : (
                <div>
                  <label style={calcLabel}>Rate charged per 1,000 bags per slot <span style={{ color: '#93A5C5', fontWeight: 500 }}>(sponsor pays with each print run)</span></label>
                  <input type="range" min={5} max={60} step={1} value={ratePer1000Bags} onChange={e => setRatePer1000Bags(Number(e.target.value))} style={sliderStyle} />
                  <div style={calcValue}>${ratePer1000Bags} / 1,000 bags</div>
                </div>
              )}
            </div>
            <div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ color: '#B8C3D2', fontSize: 13 }}>Annual bag cost</span>
                  <span style={{ fontSize: 22, fontWeight: 700 }}>{money(annualCost)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ color: '#B8C3D2', fontSize: 13 }}>Annual sponsorship revenue</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: '#00E68C' }}>+{money(annualRevenue)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 14 }}>
                  <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{isProfit ? 'Net to your budget' : 'Remaining program cost'}</span>
                  <span style={{ fontSize: 32, fontWeight: 800, color: isProfit ? '#00E68C' : '#FFB86B' }}>{isProfit ? '+' : ''}{money(netToCity)}</span>
                </div>
                <p style={{ color: '#93A5C5', fontSize: 11, marginTop: 14, lineHeight: 1.55 }}>
                  {pricingModel === 'annual'
                    ? <>Based on $0.037/bag wholesale × {bagsPerYear.toLocaleString()} bags + {adsPerBag} slot{adsPerBag > 1 ? 's' : ''} × ${annualFeePerSlot} annual sponsorship fee. Slot totals do not scale with print volume — they scale with how many sponsors you sign.</>
                    : <>Based on $0.037/bag wholesale × {bagsPerYear.toLocaleString()} bags + {adsPerBag} slot{adsPerBag > 1 ? 's' : ''} × ${ratePer1000Bags} per 1,000 bags. Sponsors are billed against each print run.</>
                  }
                </p>
              </div>
              <a href="#request" style={{ ...btnPrimary, marginTop: 16, width: '100%', textAlign: 'center' as const, display: 'block' }}>Get the pilot proposal →</a>
            </div>
          </div>
        </div>
      </div>

      {/* FREE DISPENSER STATIONS — the "wait, it gets better" moment */}
      <div style={{ maxWidth: 1100, margin: '48px auto 0', padding: '0 24px' }}>
        <div style={{ background: '#fff', borderRadius: 24, overflow: 'hidden', border: '2px solid #00A84F', boxShadow: '0 12px 32px rgba(0,168,79,0.15)', position: 'relative' as const }}>
          <div style={{ position: 'absolute' as const, top: 18, right: 18, background: '#FFD44D', color: '#4A3900', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' as const, padding: '6px 12px', borderRadius: 999 }}>
            Actually free
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <div style={{ padding: '48px 40px' }}>
              <div style={{ display: 'inline-block', background: '#DBFCE8', color: '#0D6B3E', fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' as const, padding: '6px 12px', borderRadius: 999, marginBottom: 14 }}>
                Free dispenser program
              </div>
              <h2 style={{ margin: '0 0 14px', fontSize: 38, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>
                Ask us how your city can get <span style={{ color: '#00A84F' }}>FREE dispensers</span> for every park.
              </h2>
              <p style={{ margin: '0 0 20px', fontSize: 16, lineHeight: 1.55, color: '#4A5A73' }}>
                We provide the <b>Waste Bag Stations</b> — pole-mount or wall-mount, made in the USA — at <b>zero upfront cost</b> to qualifying municipal programs. Your parks team gets a professional dispenser at every trailhead, dog park, and greenway. We recoup the hardware cost through the bag/ad program over 24 months.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
                {[
                  ['🏗️', 'Heavy-duty steel', 'Powder-coated, weatherproof, vandal-resistant.'],
                  ['🎨', 'City-branded', 'Add your seal, park district logo, and rules signage.'],
                  ['🔩', 'Wall or pole mount', 'Installs on existing park posts. No trenching, no permits.'],
                  ['📦', 'Refill in seconds', 'Front-load design. Any parks staffer can restock.'],
                ].map(([e, t, d], i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 22 }}>{e}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1A1D2E' }}>{t}</div>
                      <div style={{ fontSize: 12, color: '#5A6E8A', lineHeight: 1.5 }}>{d}</div>
                    </div>
                  </div>
                ))}
              </div>
              <a href="#request" style={btnPrimary}>Ask about free dispensers →</a>
              <p style={{ marginTop: 12, fontSize: 11, color: '#8A9FC0' }}>
                Program qualification: 100k+ bags/year commitment (or ad-supported model). Typical rollout: 8–24 stations per city.
              </p>
            </div>
            <div style={{ background: 'linear-gradient(135deg,#F5F7FA 0%,#E8F7EE 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 32px', position: 'relative' as const, minHeight: 460 }}>
              <img src={IMAGES.parkStation} alt="Park waste bag station" style={{ width: '100%', maxWidth: 340, height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 20px 24px rgba(0,0,0,0.15))' }} />
              <div style={{ position: 'absolute' as const, bottom: 22, right: 22, background: '#fff', borderRadius: 12, padding: '10px 14px', boxShadow: '0 8px 20px rgba(0,0,0,0.08)', fontSize: 12, fontWeight: 700, color: '#00A84F' }}>
                Value: $180 / station<br /><span style={{ color: '#0F1C2E', fontSize: 11, fontWeight: 500 }}>You pay: <s>$180</s> $0</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div style={{ maxWidth: 1100, margin: '48px auto 0', padding: '0 24px' }}>
        <h2 style={sectionH2}>How the program works</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 20 }}>
          {[
            { n: '1', title: 'We ship samples', desc: 'Free 50-bag sample kit + printed proposal. Your parks team tests in the field for two weeks.', img: IMAGES.bagRoll1 },
            { n: '2', title: 'Pick your revenue model', desc: 'Buy at cost, sell ads yourself, or let us handle the ads and revenue-share. Attorney-reviewed template included.', img: IMAGES.dispBlack2 },
            { n: '3', title: 'First shipment in 4 weeks', desc: 'Custom-printed with your city seal + advertiser logos. Auto-ship on your cadence. We keep inventory for you.', img: IMAGES.parkStation2 },
          ].map(s => (
            <div key={s.n} style={{ background: '#fff', borderRadius: 20, padding: 24, border: '1px solid #EAEEF3' }}>
              <div style={{ width: 36, height: 36, background: '#00A84F', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, marginBottom: 14 }}>{s.n}</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>{s.title}</div>
              <p style={{ fontSize: 13, color: '#5A6E8A', lineHeight: 1.55, marginBottom: 14 }}>{s.desc}</p>
              <img src={s.img} alt="" style={{ width: '100%', height: 160, objectFit: 'contain', background: '#F5F7FA', borderRadius: 12 }} />
            </div>
          ))}
        </div>
      </div>

      {/* BENEFITS GRID */}
      <div style={{ maxWidth: 1100, margin: '48px auto 0', padding: '0 24px' }}>
        <h2 style={sectionH2}>Why cities pick beyondGREEN</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 20 }}>
          {BENEFITS.map((b, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 16, padding: 22, border: '1px solid #EAEEF3' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>{b.emoji}</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{b.title}</div>
              <div style={{ fontSize: 13, color: '#5A6E8A', lineHeight: 1.55 }}>{b.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* PRODUCT LINE */}
      <div style={{ maxWidth: 1100, margin: '48px auto 0', padding: '0 24px' }}>
        <h2 style={sectionH2}>The full parks-and-rec compostable line</h2>
        <p style={{ color: '#5A6E8A', fontSize: 14, marginTop: 6 }}>Bags are just the start. Same domestic supply chain covers dispensers and even on-site composters.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 20 }}>
          {[
            { img: IMAGES.bagRoll2, title: 'Compostable dog-poop bags', tag: '$0.037/bag' },
            { img: IMAGES.dispGray, title: 'Single-pull wall dispensers', tag: 'Refill-ready' },
            { img: IMAGES.parkStationG, title: 'Full park waste stations', tag: 'Pole-mount' },
          ].map((p, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 20, padding: 20, border: '1px solid #EAEEF3' }}>
              <img src={p.img} alt={p.title} style={{ width: '100%', height: 200, objectFit: 'contain', background: '#F5F7FA', borderRadius: 12, marginBottom: 12 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1A1D2E' }}>{p.title}</div>
                <div style={{ fontSize: 11, fontWeight: 700, background: '#DBFCE8', color: '#0D6B3E', padding: '4px 10px', borderRadius: 999 }}>{p.tag}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SAMPLE REQUEST FORM */}
      <div id="request" style={{ maxWidth: 1100, margin: '56px auto 0', padding: '0 24px' }}>
        <div style={{ background: '#fff', borderRadius: 24, padding: 36, border: '1px solid #EAEEF3', boxShadow: '0 8px 30px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 40 }}>
            <div>
              <div style={{ display: 'inline-block', background: '#DBFCE8', color: '#0D6B3E', fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 999, marginBottom: 12 }}>Free samples</div>
              <h2 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>Get 50 sample bags for your parks team</h2>
              <p style={{ color: '#5A6E8A', fontSize: 15, lineHeight: 1.55, marginBottom: 18 }}>
                We ship the free sample kit within 1 business day. Includes: 50 unbranded bags in your preferred gallon size, printed pilot proposal, and the ad-revenue playbook you can bring to your city council.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#1A1D2E', fontSize: 13.5 }}>
                <li style={{ padding: '6px 0' }}>✅ No cost, no shipping, no obligation</li>
                <li style={{ padding: '6px 0' }}>✅ Goes directly to your parks facility address</li>
                <li style={{ padding: '6px 0' }}>✅ Ships from Santa Ana, CA — arrives in 2–3 days</li>
                <li style={{ padding: '6px 0' }}>✅ Follow-up is a real human (Rudy), not a drip funnel</li>
              </ul>
            </div>
            <form onSubmit={submitSampleRequest} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={fieldLabel}>City / department *</label>
                <input required value={form.facility} onChange={e => setForm(f => ({ ...f, facility: e.target.value }))} placeholder="City of Austin — Parks & Recreation" style={fieldInput} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={fieldLabel}>Your name *</label>
                  <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Maya Rodriguez" style={fieldInput} />
                </div>
                <div>
                  <label style={fieldLabel}>Email *</label>
                  <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@city.gov" style={fieldInput} />
                </div>
              </div>
              <div>
                <label style={fieldLabel}>Where should we ship the samples?</label>
                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="1600 Sample St, Austin, TX 78701" style={fieldInput} />
              </div>
              <div>
                <label style={fieldLabel}>Anything to know? (Park size, bag preference, ad interest…)</label>
                <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={3} placeholder="We manage 12 parks, currently spending ~$18k/yr on bags. Curious if the ad revenue model works for a mid-size city." style={{ ...fieldInput, resize: 'vertical' as const }} />
              </div>
              <button type="submit" disabled={submitting} style={{ ...btnPrimary, width: '100%', textAlign: 'center', border: 0, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1, marginTop: 4 }}>
                {submitting ? 'Sending…' : 'Send me the free sample kit →'}
              </button>
              {done && (
                <div style={{ padding: 12, borderRadius: 10, background: done.ok ? '#E7F9EF' : '#FCECEC', color: done.ok ? '#0D6B3E' : '#8B1A1A', fontSize: 13, lineHeight: 1.5 }}>
                  {done.ok ? '✅ ' : '⚠️ '}{done.msg}
                </div>
              )}
              <p style={{ fontSize: 11, color: '#8A9FC0', margin: '0 0 0 2px' }}>By submitting you agree we can email you the pilot proposal. We do not resell or share your info.</p>
            </form>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div style={{ maxWidth: 900, margin: '56px auto 0', padding: '0 24px' }}>
        <h2 style={sectionH2}>What procurement teams ask us</h2>
        <div style={{ marginTop: 20 }}>
          {FAQS.map((f, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 14, border: '1px solid #EAEEF3', marginBottom: 10, overflow: 'hidden' }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: '100%', background: 'transparent', border: 0, padding: '18px 22px', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontFamily: 'inherit' }}>
                <span style={{ fontWeight: 600, fontSize: 15, color: '#1A1D2E' }}>{f.q}</span>
                <span style={{ color: '#00A84F', fontSize: 20, transform: openFaq === i ? 'rotate(45deg)' : 'rotate(0)', transition: 'transform 0.2s', fontWeight: 800 }}>+</span>
              </button>
              {openFaq === i && (
                <div style={{ padding: '0 22px 20px', color: '#5A6E8A', fontSize: 14, lineHeight: 1.6 }}>{f.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* BOTTOM CTA */}
      <div style={{ maxWidth: 1100, margin: '56px auto 0', padding: '0 24px 64px' }}>
        <div style={{ background: 'linear-gradient(135deg,#00A84F 0%,#037f4c 100%)', color: '#fff', borderRadius: 24, padding: '40px 32px', textAlign: 'center' as const }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800 }}>Ready to make procurement your favorite email of the week?</h2>
          <p style={{ margin: '0 0 22px', fontSize: 15, color: '#DBFCE8' }}>Free samples, plus the full pilot proposal for your council meeting.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#request" style={{ ...btnPrimary, background: '#fff', color: '#00A84F' }}>Request free samples →</a>
            <a href={ctaUrl} target="_blank" rel="noreferrer" style={{ ...btnSecondary, borderColor: '#fff', color: '#fff', background: 'transparent' }}>Explore the full catalog</a>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ background: '#0F1C2E', color: '#B8C3D2', padding: '24px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 12, lineHeight: 1.6 }}>
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

// --- shared styles ---
const btnPrimary: React.CSSProperties = {
  display: 'inline-block', background: '#00A84F', color: '#fff', padding: '14px 26px',
  borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 15,
  boxShadow: '0 6px 16px rgba(0,168,79,0.25)', border: 0,
}
const btnSecondary: React.CSSProperties = {
  display: 'inline-block', background: '#fff', color: '#0F1C2E', padding: '14px 26px',
  borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 15,
  border: '1px solid #E4E6EE',
}
const sectionH2: React.CSSProperties = { margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: '#1A1D2E' }
const calcLabel: React.CSSProperties = { display: 'block', fontSize: 12, color: '#B8C3D2', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }
const calcValue: React.CSSProperties = { marginTop: 8, fontSize: 22, fontWeight: 700, color: '#fff' }
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#5A6E8A', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }
const fieldInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box' as const, border: '1px solid #E4E6EE', borderRadius: 10,
  padding: '11px 13px', fontSize: 14, fontFamily: 'inherit', background: '#FAFBFD',
  outline: 'none',
}
const pillBtn: React.CSSProperties = {
  border: 0, borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s',
}
