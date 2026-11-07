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
 * Opt out for a specific table by putting data-keep-table on it or on a parent.
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

export default function MobileTableCards() {
  const pathname = usePathname()
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(MQ)
    let obs: MutationObserver | null = null
    let raf = 0
    const run = () => { raf = 0; apply(document.body) }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(run) }
    const start = () => {
      if (obs) return
      run()
      obs = new MutationObserver(schedule)
      obs.observe(document.body, { childList: true, subtree: true })
    }
    const stop = () => {
      obs?.disconnect(); obs = null
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      document.querySelectorAll('table.rb-cards').forEach(t => t.classList.remove('rb-cards'))
    }
    const onChange = () => (mq.matches ? start() : stop())
    onChange()
    mq.addEventListener('change', onChange)
    return () => { mq.removeEventListener('change', onChange); stop() }
  }, [pathname])
  return null
}
