'use client'
/**
 * MONEY GUARD — blurs every dollar amount across the ERP until the money password is entered.
 *
 * How it finds money: a MutationObserver marks any element whose own text contains a $ amount
 * (e.g. "$12,307", "$0.16", "-$4.2k"), chart labels included, plus inputs that hold prices
 * (name/placeholder/aria-label/id mentioning price, cost, amount, revenue, total, $). Marked elements
 * get data-money-blur, and CSS blurs them while <html> has the money-locked class.
 * Pages can also opt in with data-money on any element, or opt out with data-money-ok.
 *
 * The password is checked server-side (money_unlock_verify, bcrypt hash, 5 tries per 15 min).
 * Unlock lasts 8 hours on this browser tab session, or until "Lock $" is pressed.
 * Note: this hides amounts on screen. It does not remove them from the data the page loads.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const KEY = 'bg_money_unlocked_until'
const HOURS = 8
const MONEY_RE = /(^|[^A-Za-z0-9])-?\$\s?-?\d/
const INPUT_RE = /(price|cost|amount|revenue|subtotal|balance|payment|\$|dollar|margin|profit)/i

function unlockedNow(): boolean {
  try { return Number(sessionStorage.getItem(KEY) || 0) > Date.now() } catch { return false }
}

function scan(root: ParentNode) {
  // Text: mark the closest element holding a $ amount.
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n.nodeValue
    if (!t || t.indexOf('$') < 0 || !MONEY_RE.test(t)) continue
    const el = (n as Text).parentElement
    if (!el || el.closest('[data-money-ok]') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
    if (!el.hasAttribute('data-money-blur')) el.setAttribute('data-money-blur', '')
  }
  // Inputs that hold money.
  ;(root as Element).querySelectorAll?.('input, textarea').forEach(i => {
    const el = i as HTMLInputElement
    if (el.closest('[data-money-ok]') || el.hasAttribute('data-money-blur')) return
    if (el.type === 'password' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'search') return
    const label = el.closest('label')?.textContent || ''
    const hint = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), label.slice(0, 60)].join(' ')
    if (INPUT_RE.test(hint) || (el.value && MONEY_RE.test(' ' + el.value))) el.setAttribute('data-money-blur', '')
  })
}

export default function MoneyGuard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [unlocked, setUnlocked] = useState(false)
  const [ask, setAsk] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const pwRef = useRef<HTMLInputElement>(null)

  // Initial state + auto relock when the 8 hours run out.
  useEffect(() => {
    setUnlocked(unlockedNow())
    const t = setInterval(() => setUnlocked(unlockedNow()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const html = document.documentElement
    html.classList.toggle('money-locked', !unlocked)
  }, [unlocked])

  // Mark money everywhere, now and as the page changes.
  useEffect(() => {
    let raf = 0
    const pending = new Set<Node>()
    const flush = () => { raf = 0; pending.forEach(p => { try { scan(p as ParentNode) } catch { /* ignore */ } }); pending.clear() }
    scan(document.body)
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') { const p = m.target.parentElement; if (p) pending.add(p) }
        else m.addedNodes.forEach(a => pending.add(a.nodeType === 3 ? (a.parentElement || document.body) : a))
        if (m.type === 'attributes' && m.target.nodeType === 1) pending.add(m.target)
      }
      if (!raf) raf = requestAnimationFrame(flush)
    })
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['value'] })
    // Typed values in inputs don't fire mutations; catch them on input.
    const onInput = (e: Event) => { const el = e.target as HTMLInputElement; if (el?.value && MONEY_RE.test(' ' + el.value) && !el.closest('[data-money-ok]')) el.setAttribute('data-money-blur', '') }
    document.addEventListener('input', onInput, true)
    return () => { mo.disconnect(); document.removeEventListener('input', onInput, true); if (raf) cancelAnimationFrame(raf) }
  }, [])

  // Tapping a blurred amount opens the unlock box instead of doing anything else.
  useEffect(() => {
    if (unlocked) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!t || !t.closest) return
      if (t.closest('[data-money-ok]')) return
      const hit = t.closest('[data-money-blur],[data-money]')
      if (!hit) return
      if (hit.matches('input,textarea,select')) { e.preventDefault(); e.stopPropagation(); setAsk(true); return }
      e.preventDefault(); e.stopPropagation(); setAsk(true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [unlocked])

  useEffect(() => { if (ask) setTimeout(() => pwRef.current?.focus(), 50) }, [ask])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const v = pwRef.current?.value ?? pw
    if (!v) { setMsg('Enter the password.'); return }
    setBusy(true); setMsg('')
    const { data, error } = await sb.rpc('money_unlock_verify', { p_password: v })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    const r = data as { ok: boolean; msg: string }
    if (!r?.ok) { setMsg(r?.msg || 'Wrong password'); return }
    try { sessionStorage.setItem(KEY, String(Date.now() + HOURS * 3600 * 1000)) } catch { /* ignore */ }
    setUnlocked(true); setAsk(false); setPw(''); if (pwRef.current) pwRef.current.value = ''
  }
  function lock() {
    try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
    setUnlocked(false)
  }

  return (
    <div data-money-ok>
      <style>{`
        html.money-locked [data-money-blur]:not([data-money-ok] *),
        html.money-locked [data-money]:not([data-money-ok] *) { filter: blur(7px) !important; user-select: none !important; cursor: pointer; transition: filter .15s; }
        html.money-locked input[data-money-blur], html.money-locked textarea[data-money-blur] { color: transparent !important; text-shadow: 0 0 9px rgba(26,29,46,.75) !important; filter: none !important; }
        @media print { html.money-locked [data-money-blur], html.money-locked [data-money] { filter: blur(7px) !important; } }
      `}</style>

      <button type="button" onClick={() => (unlocked ? lock() : setAsk(true))}
        className={`fixed z-[80] left-3 bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-4 h-9 px-3 rounded-full text-xs font-bold shadow-lg border ${unlocked ? 'bg-white text-[#1A1D2E] border-[#E4E6EE]' : 'bg-[#13201A] text-white border-[#13201A]'}`}
        title={unlocked ? 'Hide dollar amounts again' : 'Dollar amounts are hidden'}>
        {unlocked ? '🔓 Lock $' : '🔒 $ hidden · Unlock'}
      </button>

      {ask && !unlocked && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4" onClick={() => setAsk(false)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl flex flex-col gap-3">
            <div className="text-3xl">🔒</div>
            <h2 className="text-lg font-bold text-[#1A1D2E]">Request visibility</h2>
            <input ref={pwRef} type="password" autoComplete="off" defaultValue="" onChange={e => setPw(e.target.value)} placeholder="Money password"
              className="h-11 rounded-lg border border-[#E4E6EE] px-3 text-base text-[#1A1D2E] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            {msg && <p className="text-xs text-red-600">{msg}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setAsk(false)} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={busy} className="flex-1 h-11 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">{busy ? 'Checking…' : 'Unlock'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
