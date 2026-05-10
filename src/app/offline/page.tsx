'use client'
export const dynamic = 'force-dynamic'
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-6 text-center">
      <div className="mb-8 relative">
        <svg
          className="w-20 h-20 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ animation: 'pulse 2s ease-in-out infinite' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M12 12h.01M3 3l18 18" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-red-500" style={{ animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite' }} />
        </div>
      </div>

      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
        style={{ background: 'rgba(29,158,117,0.15)', border: '1px solid rgba(29,158,117,0.3)' }}>
        <span className="font-black text-xl" style={{ color: '#1D9E75', fontFamily: 'monospace' }}>bG</span>
      </div>

      <h1 className="text-2xl font-semibold text-white mb-2">You are offline</h1>
      <p className="text-gray-500 text-sm mb-8 max-w-xs">
        Reconnect to access your ERP. Some cached data may still be available.
      </p>

      <button
        onClick={() => window.location.reload()}
        className="px-6 py-3 rounded-xl text-sm font-medium text-white transition-all"
        style={{
          background: 'rgba(29,158,117,0.2)',
          border: '1px solid rgba(29,158,117,0.4)',
          color: '#1D9E75',
        }}
      >
        Try again
      </button>
    </div>
  )
}
