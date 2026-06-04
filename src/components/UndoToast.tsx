'use client'
import { useEffect, useState } from 'react'

interface UndoToastProps {
  message: string
  onUndo?: () => void
  onDismiss: () => void
  duration?: number
  type?: 'success' | 'info' | 'error'
}

export default function UndoToast({
  message, onUndo, onDismiss, duration = 6000, type = 'success'
}: UndoToastProps) {
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const start = Date.now()
    const tick = setInterval(() => {
      const pct = Math.max(0, 100 - ((Date.now() - start) / duration) * 100)
      setProgress(pct)
      if (pct === 0) { clearInterval(tick); onDismiss() }
    }, 40)
    return () => clearInterval(tick)
  }, [duration, onDismiss])

  const barColor = type === 'error' ? 'bg-red-500' : type === 'info' ? 'bg-blue-500' : 'bg-emerald-500'
  const iconBg = type === 'error' ? 'bg-red-500/20 text-red-400' : type === 'info' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-80 bg-[#1A1A1F] border border-[#3A3A45] rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
          {type === 'error' ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
            </svg>
          )}
        </div>
        <p className="text-white text-sm flex-1 leading-snug">{message}</p>
        <div className="flex items-center gap-0.5 shrink-0">
          {onUndo && (
            <button
              onClick={() => { onUndo(); onDismiss() }}
              className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-emerald-500/10 transition-colors"
            >
              Undo
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-gray-600 hover:text-gray-400 p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="h-0.5 bg-[#2A2A35]">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${progress}%`, transition: 'width 40ms linear' }}/>
      </div>
    </div>
  )
}
