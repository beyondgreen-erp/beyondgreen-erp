'use client'
/*
  usePointerDnd — reliable board drag & drop for mouse, pen and touch.

  Why not HTML5 draggable: native DnD is cancelled whenever React re-mounts the
  dragged node (realtime refresh, state change on dragstart), needs setData for
  Firefox, flickers on dragleave over child elements, and does not work on
  phones/tablets at all. This hook uses pointer events + a floating clone, so:
    • the whole card is the handle (buttons/inputs/links inside still work)
    • mouse: drag starts after moving 6px — a plain click still opens the card
    • touch: press-and-hold ~0.25s, then drag (normal swipes still scroll)
    • drop target = whatever [data-drop-zone] is under the finger/cursor,
      so the entire column (not just a small strip) accepts the drop
    • horizontal/vertical auto-scroll near the edges of the board
    • Esc cancels; a re-render or live refresh mid-drag cannot cancel it

  Usage:
    const dnd = usePointerDnd({ onDrop: (id, zone) => move(id, zone) })
    <div {...dnd.zone('In Progress')}> … <div {...dnd.item(r.id)}>card</div> … </div>
    dnd.dragId  → id being dragged (dim the source card)
    dnd.overZone → zone currently under the pointer (highlight the column)
*/
import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'

type Opts = {
  onDrop: (id: string, zone: string) => void
  /** ms a finger must be held before a touch drag starts */
  longPressMs?: number
  /** px the mouse must move before a drag starts */
  threshold?: number
  disabled?: boolean
}

const INTERACTIVE = 'button,a,input,select,textarea,label,[contenteditable="true"],[data-no-drag]'

export function usePointerDnd({ onDrop, longPressMs = 250, threshold = 6, disabled = false }: Opts) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overZone, setOverZone] = useState<string | null>(null)
  const onDropRef = useRef(onDrop); onDropRef.current = onDrop
  const suppressClick = useRef(false)
  const s = useRef<{
    id: string; el: HTMLElement; pointerId: number; touch: boolean
    sx: number; sy: number; x: number; y: number; offX: number; offY: number
    active: boolean; timer: any; ghost: HTMLElement | null; raf: number; over: string | null
  } | null>(null)

  const cleanup = useCallback(() => {
    const st = s.current
    if (!st) return
    clearTimeout(st.timer)
    cancelAnimationFrame(st.raf)
    st.ghost?.remove()
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    s.current = null
    setDragId(null); setOverZone(null)
  }, [])

  const zoneAt = (x: number, y: number): string | null => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null
    const z = hit?.closest('[data-drop-zone]') as HTMLElement | null
    return z ? z.getAttribute('data-drop-zone') : null
  }

  const autoScroll = () => {
    const st = s.current
    if (!st || !st.active) return
    const hit = document.elementFromPoint(st.x, st.y) as HTMLElement | null
    const edge = 56, speed = 14
    // nearest scrollable ancestors (column list vertical, board horizontal)
    let n: HTMLElement | null = hit
    while (n && n !== document.body) {
      const cs = getComputedStyle(n)
      const r = n.getBoundingClientRect()
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) {
        if (st.y < r.top + edge) n.scrollTop -= speed
        else if (st.y > r.bottom - edge) n.scrollTop += speed
      }
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth) {
        if (st.x < r.left + edge) n.scrollLeft -= speed
        else if (st.x > r.right - edge) n.scrollLeft += speed
      }
      n = n.parentElement
    }
    if (st.y < edge) window.scrollBy(0, -speed)
    else if (st.y > window.innerHeight - edge) window.scrollBy(0, speed)
    st.raf = requestAnimationFrame(autoScroll)
  }

  const start = () => {
    const st = s.current
    if (!st || st.active) return
    st.active = true
    const r = st.el.getBoundingClientRect()
    const g = st.el.cloneNode(true) as HTMLElement
    g.removeAttribute('id')
    Object.assign(g.style, {
      position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
      margin: '0', zIndex: '9999', pointerEvents: 'none', opacity: '0.95',
      boxShadow: '0 12px 28px rgba(26,29,46,.22)', transform: 'rotate(2deg) scale(1.02)',
      transition: 'none', willChange: 'left, top',
    } as CSSStyleDeclaration)
    document.body.appendChild(g)
    st.ghost = g
    st.offX = st.sx - r.left; st.offY = st.sy - r.top
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    if (st.touch && 'vibrate' in navigator) { try { navigator.vibrate(15) } catch { /* ignore */ } }
    setDragId(st.id)
    st.raf = requestAnimationFrame(autoScroll)
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const st = s.current
      if (!st || e.pointerId !== st.pointerId) return
      st.x = e.clientX; st.y = e.clientY
      const dist = Math.hypot(e.clientX - st.sx, e.clientY - st.sy)
      if (!st.active) {
        if (st.touch) { if (dist > 10) cleanup() }          // finger moved before hold → it's a scroll
        else if (dist > threshold) start()
        return
      }
      if (st.ghost) { st.ghost.style.left = (e.clientX - st.offX) + 'px'; st.ghost.style.top = (e.clientY - st.offY) + 'px' }
      const z = zoneAt(e.clientX, e.clientY)
      if (z !== st.over) { st.over = z; setOverZone(z) }
    }
    const up = (e: PointerEvent) => {
      const st = s.current
      if (!st || e.pointerId !== st.pointerId) return
      if (st.active) {
        const z = zoneAt(e.clientX, e.clientY)
        const id = st.id
        suppressClick.current = true
        setTimeout(() => { suppressClick.current = false }, 60)
        cleanup()
        if (z) onDropRef.current(id, z)
      } else cleanup()
    }
    const cancel = (e: PointerEvent) => { const st = s.current; if (st && e.pointerId === st.pointerId) cleanup() }
    // While a touch drag is active, stop the page from scrolling under the finger.
    const touchMove = (e: TouchEvent) => { if (s.current?.active) e.preventDefault() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && s.current) cleanup() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', touchMove, { passive: false })
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('keydown', key)
      cleanup()
    }
  }, [cleanup, threshold]) // eslint-disable-line react-hooks/exhaustive-deps

  const item = (id: string) => ({
    'data-dnd-item': id,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || s.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return
      const touch = e.pointerType !== 'mouse'
      s.current = {
        id, el: e.currentTarget, pointerId: e.pointerId, touch,
        sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, offX: 0, offY: 0,
        active: false, timer: null, ghost: null, raf: 0, over: null,
      }
      if (touch) s.current.timer = setTimeout(start, longPressMs)
    },
    onClickCapture: (e: React.MouseEvent) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault() } },
    onDragStart: (e: React.DragEvent) => e.preventDefault(),   // no native image/link drag hijacking
    onContextMenu: (e: React.MouseEvent) => { if (s.current?.touch) e.preventDefault() },   // long-press menu on mobile
    style: { cursor: disabled ? undefined : 'grab', WebkitTouchCallout: 'none' } as React.CSSProperties,
  })

  const zone = (key: string) => ({ 'data-drop-zone': key })

  return { item, zone, dragId, overZone, dragging: dragId !== null }
}
