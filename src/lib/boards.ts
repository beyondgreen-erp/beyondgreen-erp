'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export interface Board {
  id?: string
  board_key: string
  label: string
  icon?: string | null
  nav_group: string
  href?: string | null
  sort_order: number
  is_hidden?: boolean
  is_custom?: boolean
  builder_config?: any
}

export interface BoardColumn { key: string; label: string; type: 'text' | 'longtext' | 'number' | 'date' | 'status' | 'link' | 'person' }
export interface BuilderConfig { columns: BoardColumn[]; groups: string[]; primary?: string; color?: string }

export const GROUP_ORDER = ['Overview', 'CRM', 'Sales', 'Production', 'Inventory', 'Warehouse', 'Compliance', 'Business', 'Human Resources', 'Finance', 'Historicals']

// Which built-in boards show a live badge (kept in code, keyed by href/board_key)
export const BADGE_BY_KEY: Record<string, string> = {
  '/production/shipping-queue': 'shippingQueue',
  '/production/work-orders': 'workOrders',
  '/sales/invoices': 'invoices',
}

// Built-in fallback so the nav never breaks if the DB is unreachable.
export const BUILTIN_BOARDS: Board[] = [
  { board_key: '/', label: 'Dashboard', icon: 'ti-layout-dashboard', nav_group: 'Overview', href: '/', sort_order: 0 },
  { board_key: '/sales/customers', label: 'Customers', icon: 'ti-users', nav_group: 'CRM', href: '/sales/customers', sort_order: 0 },
  { board_key: '/sales/leads', label: 'Leads', icon: 'ti-user-search', nav_group: 'CRM', href: '/sales/leads', sort_order: 1 },
  { board_key: '/operations/samples', label: 'Sample Submissions', icon: 'ti-flask', nav_group: 'CRM', href: '/operations/samples', sort_order: 2 },
  { board_key: '/sales/quotes', label: 'Quotes & Costing', icon: 'ti-file-invoice', nav_group: 'Sales', href: '/sales/quotes', sort_order: 0 },
  { board_key: '/sales/orders', label: 'Sales Orders', icon: 'ti-shopping-cart', nav_group: 'Sales', href: '/sales/orders', sort_order: 2 },
  { board_key: '/production/shipping-queue', label: 'Shipping Queue', icon: 'ti-truck', nav_group: 'Sales', href: '/production/shipping-queue', sort_order: 3 },
  { board_key: '/shipments', label: 'Shipments', icon: 'ti-package-export', nav_group: 'Sales', href: '/shipments', sort_order: 4 },
  { board_key: '/operations/fba', label: 'FBA / WFS', icon: 'ti-brand-amazon', nav_group: 'Sales', href: '/operations/fba', sort_order: 5 },
  { board_key: '/sales/daily-ship-report', label: '2026 Daily Ship Report', icon: 'ti-chart-dots', nav_group: 'Sales', href: '/sales/daily-ship-report', sort_order: 6 },
  { board_key: '/production/reports', label: 'Production Reports', icon: 'ti-chart-line', nav_group: 'Production', href: '/production/reports', sort_order: 0 },
  { board_key: '/production/daily-plan', label: 'Daily Plan', icon: 'ti-calendar-week', nav_group: 'Production', href: '/production/daily-plan', sort_order: 1 },
  { board_key: '/production/work-orders', label: 'Work Orders', icon: 'ti-tool', nav_group: 'Production', href: '/production/work-orders', sort_order: 2 },
  { board_key: '/production/quality-control', label: 'Quality Control', icon: 'ti-checkup-list', nav_group: 'Production', href: '/production/quality-control', sort_order: 3 },
  { board_key: '/haccp', label: 'HACCP - Compliance', icon: 'ti-clipboard-check', nav_group: 'Production', href: '/haccp', sort_order: 4 },
  { board_key: '/production/lots', label: 'Lot Codes', icon: 'ti-barcode', nav_group: 'Production', href: '/production/lots', sort_order: 5 },
  { board_key: '/production/machine-status', label: 'Machine Status', icon: 'ti-settings-cog', nav_group: 'Production', href: '/production/machine-status', sort_order: 6 },
  { board_key: '/production/capacity-plan', label: 'Capacity Plan', icon: 'ti-chart-bar', nav_group: 'Production', href: '/production/capacity-plan', sort_order: 7 },
  { board_key: '/sales/inventory', label: 'Products & Inventory', icon: 'ti-box', nav_group: 'Inventory', href: '/sales/inventory', sort_order: 0 },
  { board_key: '/operations/private-label-stock', label: 'Warehouse Stock', icon: 'ti-tag', nav_group: 'Inventory', href: '/operations/private-label-stock', sort_order: 1 },
  { board_key: '/imports', label: 'Import Tracker', icon: 'ti-ship', nav_group: 'Inventory', href: '/imports', sort_order: 2 },
  { board_key: '/sales/purchase-orders', label: 'Purchasing Requests', icon: 'ti-clipboard-list', nav_group: 'Inventory', href: '/sales/purchase-orders', sort_order: 3 },
  { board_key: '/operations/containers', label: 'Containers', icon: 'ti-container', nav_group: 'Warehouse', href: '/operations/containers', sort_order: 0 },
  { board_key: '/warehouse/tickets', label: 'Pull & Add Tickets', icon: 'ti-clipboard-check', nav_group: 'Warehouse', href: '/warehouse/tickets', sort_order: 1 },
  { board_key: '/warehouse/private-label-stock', label: 'Private Label Stock', icon: 'ti-tag', nav_group: 'Warehouse', href: '/warehouse/private-label-stock', sort_order: 2 },
  { board_key: '/bizdev/tasks', label: 'Tasks', icon: 'ti-checkbox', nav_group: 'Business', href: '/bizdev/tasks', sort_order: 0 },
  { board_key: '/bizdev/certifications', label: 'Certifications', icon: 'ti-rosette', nav_group: 'Business', href: '/bizdev/certifications', sort_order: 1 },
  { board_key: '/bizdev/documents', label: 'Documents & Knowledge', icon: 'ti-folder', nav_group: 'Business', href: '/bizdev/documents', sort_order: 2 },
  { board_key: '/bizdev/business-reports', label: 'Business Reports', icon: 'ti-report-analytics', nav_group: 'Business', href: '/bizdev/business-reports', sort_order: 3 },
  { board_key: '/bizdev/vault', label: 'Vault', icon: 'ti-lock', nav_group: 'Business', href: '/bizdev/vault', sort_order: 4 },
  { board_key: '/bizdev/university', label: 'beyondGREEN University', icon: 'ti-school', nav_group: 'Business', href: '/bizdev/university', sort_order: 5 },
  { board_key: '/beyondworld', label: 'beyondWorld', icon: 'ti-device-gamepad-2', nav_group: 'Business', href: '/beyondworld', sort_order: 6 },
  { board_key: '/settings', label: 'Settings', icon: 'ti-settings', nav_group: 'Business', href: '/settings', sort_order: 7 },
  { board_key: '/sales/vendors', label: 'Vendors', icon: 'ti-building-store', nav_group: 'Finance', href: '/sales/vendors', sort_order: 0 },
  { board_key: '/sales/invoices', label: 'Invoices', icon: 'ti-receipt', nav_group: 'Finance', href: '/sales/invoices', sort_order: 1 },
  { board_key: '/compliance', label: 'Compliance Overview', icon: 'ti-shield-check', nav_group: 'Compliance', href: '/compliance', sort_order: 0 },
  { board_key: '/hr', label: 'HR Overview', icon: 'ti-users-group', nav_group: 'Human Resources', href: '/hr', sort_order: 0 },
  { board_key: '/historicals/daily-ship-2025', label: 'Daily Ship Value 2025', icon: 'ti-chart-dots', nav_group: 'Historicals', href: '/historicals/daily-ship-2025', sort_order: 0 },
  { board_key: '/historicals/pipeline-2025', label: '2025 Pipeline', icon: 'ti-history', nav_group: 'Historicals', href: '/historicals/pipeline-2025', sort_order: 1 },
  { board_key: '/historicals/pipeline-2024', label: '2024 Pipeline', icon: 'ti-history', nav_group: 'Historicals', href: '/historicals/pipeline-2024', sort_order: 2 },
  { board_key: '/historicals/pipeline-2023', label: '2023 Pipeline', icon: 'ti-history', nav_group: 'Historicals', href: '/historicals/pipeline-2023', sort_order: 3 },
  { board_key: '/historicals/pipeline-2022', label: '2022 Pipeline', icon: 'ti-history', nav_group: 'Historicals', href: '/historicals/pipeline-2022', sort_order: 4 },
  { board_key: '/historicals/pipeline-2021', label: '2021 Pipeline', icon: 'ti-history', nav_group: 'Historicals', href: '/historicals/pipeline-2021', sort_order: 5 },
  { board_key: '/historicals/pipeline-2020', label: '2020 Pipeline', icon: 'ti-history', nav_group: 'Historicals', href: '/historicals/pipeline-2020', sort_order: 6 },
  { board_key: '/historicals/satx-shipments', label: 'Shipments to SACA from SATX', icon: 'ti-truck-delivery', nav_group: 'Historicals', href: '/historicals/satx-shipments', sort_order: 7 },
]

