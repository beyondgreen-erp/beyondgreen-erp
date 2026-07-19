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
  { img: 'https://byndgrn.com/cdn/shop/files/dog-waste-bags-200-count-core-roll-8-x-13-bulk-refill-made-in-usa-beyondgreen-3667880.png', title: 'Volume pricing from $0.032/bag', desc: 'Tiered wholesale that gets aggressive above 250k bags. Simple flat pricing on your PO — no ad-rev fine print required.' },
  { img: 'https://byndgrn.com/cdn/shop/files/dog-waste-bags-200-count-core-roll-8-x-13-bulk-refill-made-in-usa-beyondgreen-3705470.png', title: 'Domestic manufacturing', desc: 'Made in Santa Ana, CA. No overseas tariffs, no supply-chain surprises, no political headline risk.' },
  { img: 'https://byndgrn.com/cdn/shop/files/beyondgreen-single-pull-dog-waste-bag-dispenser-wallpole-mount-compatible-with-single-pull-header-packs-heavy-duty-construction-black-poop-bag-dispenser-beyondg-8532421.png', title: 'Free dispenser program', desc: 'Waste bag stations at zero upfront cost when you commit to volume — pole-mount or wall-mount, heavy-duty steel.' },
  { img: 'https://byndgrn.com/cdn/shop/files/beyondgreen-single-pull-dog-waste-bag-dispenser-wallpole-mount-compatible-with-single-pull-header-packs-heavy-duty-construction-gray-poop-bag-dispenser-beyondgr-4954045.png', title: 'Your city, your branding', desc: 'City seal, park district logo, sponsor slots, QR code — whatever fits. First run in 4 weeks.' },
  { img: 'https://byndgrn.com/cdn/shop/files/dog-poop-bag-dispenser-wall-pole-mount-dog-waste-station-front-load-made-in-usa-beyondgreen-black-poop-bag-dispenser-beyondgreen-1585543.png', title: 'Sponsor-friendly layout', desc: 'Room for 1–4 local sponsor slots on every bag. Vets, groomers, pet stores, insurance — sell them yourself.' },
  { img: 'https://byndgrn.com/cdn/shop/files/dog-poop-bag-dispenser-wall-pole-mount-dog-waste-station-front-load-made-in-usa-beyondgreen-gray-poop-bag-dispenser-beyondgreen-1814244.png', title: 'Turn-key logistics', desc: 'Auto-ship on your parks schedule. We stage inventory in warehouse. Your team just refills.' },
]

