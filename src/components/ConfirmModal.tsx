'use client'
import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ open, title, description, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) ref.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        ref={ref}
        tabIndex={-1}
        className="relative bg-white border border-[#E4E6EE] rounded-2xl shadow-sm p-6 w-full max-w-sm fade-in"
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${danger ? 'bg-red-500/15' : 'bg-[#00C89615]'}`}>
          <svg className={`w-5 h-5 ${danger ? 'text-red-400' : 'text-[#00C896]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {danger
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            }
          </svg>
        </div>
        <h3 className="text-[#1A1D2E] font-semibold text-base mb-1">{title}</h3>
        {description && <p className="text-[#9898A8] text-sm mb-5">{description}</p>}
        <div className="flex gap-3 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 bg-white hover:bg-[#F5F6FA] border border-[#E4E6EE] text-[#1A1D2E] text-sm px-4 py-2.5 rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 text-sm px-4 py-2.5 rounded-xl font-semibold transition-all ${
              danger
                ? 'bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400'
                : 'bg-[#00C896] hover:bg-[#00B085] text-black'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
