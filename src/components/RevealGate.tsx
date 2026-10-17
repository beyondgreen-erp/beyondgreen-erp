'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

/*
  Shared reveal gate for sensitive numbers.

  The password itself is never in this file or anywhere else in the client
  bundle. It is checked server-side by /api/reveal-ship-totals, which is the
  same endpoint the Daily Ship Report uses, so there is one password in one
  place and changing it there changes it everywhere.

  The unlocked state is kept in sessionStorage under the same key the ship
  report uses, so unlocking in one place unlocks the other for that session,
  and closing the browser locks everything again.
*/

const KEY = 'dsr_revealed'
const EVENT = 'bg-reveal-change'

export function useRevealed() {
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const read = () => {
      try {
        setRevealed(sessionStorage.getItem(KEY) === '1')
      } catch {
        setRevealed(false)
      }
    }
    read()
    window.addEventListener(EVENT, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(EVENT, read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return revealed
}

export function setRevealedState(on: boolean) {
  try {
    if (on) sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch {
    /* private window or storage blocked: the gate just stays closed */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export default function RevealGate({
  children,
  label = 'this figure',
}: {
  children: ReactNode
  label?: string
}) {
  const revealed = useRevealed()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = useCallback(() => {
    setOpen(false)
    setPw('')
    setErr(null)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/reveal-ship-totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const j = await res.json().catch(() => ({}))
      if (j.ok) {
        setRevealedState(true)
        close()
      } else {
        setErr('Incorrect password.')
      }
    } catch {
      setErr('Could not check the password. Please try again.')
    }
    setBusy(false)
  }

  if (revealed) {
    return (
      <div className="relative h-full group">
        {children}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setRevealedState(false)
          }}
          title="Hide these figures again"
          aria-label="Hide these figures again"
          className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition
                     text-[11px] leading-none px-1.5 py-1 rounded-md bg-white/90 border
                     border-[#E4E6EE] text-[#8A9FC0] hover:text-[#0F1C2E]"
        >
          Hide
        </button>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <div className="blur-md select-none pointer-events-none h-full" aria-hidden="true">
        {children}
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enter password to view ${label}`}
        className="absolute inset-0 z-10 flex items-center justify-center bg-white/30 hover:bg-white/10 transition"
      >
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5
                     rounded-lg bg-white/95 border border-[#E4E6EE] shadow-sm text-[#0F1C2E]"
        >
          <span aria-hidden="true">🔒</span> Unlock
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Enter password"
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-3"
          >
            <div>
              <p className="text-base font-bold text-[#0F1C2E]">Enter password</p>
              <p className="text-xs text-[#8A9FC0] mt-1">
                The same password as the Daily Ship Report. This unlocks the consolidated
                figures for the rest of this browser session.
              </p>
            </div>

            <input
              type="password"
              value={pw}
              autoFocus
              onChange={(e) => {
                setPw(e.target.value)
                setErr(null)
              }}
              placeholder="Password"
              autoComplete="off"
              className="border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[#00A84F]/40"
            />

            {err && <p className="text-xs font-semibold text-red-600">{err}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                className="text-sm font-semibold px-3 py-2 rounded-lg text-[#8A9FC0] hover:text-[#0F1C2E]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !pw}
                className="bg-[#00A84F] text-white text-sm font-semibold px-4 py-2
                           rounded-lg disabled:opacity-50"
              >
                {busy ? '…' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
