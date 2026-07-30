'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Sub {
  id: string; company_name: string; contact_name: string | null; email: string | null;
  phone: string | null; website: string | null; billing_address: string | null;
  shipping_address: string | null; resale_tax_id: string | null; how_heard: string | null;
  notes: string | null; status: string; created_at: string
}

const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function NewCustomersAdmin() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Sub | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await sb.from('new_customer_submissions').select('*').order('created_at', { ascending: false })
    setRows((data ?? []) as Sub[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id: string, status: string) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, status } : r))
    setOpen(o => o && o.id === id ? { ...o, status } : o)
    await sb.from('new_customer_submissions').update({ status }).eq('id', id)
  }

  const badge = (s: string) => s === 'Added' ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20'
    : s === 'Reviewed' ? 'bg-blue-500/15 text-blue-600 border-blue-500/20'
    : 'bg-amber-500/15 text-amber-600 border-amber-500/20'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1D2E]">New Customer Signups</h1>
          <p className="text-sm text-gray-500 mt-1">Submissions from the public onboarding form.</p>
        </div>
        <button onClick={load} className="text-sm border border-[#E4E6EE] text-[#6B7280] hover:text-[#1A1D2E] px-3 py-2 rounded-xl">Refresh</button>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? (
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-10 text-center text-sm text-gray-400">No signups yet.</div>
      ) : (
        <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_auto_auto] gap-3 px-4 py-2.5 bg-[#F5F6FA] text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            <span>Company</span><span>Contact</span><span>Email / Phone</span><span>Received</span><span>Status</span>
          </div>
          <div className="divide-y divide-[#F0F1F5]">
            {rows.map(r => (
              <button key={r.id} onClick={() => setOpen(r)} className="w-full text-left grid grid-cols-[1.5fr_1fr_1fr_auto_auto] gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors items-center">
                <span className="text-sm font-medium text-[#1A1D2E] truncate">{r.company_name}</span>
                <span className="text-sm text-gray-600 truncate">{r.contact_name || '—'}</span>
                <span className="text-xs text-gray-500 truncate">{r.email || r.phone || '—'}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">{fmt(r.created_at)}</span>
                <span className={'text-[11px] px-2 py-0.5 rounded-full border ' + badge(r.status)}>{r.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" >
          <div className="bg-white border border-[#E4E6EE] rounded-2xl w-full max-w-lg shadow-sm max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E6EE]">
              <h2 className="font-semibold text-[#1A1D2E]">{open.company_name}</h2>
              <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-[#1A1D2E] p-1.5">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3 text-sm">
              {([['Contact', open.contact_name], ['Email', open.email], ['Phone', open.phone], ['Website', open.website], ['Billing address', open.billing_address], ['Shipping address', open.shipping_address], ['Resale / tax ID', open.resale_tax_id], ['How heard', open.how_heard], ['Notes', open.notes]] as [string, string | null][]).map(([k, v]) => (
                <div key={k}>
                  <div className="text-[11px] text-gray-400 uppercase tracking-wide">{k}</div>
                  <div className="text-[#1A1D2E] whitespace-pre-wrap">{v || '—'}</div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-[#E4E6EE] flex gap-2">
              <button onClick={() => setStatus(open.id, 'Reviewed')} className="flex-1 text-sm border border-[#E4E6EE] text-[#6B7280] hover:text-[#1A1D2E] py-2 rounded-xl">Mark Reviewed</button>
              <button onClick={() => setStatus(open.id, 'Added')} className="flex-1 text-sm bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-xl">Mark Added to ERP</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