export interface NavGroup { group: string; items: Board[] }

export function groupBoards(boards: Board[], opts?: { includeHidden?: boolean }): NavGroup[] {
  const list = boards.filter(b => opts?.includeHidden || !b.is_hidden)
  const groups: Record<string, Board[]> = {}
  for (const b of list) (groups[b.nav_group] ||= []).push(b)
  const order = [...GROUP_ORDER, ...Object.keys(groups).filter(g => !GROUP_ORDER.includes(g)).sort()]
  return order
    .filter(g => groups[g] && groups[g].length)
    .map(g => ({ group: g, items: groups[g].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)) }))
}

// Shared boards hook — loads from DB, falls back to built-ins, refreshes on 'boards-changed'.
export function useBoards() {
  const [boards, setBoards] = useState<Board[]>(BUILTIN_BOARDS)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const sb = createSupabaseBrowserClient()
      const { data } = await sb.from('boards').select('*').order('nav_group', { ascending: true }).order('sort_order', { ascending: true })
      if (data && data.length) setBoards(data as Board[])
    } catch { /* keep built-ins */ }
    setLoaded(true)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = () => load()
    if (typeof window !== 'undefined') window.addEventListener('boards-changed', h)
    return () => { if (typeof window !== 'undefined') window.removeEventListener('boards-changed', h) }
  }, [load])

  return { boards, loaded, reload: load }
}

export function boardsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('boards-changed'))
}

// Rename a board's label (any logged-in user). Connections (board_key/href) untouched.
export async function renameBoard(board_key: string, label: string): Promise<boolean> {
  try {
    const sb = createSupabaseBrowserClient()
    const { data, error } = await sb.rpc('rename_board', { p_key: board_key, p_label: label })
    if (!error && data === true) { boardsChanged(); return true }
  } catch { /* ignore */ }
  return false
}
