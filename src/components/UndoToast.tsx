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

  const barColor = type === 'error' ? '#DC2626' : type === 'info' ? '#2563EB' : '#059669'
  const iconBg = type === 'error' ? '#FEF2F2' : type === 'info' ? '#EFF6FF' : '#ECFDF5'
  const iconColor = type === 'error' ? '#DC2626' : type === 'info' ? '#2563EB' : '#059669'

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-80 rounded-2xl shadow-xl overflow-hidden"
      style={{background:'#FFFFFF',border:'1px solid #E4E6EE'}}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{background:iconBg}}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{color:iconColor}}>
            {type === 'error'
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
            }
          </svg>
        </div>
        <p className="text-sm flex-1 leading-snug" style={{color:'#1A1D2E'}}>{message}</p>
        <div className="flex items-center gap-0.5 shrink-0">
          {onUndo && (
            <button onClick={() => { onUndo(); onDismiss() }}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
              style={{color:'#059669'}}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#ECFDF5'}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}>
              Undo
            </button>
          )}
          <button onClick={onDismiss}
            className="p-1.5 rounded-lg transition-colors" style={{color:'#9CA3AF'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F5F6FA'}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="h-0.5" style={{background:'#F3F4F6'}}>
        <div className="h-full transition-all" style={{width:`${progress}%`,background:barColor,transition:'width 40ms linear'}}/>
      </div>
    </div>
  )
}