// Unsplash lifestyle photography — parks, dogs, communities — replaces the
// product-photo tiles above so the marketing page reads like an actual site.
const U = (id: string, w = 640, h = 420) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format&q=75`
BENEFITS[0].img = U('1441974231531-c6227db76b6e')
BENEFITS[1].img = U('1568605114967-8130f3a36994')
BENEFITS[2].img = U('1568393691622-c7ba131d63b4')
BENEFITS[3].img = U('1548199973-03cce0bbc87b')
BENEFITS[4].img = U('1552053831-71594a27632d')
BENEFITS[5].img = U('1560807707-8cc77767d783')

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
    q: 'What does the city actually pay?',
    a: 'Bags start at $0.032 each unprinted, $0.035 printed. Volume tiers kick in at 100k, 250k and 500k bags per year. Pay directly, or offset some or all of it with sponsor slots — your call. No hidden fees.'
  },
  {
    q: 'How long from PO to first shipment?',
    a: '4 weeks for a first custom run, then auto-ship on the cadence your parks team sets (usually every 30 or 60 days). Rush orders in 10 business days when you need them.'
  },
  {
    q: 'What material are the bags made from?',
    a: 'Made from certified compostable materials per California green-guide standards. We can share the material spec sheet and certifications on request. Most cities do not use the material claim as their public messaging — the value prop is USA-made, sponsored, and affordable.'
  },
  {
    q: 'Can we start with a small pilot?',
    a: 'Yes — pilot with one park district (usually 5,000–20,000 bags), measure, then roll out. We include a case-study template so your team can present the results internally.'
  },
]

// Volume-tiered wholesale pricing. As-low-as prices at 500k+ bags/year.
function pricePerBag(style: 'unprinted' | 'printed', bags: number): number {
  const base = style === 'unprinted' ? 0.032 : 0.035
  if (bags >= 500_000) return base
  if (bags >= 250_000) return base + 0.001
  if (bags >= 100_000) return base + 0.003
  if (bags >= 50_000)  return base + 0.005
  return base + 0.008
}

export default function GovPetWasteLanding({ slug, ctaUrl }: Props) {
  // Bag + sponsor break-even calculator state.
  // The math: you buy bags at a volume-tiered wholesale price. Local sponsors
  // pay to appear on the bag. We show the target sponsor rate that covers the
  // entire bag budget — a positive framing that gives procurement the number
  // they need to quote to potential sponsors.
  const [bagStyle, setBagStyle] = useState<'unprinted' | 'printed'>('printed')
  const [bagsPerYear, setBagsPerYear] = useState(500_000)
  const [sponsorSlots, setSponsorSlots] = useState(2)
  const perBag = pricePerBag(bagStyle, bagsPerYear)
  const annualBagCost = Math.round(perBag * bagsPerYear)
  const breakEvenAnnualPerSlot = sponsorSlots > 0 ? Math.round(annualBagCost / sponsorSlots) : 0
  const breakEvenPer1000PerSlot = sponsorSlots > 0 ? +((annualBagCost / bagsPerYear) * 1000 / sponsorSlots).toFixed(2) : 0

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
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'right' }}>Made in USA<br />From $0.032 / bag</div>
        </div>
      </div>

      {/* HERO */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 40, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'inline-block', background: '#DBFCE8', color: '#0D6B3E', fontWeight: 700, fontSize: 11, padding: '6px 12px', borderRadius: 999, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 18 }}>
              Pet Waste Bag Program
            </div>
            <h1 style={{ margin: '0 0 14px', fontSize: 42, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }}>
              <span style={{ color: '#00A84F' }}>Pet Waste Bag Program</span> for Cities, HOAs and More!
            </h1>
            <p style={{ margin: '0 0 20px', fontSize: 17, lineHeight: 1.55, color: '#4A5A73' }}>
              beyondGREEN dog waste bags, made in Santa Ana, CA. Wholesale from <b>$0.032/bag</b> unprinted, or <b>$0.035/bag</b> printed with your logo — plus sponsor slots so local vets and pet stores can cover the cost.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a href="#request" style={btnPrimary}>Request free samples →</a>
              <a href="#calculator" style={btnSecondary}>See the pricing math</a>
            </div>
            <div style={{ marginTop: 20, fontSize: 12, color: '#5A6E8A', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <span>✅ USA-made</span>
              <span>✅ 4-week lead time</span>
              <span>✅ Free dispensers for volume programs</span>
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
          <h2 style={{ margin: '0 0 8px', fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>Pricing & sponsor break-even</h2>
          <p style={{ color: '#93A5C5', fontSize: 13, margin: '0 0 20px', lineHeight: 1.55 }}>
            Pick your bag style and volume — we quote the tiered wholesale price. Then see the target sponsor rate that would zero out your bag budget. Anything above that is bonus revenue.
          </p>

          {/* Bag style toggle */}
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 4, marginBottom: 24 }}>
            <button onClick={() => setBagStyle('unprinted')} style={{ ...pillBtn, background: bagStyle === 'unprinted' ? '#00E68C' : 'transparent', color: bagStyle === 'unprinted' ? '#0F1C2E' : '#B8C3D2' }}>
              Black unprinted bags
            </button>
            <button onClick={() => setBagStyle('printed')} style={{ ...pillBtn, background: bagStyle === 'printed' ? '#00E68C' : 'transparent', color: bagStyle === 'printed' ? '#0F1C2E' : '#B8C3D2' }}>
              Green bags · black print
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={calcLabel}>Bags your parks use per year</label>
                <input type="range" min={25_000} max={5_000_000} step={25_000} value={bagsPerYear} onChange={e => setBagsPerYear(Number(e.target.value))} style={sliderStyle} />
                <div style={calcValue}>{bagsPerYear.toLocaleString()} bags</div>
                <div style={{ color: '#93A5C5', fontSize: 12, marginTop: 6 }}>Your unit price: <b style={{ color: '#00E68C' }}>${perBag.toFixed(3)}</b> / bag</div>
              </div>
              <div>
                <label style={calcLabel}>Sponsor slots on each bag <span style={{ color: '#93A5C5', fontWeight: 500 }}>(one sponsor per slot)</span></label>
                <input type="range" min={1} max={4} step={1} value={sponsorSlots} onChange={e => setSponsorSlots(Number(e.target.value))} style={sliderStyle} />
                <div style={calcValue}>{sponsorSlots} slot{sponsorSlots > 1 ? 's' : ''}</div>
                <div style={{ color: '#93A5C5', fontSize: 12, marginTop: 6 }}>{bagStyle === 'unprinted' ? 'Unprinted bags — sponsors would need branded stickers or dispenser signage.' : 'Green bags with sponsor logos printed alongside your city seal.'}</div>
              </div>

              {/* Tier reference card */}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, fontSize: 11, color: '#B8C3D2' }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 12, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 1 }}>Volume tier pricing</div>
                {[
                  ['25k – 49k', 0.008],
                  ['50k – 99k', 0.005],
                  ['100k – 249k', 0.003],
                  ['250k – 499k', 0.001],
                  ['500k +', 0],
                ].map(([lbl, up]) => {
                  const p = (bagStyle === 'unprinted' ? 0.032 : 0.035) + (up as number)
                  const active = perBag.toFixed(3) === p.toFixed(3)
                  return (
                    <div key={lbl as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: active ? '#00E68C' : '#B8C3D2', fontWeight: active ? 700 : 400 }}>
                      <span>{lbl}</span>
                      <span>${p.toFixed(3)} / bag{active ? '  ← you' : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ color: '#B8C3D2', fontSize: 13 }}>Annual bag budget</span>
                  <span style={{ fontSize: 26, fontWeight: 700 }}>{money(annualBagCost)}</span>
                </div>
                <div style={{ paddingTop: 14 }}>
                  <div style={{ color: '#00E68C', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8 }}>To fully cover your bag cost, each sponsor pays</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: 'rgba(0,230,140,0.08)', border: '1px solid rgba(0,230,140,0.25)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: '#B8C3D2', fontSize: 11 }}>Flat annual</div>
                      <div style={{ color: '#fff', fontSize: 22, fontWeight: 800, marginTop: 2 }}>{money(breakEvenAnnualPerSlot)}</div>
                      <div style={{ color: '#93A5C5', fontSize: 10, marginTop: 3 }}>per slot / year</div>
                    </div>
                    <div style={{ background: 'rgba(0,230,140,0.08)', border: '1px solid rgba(0,230,140,0.25)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: '#B8C3D2', fontSize: 11 }}>Per print run</div>
                      <div style={{ color: '#fff', fontSize: 22, fontWeight: 800, marginTop: 2 }}>${breakEvenPer1000PerSlot.toFixed(2)}</div>
                      <div style={{ color: '#93A5C5', fontSize: 10, marginTop: 3 }}>per 1,000 bags / slot</div>
                    </div>
                  </div>
                </div>
                <p style={{ color: '#93A5C5', fontSize: 11, marginTop: 14, lineHeight: 1.55 }}>
                  {bagsPerYear.toLocaleString()} bags × ${perBag.toFixed(3)} = {money(annualBagCost)} annual bag budget. Split across {sponsorSlots} sponsor slot{sponsorSlots > 1 ? 's' : ''}. Anything a sponsor pays <b>above</b> the break-even rate is revenue to the parks budget.
                </p>
              </div>
              <a href="#request" style={{ ...btnPrimary, marginTop: 16, width: '100%', textAlign: 'center' as const, display: 'block' }}>Get a formal quote →</a>
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
                Ask us how your city or HOA can get <span style={{ color: '#00A84F' }}>FREE dispensers</span> for every park.
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
            { n: '1', title: 'We ship real samples', desc: 'Free 200ct roll + 100ct dispenser pack + a printed pricing/tier sheet. Your parks team tests in the field for two weeks.', img: IMAGES.bagRoll1 },
            { n: '2', title: 'Pick your pricing model', desc: 'Straight wholesale, sponsor-covered, or hybrid. Attorney-reviewed sponsor agreement template is included.', img: IMAGES.dispBlack2 },
            { n: '3', title: 'First shipment in 4 weeks', desc: 'Custom-printed with your city seal + sponsor logos. Auto-ship on your cadence. We keep inventory staged for you.', img: IMAGES.parkStation2 },
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginTop: 20 }}>
          {BENEFITS.map((b, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 18, border: '1px solid #EAEEF3', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}>
              <div style={{ width: '100%', aspectRatio: '16 / 10', overflow: 'hidden', background: '#F5F7FA' }}>
                <img src={b.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
              <div style={{ padding: '20px 22px 22px' }}>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{b.title}</div>
                <div style={{ fontSize: 13.5, color: '#5A6E8A', lineHeight: 1.55 }}>{b.desc}</div>
              </div>
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
            { img: IMAGES.bagRoll2, title: 'beyondGREEN dog waste bags', tag: 'From $0.032' },
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
              <h2 style={{ margin: '0 0 10px', fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>Send real product samples to your parks team</h2>
              <p style={{ color: '#5A6E8A', fontSize: 15, lineHeight: 1.55, marginBottom: 18 }}>
                Free sample kit includes a full <b>200-count roll</b> of beyondGREEN dog waste bags, plus a <b>100-count single-pull pack</b> that fits the standard dispenser station. Ships in 1 business day.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#1A1D2E', fontSize: 13.5 }}>
                <li style={{ padding: '6px 0' }}>✅ 200ct core roll (8×13, refill for park trash cans)</li>
                <li style={{ padding: '6px 0' }}>✅ 100ct single-pull pack (fits the dispenser station header)</li>
                <li style={{ padding: '6px 0' }}>✅ Ships from Santa Ana, CA — arrives in 2–3 days</li>
                <li style={{ padding: '6px 0' }}>✅ Zero cost, zero obligation, real human follow-up (Rudy)</li>
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
                {submitting ? 'Sending…' : 'Ship me the samples →'}
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
            <a href={ctaUrl} target="_blank" rel="noreferrer" style={{ ...btnSecondary, borderColor: '#fff', color: '#fff', background: 'transparent' }}>Visit the website</a>
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
