'use client'
// Sign-in / sign-up / reset screens for the client portal, styled to match byndgrn.com:
// white canvas with soft green glow, Sora headlines, mono eyebrows, glass form card,
// and a showcase panel of rotating lifestyle photos with floating "live" cards.
import Link from 'next/link'

export const AUTH_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600;700&display=swap');
.pa{font-family:Inter,system-ui,-apple-system,sans-serif;color:#10231A;background:#FFFFFF;min-height:100vh}
.pa *{box-sizing:border-box}
.pa-sora{font-family:Sora,Inter,sans-serif}
.pa-mono{font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;font-size:12px;font-weight:600;color:#0E9C45;text-transform:uppercase}
.pa-grad{background:linear-gradient(100deg,#0E9C45 0%,#5FBF3A 60%,#7BD155 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.pa-glass{background:rgba(255,255,255,.78);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(220,232,221,.95);box-shadow:0 30px 80px -40px rgba(16,35,26,.35)}
.pa-in{width:100%;height:48px;border-radius:14px;border:1px solid #DCE8DD;background:#FFFFFF;padding:0 16px;font-size:15px;color:#10231A;outline:none;transition:border-color .2s,box-shadow .2s}
.pa-in:focus{border-color:#0E9C45;box-shadow:0 0 0 4px rgba(14,156,69,.14)}
textarea.pa-in{height:auto;padding:12px 16px}
.pa-lbl{display:block;font-size:12px;font-weight:600;color:#3D5446;margin-bottom:6px}
.pa-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;height:52px;border-radius:999px;border:0;background:#0E9C45;color:#FFFFFF;font-weight:700;font-size:15px;cursor:pointer;transition:transform .25s,box-shadow .25s,background .25s;box-shadow:0 14px 30px -14px rgba(14,156,69,.8)}
.pa-btn:hover{background:#0B8A3C;transform:translateY(-1px)}
.pa-btn:disabled{opacity:.55;cursor:default;transform:none}
.pa-ghost{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 18px;border-radius:999px;border:1.5px solid #0E9C45;color:#0E9C45;font-weight:600;font-size:14px;text-decoration:none;background:transparent}
.pa-ghost:hover{background:#F0F8F2}
.pa-link{color:#0E9C45;font-weight:600;text-decoration:none}.pa-link:hover{text-decoration:underline}
.pa-chip{display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:999px;border:1px solid #DCE8DD;background:#FFFFFF;font-size:13px;font-weight:600;color:#3D5446;cursor:pointer;transition:all .2s}
.pa-chip[data-on="1"]{background:#0E9C45;border-color:#0E9C45;color:#FFFFFF}
.pa-err{background:#FDECEC;border:1px solid #F5C6C6;color:#B4231F;border-radius:14px;padding:10px 14px;font-size:14px}
@keyframes paOrb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(40px,-30px) scale(1.08)}}
.pa-orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.42;pointer-events:none;animation:paOrb 16s ease-in-out infinite}
.pa-orb2{animation-duration:22s;animation-direction:reverse}
@keyframes paRise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
.pa-r{animation:paRise .8s cubic-bezier(.2,.7,.2,1) both}.pa-d1{animation-delay:.08s}.pa-d2{animation-delay:.16s}.pa-d3{animation-delay:.24s}
@keyframes paFade{0%{opacity:0;transform:scale(1.08)}6%{opacity:1}25%{opacity:1}31%{opacity:0;transform:scale(1)}100%{opacity:0}}
.pa-slide{position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;animation:paFade 24s infinite}
@keyframes paFloat{0%,100%{transform:translateY(0) rotate(-1.2deg)}50%{transform:translateY(-12px) rotate(1.2deg)}}
.pa-float{animation:paFloat 7s ease-in-out infinite}
@keyframes paPulse{0%,100%{box-shadow:0 0 0 0 rgba(123,209,85,.6)}70%{box-shadow:0 0 0 10px rgba(123,209,85,0)}}
.pa-dot{width:9px;height:9px;border-radius:50%;background:#7BD155;animation:paPulse 2s infinite;flex-shrink:0;display:inline-block}
@keyframes paBar{from{width:12%}to{width:68%}}
.pa-bar{height:6px;border-radius:999px;background:linear-gradient(90deg,#0E9C45,#7BD155);animation:paBar 2.4s cubic-bezier(.2,.7,.2,1) .4s both}
.pa-grid{display:grid;grid-template-columns:1fr;min-height:100vh}
.pa-show{display:none}
@media (min-width:1024px){.pa-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr)}.pa-show{display:block}.pa-mobile-photo{display:none}}
@media (prefers-reduced-motion:reduce){.pa-orb,.pa-r,.pa-slide,.pa-float,.pa-dot,.pa-bar{animation:none}.pa-slide:first-child{opacity:1}}
`

const PHOTOS = ['/portal/p1.jpg', '/portal/p2.jpg', '/portal/p3.jpg', '/portal/p4.jpg']

function Showcase() {
  return (
    <div className="pa-show" style={{ padding: 16 }}>
      <div style={{ position: 'sticky', top: 16, height: 'calc(100vh - 32px)', minHeight: 640, borderRadius: 32, overflow: 'hidden', background: '#10231A' }}>
        {PHOTOS.map((p, i) => <div key={p} className="pa-slide" style={{ backgroundImage: `url(${p})`, animationDelay: `${i * 6}s` }} />)}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(16,35,26,.15) 0%, rgba(16,35,26,.05) 40%, rgba(16,35,26,.85) 100%)' }} />

        {/* floating live cards */}
        <div className="pa-float pa-glass" style={{ position: 'absolute', top: 40, right: 40, width: 280, borderRadius: 22, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="pa-mono" style={{ fontSize: 11 }}>Order SO 31790</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', background: '#E8F0FE', borderRadius: 999, padding: '3px 9px' }}>In Production</span>
          </div>
          <div className="pa-sora" style={{ fontWeight: 700, fontSize: 15, margin: '10px 0 10px' }}>Wrapped cutlery kits · 40 cases</div>
          <div style={{ height: 6, borderRadius: 999, background: '#E6EFE7', overflow: 'hidden' }}><div className="pa-bar" /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7F71', marginTop: 8 }}><span>Confirmed</span><span>Production</span><span>Ships</span></div>
        </div>

        <div className="pa-float pa-glass" style={{ position: 'absolute', top: 230, left: 36, width: 250, borderRadius: 20, padding: 16, animationDelay: '-2.5s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, background: '#E4F7EE', display: 'grid', placeItems: 'center', color: '#0E9C45', fontWeight: 800 }}>✓</span>
            <div><div style={{ fontWeight: 700, fontSize: 14 }}>PO-5520 uploaded</div><div style={{ fontSize: 12, color: '#6B7F71' }}>Confirmed in under a day</div></div>
          </div>
        </div>

        <div className="pa-float pa-glass" style={{ position: 'absolute', top: 340, right: 56, width: 240, borderRadius: 20, padding: 16, animationDelay: '-4.5s' }}>
          <div className="pa-mono" style={{ fontSize: 11 }}>Call booked</div>
          <div className="pa-sora" style={{ fontWeight: 700, fontSize: 15, marginTop: 6 }}>Tue · 10:00 AM PT</div>
          <div style={{ fontSize: 12, color: '#6B7F71', marginTop: 2 }}>Project kickoff on Zoom</div>
        </div>

        <div style={{ position: 'absolute', left: 40, right: 40, bottom: 40, color: '#FFFFFF' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 999, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', fontSize: 13, backdropFilter: 'blur(8px)' }}><span className="pa-dot" />Made in Santa Ana, California</div>
          <div className="pa-sora" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 16, maxWidth: 520 }}>Everything with beyondGREEN, in one place.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
            {['Orders & tracking', 'PO upload', 'Quotes', 'Projects', 'Zoom calls', 'Documents'].map(t => <span key={t} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)' }}>{t}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 22, fontSize: 12, color: 'rgba(255,255,255,.75)', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '.08em' }}>
            <span>BPI CERTIFIED</span><span>TÜV AUSTRIA</span><span>USDA BIOPREFERRED</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AuthShell({ eyebrow, title, subtitle, children, below }: { eyebrow: string; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div className="pa">
      <style dangerouslySetInnerHTML={{ __html: AUTH_CSS }} />
      <div className="pa-grid">
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '24px 20px 28px' }}>
          <div className="pa-orb" aria-hidden="true" style={{ left: -160, top: -140, width: 460, height: 460, background: '#7BD155' }} />
          <div className="pa-orb pa-orb2" aria-hidden="true" style={{ right: -220, bottom: -200, width: 560, height: 560, background: '#0E9C45', opacity: 0.28 }} />

          <header style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: 520, width: '100%', margin: '0 auto' }}>
            <a href="https://byndgrn.com" aria-label="beyondGREEN home"><img src="/portal/logo.png" alt="beyondGREEN biotech" style={{ height: 40, width: 'auto', display: 'block' }} /></a>
            <span className="pa-glass" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: '#3D5446' }}><span className="pa-dot" style={{ background: '#0E9C45' }} />Client portal</span>
          </header>

          <main style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 520, width: '100%', margin: '0 auto', padding: '36px 0 24px' }}>
            <div className="pa-mobile-photo pa-r" style={{ height: 150, borderRadius: 24, marginBottom: 24, backgroundImage: 'url(/portal/p1.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, rgba(16,35,26,.7))' }} />
              <div style={{ position: 'absolute', left: 16, bottom: 14, color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}><span className="pa-dot" />Made in Santa Ana, California</div>
            </div>
            <div className="pa-mono pa-r">{eyebrow}</div>
            <h1 className="pa-sora pa-r pa-d1" style={{ margin: '12px 0 0', fontSize: 'clamp(34px, 5vw, 46px)', lineHeight: 1.04, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</h1>
            {subtitle && <p className="pa-r pa-d2" style={{ margin: '14px 0 0', fontSize: 16, lineHeight: 1.6, color: '#3D5446' }}>{subtitle}</p>}
            <div className="pa-glass pa-r pa-d3" style={{ marginTop: 26, borderRadius: 28, padding: 'clamp(20px, 4vw, 28px)' }}>{children}</div>
            {below && <div className="pa-r pa-d3" style={{ marginTop: 18, fontSize: 14, color: '#3D5446' }}>{below}</div>}
          </main>

          <footer style={{ position: 'relative', maxWidth: 520, width: '100%', margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12, color: '#6B7F71' }}>
            <span>© beyondGREEN biotech</span>
            <a className="pa-link" style={{ fontWeight: 500, color: '#6B7F71' }} href="https://byndgrn.com">byndgrn.com</a>
            <a className="pa-link" style={{ fontWeight: 500, color: '#6B7F71' }} href="mailto:info@byndgrn.com">info@byndgrn.com</a>
            <a className="pa-link" style={{ fontWeight: 500, color: '#6B7F71' }} href="tel:+18663649466">(866) 364-9466</a>
          </footer>
        </div>
        <Showcase />
      </div>
    </div>
  )
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="pa-link">{children}</Link>
}
