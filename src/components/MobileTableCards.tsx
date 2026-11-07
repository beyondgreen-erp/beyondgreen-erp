'use client'
/**
 * Record cards for every list table on phones and small tablets.
 *
 * Most boards render a plain <table> that is wider than a phone, so on a small
 * screen the page either scrolls sideways or the columns get crushed. Below 1024px
 * this turns each table row into a stacked record card: every cell gets its column
 * name as a label (from the table's header row) and globals.css (table.rb-cards)
 * lays the cells out as a grid of label + value fields. Desktop (1024px and up) is
 * untouched: nothing runs unless the small-screen media query matches.
 *
 * It also wraps flex rows that run past the screen (rb-wrap) and widens inputs squeezed
 * to a sliver (rb-minw). Opt out with data-keep-table (tables) or data-keep-row (rows).
 * Boards that already ship their own phone layout (e.g. Products, Quotes) hide the
 * desktop table below lg, so this never touches them (hidden tables are skipped by CSS).
 */
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const MQ = '(max-width: 1023px)'

function headerLabels(t: HTMLTableElement): string[] | null {
  const head = t.tHead
  if (!head || !head.rows.length) return null
  const row = head.rows[head.rows.length - 1]
  const out: string[] = []
  for (const c of Array.from(row.cells)) {
    const txt = (c.textContent || '').replace(/\s+/g, ' ').trim()
    for (let i = 0; i < (c.colSpan || 1); i++) out.push(txt)
  }
  return out
}

function apply(root: ParentNode) {
  root.querySelectorAll('table').forEach(node => {
    const t = node as HTMLTableElement
    if (t.closest('[data-keep-table], .tiptap, .rte-view')) return
    const labels = headerLabels(t)
    if (!labels || labels.filter(Boolean).length < 2) { t.classList.remove('rb-cards'); return }
    if (!t.classList.contains('rb-cards')) t.classList.add('rb-cards')
    const bodies = [...Array.from(t.tBodies), ...(t.tFoot ? [t.tFoot] : [])]
    for (const body of bodies) {
      for (const r of Array.from(body.rows)) {
        const single = r.cells.length === 1
        let i = 0
        for (const c of Array.from(r.cells)) {
          const l = single && c.colSpan > 1 ? '' : (labels[i] || '')
          if (c.getAttribute('data-label') !== l) c.setAttribute('data-label', l)
          i += c.colSpan || 1
        }
      }
    }
  })
}

// Rows that run past the screen: flex rows that don't wrap (header button rows, tab
// bars, modal footers) get rb-wrap so they wrap onto a second line instead of
// pushing buttons off the edge. Inputs squeezed to a sliver (e.g. a SKU box next to
// a wide description) get rb-minw so the value stays readable.
const SKIP = 'header, nav, [data-keep-row], table.rb-cards'
// True when e should be left alone: inside an intended sideways scroller (a container
// that really scrolls left/right), inside something animated (tickers, marquees), or
// opted out. Checked up to <main>, which scrolls itself and must not count.
function inSkip(e: HTMLElement) {
  for (let p: HTMLElement | null = e; p && p.tagName !== 'MAIN' && p !== document.body; p = p.parentElement) {
    if (p.matches(SKIP)) return true
    const cs = getComputedStyle(p)
    if (cs.animationName && cs.animationName !== 'none') return true
    if (p !== e && (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true
  }
  return false
}
function fitRows() {
  const edge = document.documentElement.clientWidth + 1
  const els = document.querySelectorAll('main [class*="flex"], [class*="fixed"] [class*="flex"]')
  els.forEach(node => {
    const e = node as HTMLElement
    if (e.classList.contains('rb-wrap')) return
    // overflowing inside itself, or grown wider than the screen as a flex item
    if (e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= edge) return
    const cs = getComputedStyle(e)
    if (!cs.display.includes('flex') || !cs.flexDirection.startsWith('row') || cs.flexWrap !== 'nowrap' || cs.overflowX !== 'visible') return
    if (inSkip(e)) return
    e.classList.add('rb-wrap')
  })
  document.querySelectorAll('main input, [class*="fixed"] input').forEach(node => {
    const i = node as HTMLInputElement
    if (i.classList.contains('rb-minw') || /checkbox|radio|file|hidden|range|color/.test(i.type)) return
    if (i.clientWidth > 0 && i.clientWidth < 64 && i.value && i.scrollWidth > i.clientWidth + 2) {
      i.classList.add('rb-minw')
      const p = i.closest('[class*="flex"]') as HTMLElement | null
      if (p && p.parentElement) {
        const row = (p.parentElement.closest('[class*="flex"]') as HTMLElement | null)
        ;[p, row].forEach(r => { if (r && getComputedStyle(r).display.includes('flex')) r.classList.add('rb-wrap') })
      }
    }
  })
}

export default function MobileTableCards() {
  const pathname = usePathname()
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(MQ)
    let obs: MutationObserver | null = null
    let raf = 0
    let last = 0, timer = 0
    const run = () => { raf = 0; last = Date.now(); apply(document.body); fitRows() }
    // At most a few passes a second: big boards re-render often.
    const schedule = () => {
      if (raf || timer) return
      const wait = Math.max(0, 300 - (Date.now() - last))
      timer = window.setTimeout(() => { timer = 0; raf = requestAnimationFrame(run) }, wait)
    }
    const start = () => {
      if (obs) return
      run()
      obs = new MutationObserver(schedule)
      obs.observe(document.body, { childList: true, subtree: true })
    }
    const stop = () => {
      obs?.disconnect(); obs = null
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      if (timer) { clearTimeout(timer); timer = 0 }
      document.querySelectorAll('table.rb-cards').forEach(t => t.classList.remove('rb-cards'))
      document.querySelectorAll('.rb-wrap').forEach(t => t.classList.remove('rb-wrap'))
      document.querySelectorAll('.rb-minw').forEach(t => t.classList.remove('rb-minw'))
    }
    const onChange = () => (mq.matches ? start() : stop())
    onChange()
    mq.addEventListener('change', onChange)
    return () => { mq.removeEventListener('change', onChange); stop() }
  }, [pathname])
  return null
}
