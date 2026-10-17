'use client'
/*
  errorReporter — the ERP's eyes in every browser.

  Reports to the database (public.log_client_error → client_errors), which the watchdog
  turns into tickets and the morning digest:
    • uncaught JavaScript errors and unhandled promise rejections (screens that crash)
    • any database read/write the server refused (status ≥ 400) — these are the "I clicked
      Save and nothing happened" bugs that never show an error to the person using the screen

  Deduplicated in the browser (same error once a minute) and on the server (fingerprint).
  Installed once from ClientShell; does nothing until a user is signed in.
*/
import { createSupabaseBrowserClient } from '@/lib/supabase'

let installed = false
const recent = new Map<string, number>()
// 401 = signed out, 406 = .single() found no row, 416 = range past end — normal, not bugs.
const IGNORE_STATUS = new Set([401, 406, 416])

function send(kind: string, message: string, stack?: string) {
  try {
    const key = kind + '|' + message
    const now = Date.now()
    if ((recent.get(key) || 0) > now - 60_000) return
    recent.set(key, now)
    if (recent.size > 200) recent.clear()
    const sb = createSupabaseBrowserClient()
    void sb.rpc('log_client_error', {
      p_kind: kind,
      p_message: message.slice(0, 1000),
      p_stack: (stack || '').slice(0, 4000),
      p_path: window.location.pathname + window.location.search,
      p_ua: navigator.userAgent,
    }).then(() => {}, () => {})
  } catch { /* the reporter must never break the page */ }
}

// A small banner that needs no React: works from any screen, even one that crashed.
let bannerTimer: ReturnType<typeof setTimeout> | null = null
function showNotSaved(reason: string) {
  try {
    let el = document.getElementById('erp-not-saved')
    if (!el) {
      el = document.createElement('div')
      el.id = 'erp-not-saved'
      el.setAttribute('role', 'alert')
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '2147483647',
        background: '#C62839', color: '#fff', padding: '12px 16px', borderRadius: '12px', maxWidth: '560px',
        boxShadow: '0 10px 30px rgba(0,0,0,.25)', font: '600 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif', cursor: 'pointer',
      } as CSSStyleDeclaration)
      el.onclick = () => { el?.remove() }
      document.body.appendChild(el)
    }
    el.textContent = '⚠ Your last change was NOT saved — ' + reason.slice(0, 220) + '. Please try again; if it keeps happening, tell Rudy (it has been logged).'
    if (bannerTimer) clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => { document.getElementById('erp-not-saved')?.remove() }, 12000)
  } catch { /* never break the page */ }
}

export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', e => {
    const msg = e.message || String(e.error || 'Unknown error')
    if (/ResizeObserver loop|Script error\.?$/.test(msg)) return   // browser noise
    send('crash', msg, e.error?.stack)
  })
  window.addEventListener('unhandledrejection', e => {
    const r: any = e.reason
    const msg = r?.message || (typeof r === 'string' ? r : JSON.stringify(r ?? '')).slice(0, 300)
    if (!msg || /AbortError|The user aborted|Failed to fetch|Load failed|NetworkError/.test(msg)) return
    send('promise', msg, r?.stack)
  })

  // Watch database calls the screens make. Only Supabase REST/RPC calls are inspected,
  // and the reporter's own call is skipped so it can never loop.
  const orig = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init)
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (res.status >= 400 && !IGNORE_STATUS.has(res.status) && /\/rest\/v1\//.test(url) && !/log_client_error/.test(url)) {
        const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET') || 'GET').toUpperCase()
        const target = (url.split('/rest/v1/')[1] || '').split('?')[0]
        let detail = ''
        try { const j = await res.clone().json(); detail = j?.message || j?.error || j?.hint || '' } catch { /* not json */ }
        const verb = method === 'GET' ? 'read' : method === 'DELETE' ? 'delete' : 'save'
        send('db_' + verb, `${res.status} on ${method} ${target}${detail ? ': ' + detail : ''}`)
        // Many screens never check the result of a save, so a refused write used to look like
        // success. Every refused change now tells the person, wherever it happened.
        if (method !== 'GET' && method !== 'HEAD') showNotSaved(detail || `the server refused it (${res.status})`)
      }
    } catch { /* never interfere with the response */ }
    return res
  }
}
