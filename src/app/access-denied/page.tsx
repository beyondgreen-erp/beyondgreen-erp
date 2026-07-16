'use client'
export const dynamic = 'force-dynamic'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function AccessDeniedPage() {
  async function signOut() {
    const sb = createSupabaseBrowserClient()
    await sb.auth.signOut()
    window.location.href = '/login'
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F5F6FA' }}>
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#E4E6EE] shadow-sm p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <i className="ti ti-lock text-red-500 text-2xl" />
        </div>
        <h1 className="text-xl font-bold text-[#1A1D2E]">Access restricted</h1>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">
          The beyondGREEN ERP is only available to <strong className="text-[#1A1D2E]">@beyondgreenbiotech.com</strong> and{' '}
          <strong className="text-[#1A1D2E]">@byndgrn.com</strong> accounts. This account isn’t authorized to access it.
        </p>
        <button onClick={signOut} className="mt-6 w-full bg-[#1A2035] hover:bg-[#243056] text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">
          Sign out
        </button>
        <p className="text-[11px] text-gray-400 mt-3">If you believe this is a mistake, contact your beyondGREEN administrator.</p>
      </div>
    </div>
  )
}
