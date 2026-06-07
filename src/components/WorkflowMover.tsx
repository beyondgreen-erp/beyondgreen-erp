'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { onStatusChange, checkInventoryForOrder, addToShippingQueue, type OrderStatus } from '@/lib/orderFlow'

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
  handler: () => Promise<string | void>
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
                ${done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-500 text-white ring-2 ring-blue-400/30' : 'bg-[#F5F6FA] text-gray-600 border border-[#E4E6EE]'}`}>
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
              <div className={`w-4 h-px mb-4 ${i < current ? 'bg-emerald-500/50' : 'bg-[#F5F6FA]'}`}/>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function WorkflowMover({ recordId, recordType, currentStatus, orderNumber, onMoved }: WorkflowMoverProps) {
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

  async function run(label: string, fn: () => Promise<string | void>) {
    setLoading(label)
    setMsg('')
    try {
      const customMsg = await fn()
      setMsg(`✓ ${customMsg ?? label}`)
      setOpen(false)
      setTimeout(() => setMsg(''), 4000)
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
            label: '⚡ Fulfill Order',
            description: 'Check inventory → auto-route to production or shipping',
            color: 'text-emerald-400',
            handler: async () => {
              const { sufficient, shortages } = await checkInventoryForOrder(recordId)
              if (sufficient) {
                await sb.from('sales_orders').update({ status: 'Ready to Ship', updated_at: new Date().toISOString() }).eq('id', recordId)
                await addToShippingQueue(recordId)
                return 'Inventory OK → Added to Shipping Queue'
              } else {
                const { data: existingWo } = await sb.from('work_orders').select('wo_number').eq('sales_order_id', recordId).maybeSingle()
                if (existingWo) {
                  return `Work Order ${(existingWo as any).wo_number} already exists — awaiting production`
                }
                const woNum = 'WO-' + (orderNumber ?? Date.now().toString().slice(-6))
                const { error: woErr } = await sb.from('work_orders').insert({ sales_order_id: recordId, wo_number: woNum, status: 'Queued', is_active: true, qty_ordered: 0, qty_produced: 0 })
                if (woErr) throw new Error('Work order creation failed: ' + woErr.message)
                await sb.from('sales_orders').update({ status: 'Production Queue', updated_at: new Date().toISOString() }).eq('id', recordId)
                const skus = shortages.map(s => `${s.sku} (need ${s.needed}, have ${s.available})`).join('; ')
                return `Work Order ${woNum} created — Short: ${skus}`
              }
            },
          },
          {
            label: 'Create Work Order',
            description: 'Create a linked work order for this sales order',
            color: 'text-violet-400',
            handler: async () => {
              // Idempotency check — don't create a duplicate
              const { data: existing } = await sb.from('work_orders').select('wo_number').eq('sales_order_id', recordId).maybeSingle()
              if (existing) return `Work Order ${(existing as any).wo_number} already exists for this order`
              const woNum = 'WO-' + (orderNumber ?? Date.now().toString().slice(-6))
              // If the order is already flagged In Production, create the WO as In Progress
              const woStatus = currentStatus === 'In Production' ? 'In Progress' : 'Queued'
              const { error: woErr } = await sb.from('work_orders').insert({ sales_order_id: recordId, wo_number: woNum, status: woStatus, is_active: true, qty_ordered: 0, qty_produced: 0 })
              if (woErr) throw new Error('Work order creation failed: ' + woErr.message)
              // Only change SO status if it wasn't already in an active production state
              if (currentStatus !== 'In Production' && currentStatus !== 'Production Queue') {
                await sb.from('sales_orders').update({ status: 'Production Queue', updated_at: new Date().toISOString() }).eq('id', recordId)
              }
              return `Work Order ${woNum} created (${woStatus})`
            },
          },
          {
            label: 'Mark Ready to Ship',
            color: 'text-blue-400',
            handler: async () => {
              await sb.from('sales_orders').update({ status: 'Ready to Ship', updated_at: new Date().toISOString() }).eq('id', recordId)
              await addToShippingQueue(recordId)
              return 'Added to Shipping Queue'
            },
          },
          {
            label: 'Mark Shipped',
            color: 'text-teal-400',
            handler: async () => {
              const prev = currentStatus as OrderStatus
              await sb.from('sales_orders').update({ status: 'Shipped', updated_at: new Date().toISOString() }).eq('id', recordId)
              const result = await onStatusChange(recordId, 'Shipped', prev)
              return result.message
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
          {
            label: 'Start Production',
            color: 'text-blue-400',
            handler: async () => {
              await sb.from('work_orders').update({ status: 'In Progress', updated_at: new Date().toISOString() }).eq('id', recordId)
              const { data: wo } = await sb.from('work_orders').select('sales_order_id').eq('id', recordId).maybeSingle()
              if ((wo as any)?.sales_order_id) {
                await sb.from('sales_orders').update({ status: 'In Production', updated_at: new Date().toISOString() }).eq('id', (wo as any).sales_order_id)
              }
              return 'Production started → Order status: In Production'
            },
          },
          {
            label: 'Production Complete → QC',
            color: 'text-violet-400',
            handler: async () => {
              await sb.from('work_orders').update({ status: 'QC', updated_at: new Date().toISOString() }).eq('id', recordId)
              // Add finished goods to inventory
              const { data: wo } = await sb.from('work_orders').select('sales_order_id, product_id, qty_produced').eq('id', recordId).maybeSingle()
              if (wo?.product_id && (wo.qty_produced ?? 0) > 0) {
                const { data: prod } = await sb.from('products').select('on_hand_qty').eq('id', wo.product_id).maybeSingle()
                if (prod) {
                  await sb.from('products').update({ on_hand_qty: ((prod as any).on_hand_qty ?? 0) + wo.qty_produced }).eq('id', wo.product_id)
                }
              }
              // Advance sales order to QC stage
              if (wo?.sales_order_id) {
                await sb.from('sales_orders').update({ status: 'QC', updated_at: new Date().toISOString() }).eq('id', wo.sales_order_id)
                return 'Production complete → Order moved to QC'
              }
              return 'Work order sent to QC'
            },
          },
          {
            label: 'Skip QC → Ready to Ship',
            color: 'text-emerald-400',
            handler: async () => {
              await sb.from('work_orders').update({ status: 'Complete', updated_at: new Date().toISOString() }).eq('id', recordId)
              const { data: wo } = await sb.from('work_orders').select('sales_order_id, product_id, qty_produced').eq('id', recordId).maybeSingle()
              if (wo?.product_id && (wo.qty_produced ?? 0) > 0) {
                const { data: prod } = await sb.from('products').select('on_hand_qty').eq('id', wo.product_id).maybeSingle()
                if (prod) {
                  await sb.from('products').update({ on_hand_qty: ((prod as any).on_hand_qty ?? 0) + wo.qty_produced }).eq('id', wo.product_id)
                }
              }
              if (wo?.sales_order_id) {
                await sb.from('sales_orders').update({ status: 'Ready to Ship', updated_at: new Date().toISOString() }).eq('id', wo.sales_order_id)
                await addToShippingQueue(wo.sales_order_id)
                return 'Work order complete → Order added to Shipping Queue'
              }
              return 'Work order marked complete'
            },
          },
          {
            label: 'Put On Hold',
            color: 'text-amber-400',
            handler: async () => { await sb.from('work_orders').update({ status: 'On Hold', updated_at: new Date().toISOString() }).eq('id', recordId) },
          },
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
        className="flex items-center gap-1 text-xs border border-[#E4E6EE] text-[#6B7280] hover:text-[#1A1D2E] hover:border-[#D0D3E0] px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
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
        <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-[#E4E6EE] rounded-xl shadow-lg py-1 min-w-[180px]">
          {actions.map(action => (
            <button
              key={action.label}
              onClick={() => run(action.label, action.handler)}
              disabled={loading !== null}
              className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#F5F6FA] transition-colors flex items-center justify-between gap-2 disabled:opacity-50 ${action.color ?? 'text-[#374151]'}`}
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
