'use client'
export const dynamic = 'force-dynamic'

export default function EmailPage() {
  return (
    <div className="p-4 md:p-8 min-h-screen max-w-2xl mx-auto">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-pink-500/20 text-pink-300 border-pink-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">Email Connection</h1>
        <p className="text-gray-500 text-sm mt-0.5">Configure outbound email for notifications</p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center opacity-60">
        <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p className="text-white font-semibold">Email Integration</p>
        <p className="text-gray-500 text-sm">SMTP / SendGrid connection coming in Phase 2.</p>
      </div>
    </div>
  )
}
