'use client'
/**
 * Per-board permissions (Owner/Admin/Member + View/Edit per board).
 * One RPC (`erp_my_permissions`) is fetched once per session and cached module-wide so every
 * component shares the same answer. Admins see and edit everything. If the lookup itself fails
 * (network), the UI fails OPEN so the app stays usable — the database policies on sensitive
 * boards still hold regardless of what the UI shows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Board } from '@/lib/boards'

export interface BoardPerm { can_view: boolean; can_edit: boolean }
/** Where this session is right now and what the off-site rules allow (enforced in the database too). */
export interface Access {
  ip: string | null
  onsite: boolean
  mode: 'onsite' | 'full' | 'readonly' | 'chat_only' | 'blocked'
  can_read: boolean
  can_write: boolean
  gate_active: boolean
  offsite_access: string | null
}
export interface Perms {
  email: string | null
  role: string | null
  is_admin: boolean
  boards: Record<string, BoardPerm>
  access: Access | null
  loaded: boolean
  failed: boolean
}

const EMPTY: Perms = { email: null, role: null, is_admin: false, boards: {}, access: null, loaded: false, failed: false }
let cache: Perms | null = null
let inflight: Promise<Perms> | null = null
const listeners = new Set<(p: Perms) => void>()

async function fetchPerms(): Promise<Perms> {
  try {
    const sb = createSupabaseBrowserClient()
    const { data, error } = await sb.rpc('erp_my_permissions')
    if (error || !data) throw error || new Error('no data')
    const d = data as { email?: string; role?: string; is_admin?: boolean; boards?: { board_key: string; can_view: boolean; can_edit: boolean }[]; access?: Access }
    const boards: Record<string, BoardPerm> = {}
    for (const b of d.boards ?? []) boards[b.board_key] = { can_view: !!b.can_view, can_edit: !!b.can_edit }
    const a = d.access
    const access: Access | null = a ? { ip: a.ip ?? null, onsite: !!a.onsite, mode: (a.mode as Access['mode']) || 'onsite', can_read: a.can_read !== false, can_write: a.can_write !== false, gate_active: !!a.gate_active, offsite_access: a.offsite_access ?? null } : null
    return { email: d.email ?? null, role: d.role ?? null, is_admin: !!d.is_admin, boards, access, loaded: true, failed: false }
  } catch {
    return { ...EMPTY, loaded: true, failed: true }
  }
}

export function loadPermissions(force = false): Promise<Perms> {
  if (cache && !force) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetchPerms().then(p => { cache = p; inflight = null; listeners.forEach(l => l(p)); return p })
  }
  return inflight
}

/** Call after changing roles/grants so every open component re-reads. */
export function permissionsChanged() { cache = null; loadPermissions(true) }

/** Always-allowed routes (home + a user's own settings). */
const ALWAYS = new Set(['/', '/settings/profile', '/settings/notifications'])

/** Longest-prefix match of the current path onto a board key. */
export function boardKeyForPath(pathname: string, boards: Board[]): string | null {
  if (!pathname) return null
  if (pathname === '/') return '/'
  let best: string | null = null
  for (const b of boards) {
    const k = b.board_key || b.href || ''
    if (!k || k === '/') continue
    if (pathname === k || pathname.startsWith(k + '/') || pathname.startsWith(k + '?')) {
      if (!best || k.length > best.length) best = k
    }
  }
  return best
}

let refreshTimer: ReturnType<typeof setInterval> | null = null
function ensureRefresh() {
  // Re-check every 2 minutes so a phone that walks off the work WiFi locks without a reload.
  if (refreshTimer || typeof window === 'undefined') return
  refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') loadPermissions(true) }, 120_000)
}

export function usePermissions() {
  const [perms, setPerms] = useState<Perms>(cache ?? EMPTY)
  useEffect(() => {
    let alive = true
    loadPermissions().then(p => { if (alive) setPerms(p) })
    ensureRefresh()
    const l = (p: Perms) => { if (alive) setPerms(p) }
    listeners.add(l)
    return () => { alive = false; listeners.delete(l) }
  }, [])

  const canView = useCallback((key: string | null | undefined) => {
    if (!perms.loaded || perms.failed || perms.is_admin) return true
    if (!key || ALWAYS.has(key)) return true
    return !!perms.boards[key]?.can_view
  }, [perms])

  const canEdit = useCallback((key: string | null | undefined) => {
    if (!perms.loaded || perms.failed || perms.is_admin) return true
    if (!key) return true
    if (ALWAYS.has(key)) return true
    const b = perms.boards[key]
    return !!(b?.can_view && b?.can_edit)
  }, [perms])

  return useMemo(() => ({ ...perms, canView, canEdit }), [perms, canView, canEdit])
}
