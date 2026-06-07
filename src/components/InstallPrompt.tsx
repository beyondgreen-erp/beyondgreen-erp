'use client'
import { useEffect, useState } from 'react'

export default function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (localStorage.getItem('pwa-install-dismissed')) return

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream
    setIsIOS(ios)

    if (ios) {
      setShow(true)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handler(e: any) {
      e.preventDefault()
      setDeferredPrompt(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    localStorage.setItem('pwa-install-dismissed', '1')
    setShow(false)
  }

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') { setShow(false); return }
    }
    dismiss()
  }

  if (!show) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center gap-3 px-4 py-3 text-sm"
      style={{
        background: 'linear-gradient(135deg, #0f2a1e 0%, #0a1f18 100%)',
        borderBottom: '1px solid rgba(29,158,117,0.3)',
        animation: 'slideDown 0.3s ease-out',
      }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'rgba(29,158,117,0.2)', border: '1px solid rgba(29,158,117,0.4)' }}>
        <span className="font-black text-xs" style={{ color: '#1D9E75', fontFamily: 'monospace' }}>bG</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-xs leading-tight">Install beyondGREEN ERP on your phone</p>
        {isIOS
          ? <p className="text-gray-400 text-[10px] mt-0.5">Tap <strong className="text-gray-500">Share</strong> then <strong className="text-gray-500">Add to Home Screen</strong></p>
          : <p className="text-gray-400 text-[10px] mt-0.5">Get the full app experience — works offline</p>
        }
      </div>
      {!isIOS && (
        <button onClick={install}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: '#1D9E75', color: 'white' }}>
          Install
        </button>
      )}
      <button onClick={dismiss} className="shrink-0 p-1 text-gray-500 hover:text-gray-600">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
