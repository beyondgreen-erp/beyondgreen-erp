'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export type WorkflowRecordType = 'quotation' | 'sales_order' | 'production' | 'shipment' | 'invoice'

interface WorkflowMoverProps {
  recordId: string
  recordType: WorkflowRecordType
  currentStatus: string
  orderNumber?: string
  customerId?: string | null
  onMoved?: () => void
}

interface Action {
  label: string
  description?: string
  color?: string
  handler: () => Promise<void>
}

function getWorkflowStage(status: string): number {
  const map: Record<string, number> = {
    'Draft': 0, 'Sent': 0,
    'Pending': 1, 'Confirmed': 1, 'New': 1, 'On Hold': 1,
    'In Production': 2, 'Awaiting Production': 2,
    'Complete': 3, 'Production Complete': 3, 'QC': 3,
    'Ready to Ship': 4, 'Ready at Will Call': 4, 'Partially Shipped': 4,
    'Shipped': 5,
    'Invoiced': 6,
    'Paid': 7,
  }
  return map[status] ?? 1
}

const WORKFLOW_STAGES = ['Quote', 'Sales Order', 'Production', 'QC', 'Shipping', 'Shipped', 'Invoiced', 'Paid']

export function WorkflowProgressBar({ status }: { status: string }) {
  const current = getWorkflowStage(status)
  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto pb-1">
      {WORKFLOW_STAGES.map((stage, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={stage} className="flex items-center">
            <div className={`flex flex-col items-center gap-1 min-w-[56px]`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
                ${done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-500 text-white ring-2 ring-blue-400/30' : 'bg-gray-800 text-gray-600 border border-gray-700'}`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span className={`text-[9px] whitespace-nowrap font-medium ${done ? 'text-emerald-500' : active ? 'text-blue-400' : 'text-gray-600'}`}>
                {stage}
              </span>
            </div>
            {i < WORKFLOW_STAGES.length - 1 && (
              <div className={`w-4 h-px mb-4 ${i < current ? 'bg-emerald-500/50' : 'bg-gray-700'}`}/>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function WorkflowMover({ recordId, recordType, orderNumber, onMoved }: WorkflowMoverProps) {
  const sb = createSupabaseBrowserClient()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  async function run(label: string, fn: () => Promise<void>) {
    setLoading(label)
    setMsg('')
    try {
      await fn()
      setMsg(`✓ ${label}`)
      setOpen(false)
      setTimeout(() => setMsg(''), 3000)
      onMoved?.()
    } catch (e: any) {
      setMsg(`Error: ${e?.message ?? 'Unknown error'}`)
    } finally {
      setLoading(null)
    }
  }

  function buildActions(): Action[] {
    switch (recordType) {
      case 'quotation':
        return [
          {
            label: 'Convert to Sales Order',
            color: 'text-emerald-400',
            handler: async () => {
              const { data: quote } = await sb.from('quotations').select('*, quotation_lines(*)').eq('id', recordId).single()
              if (!quote) throw new Error('Quote not found')
              const soNum = 'SO-' + (quote.quote_number ?? Date.now().toString().slice(-6))
              const { data: so, error: soErr } = await sb.from('sales_orders').insert({
                customer_id: quote.customer_id,
                order_number: soNum,
                status: 'Pending',
                notes: `Converted from Quote #${quote.quote_number}`,
                quotation_id: quote.id,
              }).select('id').single()
              if (soErr || !so) throw soErr ?? new Error('Failed to create SO')
              const lines = (quote.quotation_lines as any[]) ?? []
              if (lines.length > 0) {
                await sb.from('sales_order_lines').insert(
                  lines.map(l => ({
                    sales_order_id: (so as any).id,
                    line_number: l.line_number,
                    product_id: l.product_id ?? null,
                    sku: l.sku ?? null,
                    description: l.description ?? '',
                    quantity: l.quantity ?? 1,
                    quantity_shipped: 0,
                    unit_of_measure: l.unit_of_measure ?? null,
                    unit_price: l.unit_price ?? 0,
                    discount_pct: l.discount_pct ?? 0,
                  }))
                )
              }
              await sb.from('quotations').update({ status: 'Accepted', updated_at: new Date().toISOString() }).eq('id', recordId)
            },
          },
          { label: 'Mark Accepted', handler: async () => { await sb.from('quotations').update({ status: 'Accepted', updated_at: new Date().toISOString() }).eq('id', recordId) } },
          { label: 'Mark Rejected', color: 'text-red-400', handler: async () => { await sb.from('quotations').update({ status: 'Rejected', updated_at: new Date().toISOString() }).eq('id', recordId) } },
        ]

      case 'sales_order':
        return [
          {
            label: 'Send to Production',
            color: 'text-violet-400',
            handler: async () => {
              await sb.from('sales_orders').update({ status: 'In Production', updated_at: new Date().toISOString() }).eq('id', recordId)
              const woNum = 'WO-' + (orderNumber ?? Date.now().toString().slice(-6))
              await sb.from('work_orders').insert({
                sales_order_id: recordId,
                wo_number: woNum,
                status: 'Queued',
                is_active: true,
              })
            },
          },
          {
            label: 'Ready to Ship',
            color: 'text-blue-400',
            handler: async () => {
              await sb.from('sales_orders').update({ status: 'Ready to Ship', updated_at: new Date().toISOString() }).eq('id', recordId)
            },
          },
          {
            label: 'Mark Shipped',
            color: 'text-emerald-400',
            handler: async () => {
              await sb.from('sales_orders').update({ status: 'Shipped', updated_at: new Date().toISOString() }).eq('id', recordId)
            },
          },
          {
            label: 'Create Invoice',
            color: 'text-amber-400',
            handler: async () => {
              const { data: order } = await sb.from('sales_orders').select('*, sales_order_lines(*)').eq('id', recordId).single()
              if (!order) throw new Error('Order not found')
              const lines = (order.sales_order_lines as any[]) ?? []
              const subtotal = lines.reduce((s: number, l: any) => s + ((l.quantity ?? 0) * (l.unit_price ?? 0) * (1 - (l.discount_pct ?? 0) / 100)), 0)
              const invNum = 'INV-' + Date.now().toString().slice(-6)
              const { data: inv, error: invErr } = await sb.from('invoices').insert({
                invoice_number: invNum,
                customer_id: order.customer_id,
                sales_order_id: recordId,
                status: 'pending',
                invoice_date: new Date().toISOString().slice(0, 10),
                due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
                subtotal,
                tax_pct: order.tax_pct ?? 0,
                total_amount: subtotal * (1 + (order.tax_pct ?? 0) / 100),
                amount_paid: 0,
                balance_due: subtotal * (1 + (order.tax_pct ?? 0) / 100),
              }).select('id').single()
              if (invErr || !inv) throw invErr ?? new Error('Failed to create invoice')
              if (lines.length > 0) {
                await sb.from('invoice_line_items').insert(
                  lines.map((l: any) => ({
                    invoice_id: (inv as any).id,
                    sku: l.sku ?? null,
                    description: l.description ?? '',
                    quantity: l.quantity ?? 1,
                    unit_price: l.unit_price ?? 0,
                    uom: l.unit_of_measure ?? null,
                    line_total: (l.quantity ?? 0) * (l.unit_price ?? 0) * (1 - (l.discount_pct ?? 0) / 100),
                  }))
                )
              }
              await sb.from('sales_orders').update({ status: 'Closed', updated_at: new Date().toISOString() }).eq('id', recordId)
            },
          },
          {
            label: 'Put On Hold',
            color: 'text-amber-400',
            handler: async () => { await sb.from('sales_orders').update({ status: 'On Hold', updated_at: new Date().toISOString() }).eq('id', recordId) },
          },
          {
            label: 'Cancel Order',
            color: 'text-red-400',
            handler: async () => { if (!confirm('Cancel this order?')) throw new Error('Cancelled'); await sb.from('sales_orders').update({ status: 'Cancelled', updated_at: new Date().toISOString() }).eq('id', recordId) },
          },
        ]

      case 'production':
        return [
          { label: 'Start Production', color: 'text-blue-400', handler: async () => { await sb.from('work_orders').update({ status: 'In Progress', updated_at: new Date().toISOString() }).eq('id', recordId) } },
          { label: 'Send to QC', color: 'text-violet-400', handler: async () => { await sb.from('work_orders').update({ status: 'QC', updated_at: new Date().toISOString() }).eq('id', recordId) } },
          { label: 'Mark Complete', color: 'text-emerald-400', handler: async () => { await sb.from('work_orders').update({ status: 'Complete', updated_at: new Date().toISOString() }).eq('id', recordId) } },
          { label: 'Put On Hold', color: 'text-amber-400', handler: async () => { await sb.from('work_orders').update({ status: 'On Hold', updated_at: new Date().toISOString() }).eq('id', recordId) } },
        ]

      case 'invoice':
        return [
          {
            label: 'Mark Paid',
            color: 'text-emerald-400',
            handler: async () => {
              const { data: inv } = await sb.from('invoices').select('total_amount').eq('id', recordId).single()
              const total = (inv as any)?.total_amount ?? 0
              await sb.from('invoices').update({ status: 'paid', amount_paid: total, balance_due: 0, updated_at: new Date().toISOString() }).eq('id', recordId)
            },
          },
          { label: 'Mark Overdue', color: 'text-red-400', handler: async () => { await sb.from('invoices').update({ status: 'overdue', updated_at: new Date().toISOString() }).eq('id', recordId) } },
          { label: 'Void Invoice', color: 'text-gray-400', handler: async () => { if (!confirm('Void this invoice?')) throw new Error('Cancelled'); await sb.from('invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', recordId) } },
        ]

      default:
        return []
    }
  }

  const actions = buildActions()
  if (actions.length === 0) return null

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
      >
        Send To
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {msg && (
        <div className={`absolute top-full mt-1 left-0 z-50 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${msg.startsWith('✓') ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'}`}>
          {msg}
        </div>
      )}

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-[#1A1A1F] border border-[#3A3A45] rounded-xl shadow-2xl py-1 min-w-[180px]">
          {actions.map(action => (
            <button
              key={action.label}
              onClick={() => run(action.label, action.handler)}
              disabled={loading !== null}
              className={`w-full text-left px-4 py-2.5 text-xs hover:bg-gray-800/60 transition-colors flex items-center justify-between gap-2 disabled:opacity-50 ${action.color ?? 'text-gray-300'}`}
            >
              <span>{action.label}</span>
              {loading === action.label && (
                <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
