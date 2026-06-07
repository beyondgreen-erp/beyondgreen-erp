'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'
interface Toast { id: string; type: ToastType; message: string }

const CFG: Record<ToastType, { bg: string; border: string; icon: string; color: string }> = {
  success: { bg: 'bg-[#00C89615]', border: 'border-[#00C89640]', icon: 'M5 13l4 4L19 7', color: 'text-[#00C896]' },
  error:   { bg: 'bg-[#EF444415]', border: 'border-[#EF444440]', icon: 'M6 18L18 6M6 6l12 12', color: 'text-red-400' },
  warning: { bg: 'bg-[#F59E0B15]', border: 'border-[#F59E0B40]', icon: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z', color: 'text-amber-400' },
  info:    { bg: 'bg-[#0EA5E915]', border: 'border-[#0EA5E940]', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-sky-400' },
}

interface ToastContextValue { toast: (msg: string, type?: ToastType) => void }
const ToastContext = createContext<ToastContextValue>({ toast: () => {} })
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const remove = useCallback((id: string) => {
    clearTimeout(timers.current[id])
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t.slice(-4), { id, type, message }])
    timers.current[id] = setTimeout(() => remove(id), 4000)
  }, [remove])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => {
          const c = CFG[t.type]
          return (
            <div
              key={t.id}
              className={`toast-enter pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border ${c.bg} ${c.border} shadow-xl backdrop-blur-sm max-w-xs`}
            >
              <svg className={`w-4 h-4 shrink-0 ${c.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={c.icon} />
              </svg>
              <p className="text-sm text-[#1A1D2E] flex-1">{t.message}</p>
              <button onClick={() => remove(t.id)} className="text-[#5A5A6A] hover:text-gray-700 shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
