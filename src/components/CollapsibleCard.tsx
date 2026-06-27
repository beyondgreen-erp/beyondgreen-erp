'use client'
import { useEffect, useState, type ReactNode } from 'react'

export default function CollapsibleCard({
  title, storageKey, headerRight, defaultCollapsed = false, children,
}: {
  title: string
  storageKey: string
  headerRight?: ReactNode
  defaultCollapsed?: boolean
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  useEffect(() => {
    try {
      const v = localStorage.getItem('dash_collapse_' + storageKey)
      if (v !== null) setCollapsed(v === '1')
    } catch { /* ignore */ }
  }, [storageKey])

  function toggle() {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('dash_collapse_' + storageKey, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] mb-5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8F9FB] rounded-2xl transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <h2 className="font-semibold text-[#1A1D2E] truncate">{title}</h2>
        </div>
        {headerRight && <div className="flex items-center gap-2 shrink-0">{headerRight}</div>}
      </button>
      {!collapsed && <div className="px-5 pb-5 pt-0">{children}</div>}
    </div>
  )
}
