'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react'
import { checkInventoryForOrder, createWorkOrdersForShortages, onStatusChange } from '@/lib/orderFlow'

interface Props {
  orderId: string
  orderNumber: string
  onClose: () => void
  onDone: (result: 'shipped' | 'production' | 'cancelled') => void
}

export default function InventoryCheckModal({ orderId, orderNumber, onClose, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<any>(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    checkInventoryForOrder(orderId).then(r => {
      setResult(r)
      setLoading(false)
    })
  }, [orderId])

  async function handleSendToShipping() {
    setActing(true)
    await onStatusChange(orderId, 'Ready to Ship', 'Confirmed')
    onDone('shipped')
  }

  async function handleCreateWorkOrders() {
    setActing(true)
    await createWorkOrdersForShortages(orderId, result.shortages)
    onDone('production')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b flex items-center justify-between"
          style={{ borderColor: '#E4E6EE' }}>
          <div>
            <h2 className="font-semibold text-base" style={{ color: '#1A1D2E' }}>
              Inventory Check — {orderNumber}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: '#9CA3AF' }}>
              Verifying stock levels for all line items
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
            style={{ color: '#6B7280' }}>
            <i className="ti ti-x text-sm" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500
                rounded-full animate-spin mr-3" />
              <span className="text-sm" style={{ color: '#9CA3AF' }}>
                Checking inventory...
              </span>
            </div>
          ) : (
            <>
              {/* Summary banner */}
              <div className="rounded-xl p-4 mb-5"
                style={{
                  background: result.allSufficient ? '#ECFDF5' : '#FFF7ED',
                  border: `1px solid ${result.allSufficient ? '#A7F3D0' : '#FED7AA'}`
                }}>
                <div className="flex items-center gap-2">
                  <i className={`ti ${result.allSufficient
                    ? 'ti-check text-green-600'
                    : 'ti-alert-triangle text-amber-600'
                  } text-lg`} />
                  <p className="text-sm font-semibold"
                    style={{ color: result.allSufficient ? '#065F46' : '#92400E' }}>
                    {result.allSufficient
                      ? 'All items in stock — ready to ship'
                      : `${result.shortages.length} item${result.shortages.length !== 1 ? 's' : ''} need production · ${result.sufficient.length} item${result.sufficient.length !== 1 ? 's' : ''} in stock`
                    }
                  </p>
                </div>
              </div>

              {/* Items table */}
              {([...result.shortages, ...result.sufficient]).length > 0 && (
                <div className="rounded-xl border overflow-hidden mb-5"
                  style={{ borderColor: '#E4E6EE' }}>
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E4E6EE' }}>
                        {['SKU', 'Product', 'Required', 'In Stock', 'Status'].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold
                            uppercase tracking-wider" style={{ color: '#9CA3AF' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...result.shortages, ...result.sufficient].map((item: any, i: number) => {
                        const isShort = item.qty_short !== undefined
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                            <td className="px-4 py-3 text-xs font-semibold"
                              style={{ color: '#3B6FE0' }}>{item.sku}</td>
                            <td className="px-4 py-3 text-sm max-w-[160px] truncate"
                              style={{ color: '#1A1D2E' }}>{item.product_name}</td>
                            <td className="px-4 py-3 text-sm text-right"
                              style={{ color: '#1A1D2E' }}>
                              {(item.qty_required || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-semibold"
                              style={{ color: isShort ? '#DC2626' : '#059669' }}>
                              {(item.qty_on_hand || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              {isShort ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1
                                  rounded-full text-xs font-medium"
                                  style={{ background: '#FEF2F2', color: '#DC2626' }}>
                                  <i className="ti ti-tool text-xs" />
                                  Need {item.qty_short.toLocaleString()} more
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1
                                  rounded-full text-xs font-medium"
                                  style={{ background: '#ECFDF5', color: '#059669' }}>
                                  <i className="ti ti-check text-xs" />
                                  In Stock
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {result.shortages.length === 0 && result.sufficient.length === 0 && (
                <div className="text-center py-6 text-sm text-gray-400 mb-4">
                  No SKU&apos;d line items found on this order.
                </div>
              )}

              {/* Work orders preview */}
              {!result.allSufficient && result.shortages.length > 0 && (
                <div className="rounded-xl p-4 mb-2"
                  style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                  <p className="text-sm font-medium mb-1" style={{ color: '#1E40AF' }}>
                    <i className="ti ti-info-circle mr-1.5" />
                    {result.shortages.length} Work Order{result.shortages.length !== 1 ? 's' : ''} will be created
                  </p>
                  <p className="text-xs" style={{ color: '#3B82F6' }}>
                    Each shortage item gets its own Work Order (status: Queued).
                    Shea or Veejay must approve, assign a machine, and schedule before production begins.
                    Once all work orders complete, this order automatically moves to the Shipping Queue.

                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="px-6 py-4 border-t flex items-center justify-end gap-3"
            style={{ borderColor: '#E4E6EE', background: '#F9FAFB' }}>
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-gray-100"
              style={{ borderColor: '#E4E6EE', color: '#6B7280' }}>
              Cancel
            </button>
            {result?.allSufficient ? (
              <button
                onClick={handleSendToShipping}
                disabled={acting}
                className="flex items-center gap-2 px-5 py-2 rounded-lg
                  text-sm font-medium text-white disabled:opacity-50 transition-colors"
                style={{ background: acting ? '#059669cc' : '#059669' }}>
                <i className="ti ti-truck text-sm" />
                {acting ? 'Moving...' : 'Send to Shipping Queue'}
              </button>
            ) : result?.shortages?.length > 0 ? (
              <button
                onClick={handleCreateWorkOrders}
                disabled={acting}
                className="flex items-center gap-2 px-5 py-2 rounded-lg
                  text-sm font-medium text-white disabled:opacity-50 transition-colors"
                style={{ background: acting ? '#3B6FE0cc' : '#3B6FE0' }}>
                <i className="ti ti-tool text-sm" />
                {acting ? 'Creating...' : `Create ${result.shortages.length} Work Order${result.shortages.length !== 1 ? 's' : ''}`}
              </button>
            ) : (
              <button
                onClick={handleSendToShipping}
                disabled={acting}
                className="flex items-center gap-2 px-5 py-2 rounded-lg
                  text-sm font-medium text-white disabled:opacity-50 transition-colors"
                style={{ background: '#059669' }}>
                <i className="ti ti-truck text-sm" />
                {acting ? 'Moving...' : 'Send to Shipping Queue'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
