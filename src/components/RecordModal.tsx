'use client'
import { ReactNode, useEffect } from 'react'
import { statusColor } from '@/lib/statusColors'

interface Props {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /** status label shown as a pill in the header */
  status?: string | null
  /** actions rendered on the right of the header (below the close button) */
  headerRight?: ReactNode
  /** sticky footer actions */
  footer?: ReactNode
  maxWidth?: number
  children: ReactNode
}

/**
 * Monday.com-style centered record window with a colorful brand header.
 * Replaces the old accordion drop-downs across the ERP.
 */
export default function RecordModal({ open, onClose, title, subtitle, status, headerRight, footer, maxWidth = 720, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="mon-backdrop" >
      <div className="mon-modal" style={{ maxWidth }} onClick={e => e.stopPropagation()}>
        <div className="mon-modal-head">
          <div className="min-w-0">
            <h2 className="text-lg truncate">{title}</h2>
            {subtitle && <p className="text-white/80 text-xs mt-0.5 truncate">{subtitle}</p>}
            {status && <StatusPill status={status} className="mt-2 !bg-white/20 !text-white" />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerRight}
            <button onClick={onClose} className="mon-modal-close" aria-label="Close">×</button>
          </div>
        </div>
        <div className="mon-modal-body">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-[#FAFBFC]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Colorful status pill. Pass an explicit status string; colors are derived automatically. */
export function StatusPill({ status, className = '' }: { status?: string | null; className?: string }) {
  const c = statusColor(status)
  const label = (status || '—').toString()
  return (
    <span className={`mon-pill ${className}`} style={className.includes('!bg') ? undefined : { background: c.bg, color: c.fg }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: className.includes('!text') ? '#fff' : c.solid }} />
      {label}
    </span>
  )
}

/** Solid Monday-style status cell (filled block). */
export function StatusCell({ status, className = '' }: { status?: string | null; className?: string }) {
  const c = statusColor(status)
  return <span className={`mon-status ${className}`} style={{ background: c.solid }}>{(status || '—').toString()}</span>
}
