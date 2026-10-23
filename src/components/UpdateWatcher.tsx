'use client'
/**
 * Keeps phones, tablets and long-open tabs on the latest deployment.
 * A tab left open keeps running the JavaScript it loaded, so after a deploy it can call the
 * database the old way (e.g. the Walmart board breaking when a week got a second work order).
 * This checks /api/version when the tab comes back into view, on focus and every few minutes.
 * If a new version is live it reloads straight away when nobody is typing, otherwise it shows
 * a banner with a Refresh button.
 */
import { useEffect, useRef, useState } from 'react'

const BUILT = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || ''

function busyTyping() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function UpdateWatcher() {
  const [stale, setStale] = useState(false)
  const base = useRef<string>(BUILT)

  useEffect(() => {
    let stop = false
    const check = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const { v } = await r.json() as { v?: string }
        if (!v || stop) return
        if (!base.current) { base.current = v; return }   // first look: remember what we are running
        if (v !== base.current) {
          if (document.hidden || !busyTyping()) window.location.reload()
          else setStale(true)
        }
      } catch { /* offline — try again later */ }
    }
    check()
    const onVis = () => { if (!document.hidden) check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', check)
    const t = setInterval(check, 3 * 60 * 1000)
    return () => { stop = true; document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', check); clearInterval(t) }
  }, [])

  if (!stale) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[9999] rounded-2xl shadow-lg bg-[#1A1D2E] text-white text-sm px-4 py-3 flex items-center gap-3"
      style={{ bottom: 'max(16px, env(safe-area-inset-bottom))' }}>
      <span>A new version of the ERP is ready.</span>
      <button onClick={() => window.location.reload()} className="rounded-lg bg-[#1D9E75] px-3 py-1.5 font-semibold">Refresh</button>
    </div>
  )
}
