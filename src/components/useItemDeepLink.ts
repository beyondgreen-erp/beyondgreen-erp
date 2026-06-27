import { useEffect, useRef } from 'react'

/** Reads ?item=<id> from the URL and opens the matching item once it has
 *  loaded, by calling the page's own open/edit handler. Runs a single time. */
export function useItemDeepLink<T extends { id: string }>(items: T[], open: (item: T) => void) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current || typeof window === 'undefined') return
    const id = new URLSearchParams(window.location.search).get('item')
    if (!id) return
    const match = items.find(i => String(i.id) === id)
    if (!match) return
    done.current = true
    open(match)
    const el = document.getElementById('item-' + id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [items, open])
}
