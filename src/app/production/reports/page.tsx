'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useProductionReports } from '@/lib/hooks/useProductionReports'
import { useReportLineItems } from '@/lib/hooks/useReportLineItems'
import { useReportCalculations, formatNumber } from '@/lib/hooks/useReportCalculations'
import HistoricalReportsList from './HistoricalReportsList'
import CurrentWeekReport from './CurrentWeekReport'
import ReportDataEntry from './ReportDataEntry'
import ReportSummaryStats from './ReportSummaryStats'
import type { ProductionReport } from '@/lib/types/production'

type ReportType = 'walmart' | 'chewy'

interface TabConfig {
  id: ReportType
  label: string
  name: string
}

const TABS: TabConfig[] = [
  { id: 'walmart', label: 'Walmart', name: 'Walmart' },
  { id: 'chewy', label: 'Chewy', name: 'Chewy' },
]

type ViewMode = 'list' | 'detail'

export default function ProductionReportsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])

  const [activeTab, setActiveTab] = useState<ReportType>('walmart')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [userEmail, setUserEmail] = useState<string>('')
  const [selectedReport, setSelectedReport] = useState<ProductionReport | null>(null)
  const [showNewReportDialog, setShowNewReportDialog] = useState(false)

  // Get user email
  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email)
    })
  }, [sb])

  // Fetch reports for active channel
  const {
    reports: allReports,
    loading: reportsLoading,
    error: reportsError,
    refetch: refetchReports,
  } = useProductionReports({ type: activeTab })

  // Filter to show only completed/submitted for list view, or draft for edit
  const reports = useMemo(() => {
    if (viewMode === 'detail' && selectedReport) {
      return [selectedReport]
    }
    return allReports.filter(r => r.status === 'Completed' || r.status === 'Submitted')
  }, [allReports, viewMode, selectedReport])

  // Get current week's draft report (or create one)
  const draftReport = useMemo(() => {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)
    const weekNum = Math.ceil((today.getDate() + new Date(today.getFullYear(), 0, 1).getDay()) / 7)

    return allReports.find(r => r.status === 'Draft' && r.type === activeTab)
  }, [allReports, activeTab])

  // Fetch line items for selected/draft report
  const reportIdToShow = selectedReport?.id || draftReport?.id
  const {
    items: lineItems,
    loading: itemsLoading,
    error: itemsError,
    updateItem,
    deleteItem,
    refetch: refetchItems,
  } = useReportLineItems({ reportId: reportIdToShow })

  // Calculate metrics
  const calculations = useReportCalculations(lineItems)

  // Create new report
  const handleCreateReport = async () => {
    try {
      const today = new Date()
      const dateStr = today.toISOString().slice(0, 10)
      const weekNum = Math.ceil((today.getDate() + new Date(today.getFullYear(), 0, 1).getDay()) / 7)

      const { data: newReport, error: err } = await sb
        .from('production_reports')
        .insert({
          type: activeTab,
          date: dateStr,
          week_number: weekNum,
          month_number: today.getMonth() + 1,
          year_number: today.getFullYear(),
          status: 'Draft',
          data: {},
          summary_data: calculations,
          created_by: (await sb.auth.getUser()).data.user?.id,
        })
        .select()
        .single()

      if (err) throw err

      setSelectedReport(newReport)
      setViewMode('detail')
      setShowNewReportDialog(false)
      refetchReports()
    } catch (err) {
      console.error('Failed to create report:', err)
    }
  }

  const handleSubmitReport = async () => {
    if (!selectedReport) return
    try {
      const { error: err } = await sb
        .from('production_reports')
        .update({
          status: 'Submitted',
          submitted_at: new Date().toISOString(),
          summary_data: calculations,
        })
        .eq('id', selectedReport.id)

      if (err) throw err

      setSelectedReport(prev => (prev ? { ...prev, status: 'Submitted' } : null))
      refetchReports()
    } catch (err) {
      console.error('Failed to submit report:', err)
    }
  }

  const handleExportCSV = useCallback(async () => {
    if (lineItems.length === 0) {
      alert('No data to export')
      return
    }

    const headers = [
      'SKU',
      'Order Qty',
      'Pieces/Unit',
      'Total Pieces',
      'Mat1 Req',
      'Mat1 On Hand',
      'Mat1 Delta',
      'Mat2 Req',
      'Mat2 On Hand',
      'Mat2 Delta',
      'Unit Pkg Req',
      'Unit Pkg On Hand',
      'SRP Pkg Req',
      'SRP Pkg On Hand',
      'Manual Adj',
    ]

    const rows = lineItems.map(item => [
      item.sku,
      item.order_qty,
      item.pieces_per_unit,
      item.total_pieces,
      item.mat1_requirement,
      item.mat1_on_hand,
      item.mat1_delta,
      item.mat2_requirement,
      item.mat2_on_hand,
      item.mat2_delta,
      item.unit_packaging_required,
      item.unit_packaging_on_hand,
      item.srp_packaging_required,
      item.srp_packaging_on_hand,
      item.is_manual_adjustment ? 'Yes' : 'No',
    ])

    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report_${activeTab}_${selectedReport?.date || 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [lineItems, activeTab, selectedReport])

  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      {/* Header */}
      <div className="bg-white border-b border-[#E4E6EE] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1D2E]">Production Reports</h1>
              <p className="text-sm text-gray-500 mt-1">Weekly channel reports for Walmart & Chewy</p>
            </div>
            <div className="flex gap-2">
              {viewMode === 'detail' && selectedReport && (
                <button
                  onClick={handleExportCSV}
                  className="px-4 py-2 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
                >
                  <i className="ti ti-download text-lg" />
                  Export CSV
                </button>
              )}
              <button
                onClick={() => setShowNewReportDialog(true)}
                className="px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
              >
                <i className="ti ti-plus text-lg" />
                New Report
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-[#E4E6EE]">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  setViewMode('list')
                  setSelectedReport(null)
                }}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error State */}
        {(reportsError || itemsError) && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-700 font-medium">
              {reportsError || itemsError}
            </p>
          </div>
        )}

        {/* Detail View */}
        {viewMode === 'detail' && reportIdToShow && (
          <div className="space-y-6">
            {/* Report Header */}
            <div className="bg-white rounded-lg border border-[#E4E6EE] p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-[#1A1D2E]">
                    {selectedReport?.date || 'Current Report'} — {activeTab.toUpperCase()}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedReport?.status || 'Draft'} •{' '}
                    {lineItems.length} line items
                  </p>
                </div>
                <div className="space-y-2">
                  {selectedReport?.status === 'Draft' && (
                    <button
                      onClick={handleSubmitReport}
                      className="w-full px-4 py-2 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 transition-colors"
                    >
                      Submit Report
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setViewMode('list')
                      setSelectedReport(null)
                    }}
                    className="w-full px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Back to List
                  </button>
                </div>
              </div>
            </div>

            {/* Stats */}
            <ReportSummaryStats calculations={calculations} />

            {/* Data Entry */}
            {selectedReport?.status === 'Draft' && (
              <div className="bg-white rounded-lg border border-[#E4E6EE] p-6">
                <h3 className="text-lg font-semibold text-[#1A1D2E] mb-4">Add Line Items</h3>
                <ReportDataEntry
                  reportId={reportIdToShow}
                  reportType={activeTab}
                  onDataAdded={() => {
                    refetchItems()
                  }}
                />
              </div>
            )}

            {/* Current Report Table */}
            <div className="bg-white rounded-lg border border-[#E4E6EE] p-6">
              <h3 className="text-lg font-semibold text-[#1A1D2E] mb-4">Line Items</h3>
              <CurrentWeekReport
                reportId={reportIdToShow}
                items={lineItems}
                loading={itemsLoading}
                onUpdateItem={updateItem}
                onDeleteItem={deleteItem}
              />
            </div>
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="space-y-6">
            {/* Current Draft Report Card */}
            {draftReport && (
              <div
                onClick={() => {
                  setSelectedReport(draftReport)
                  setViewMode('detail')
                }}
                className="bg-white rounded-lg border-2 border-blue-300 p-6 cursor-pointer hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-blue-600">Draft Report</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {draftReport.date} • {draftReport.week_number} items tracked
                    </p>
                  </div>
                  <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                    Continue Editing →
                  </button>
                </div>
              </div>
            )}

            {/* Historical Reports */}
            <div className="bg-white rounded-lg border border-[#E4E6EE] p-6">
              <h3 className="text-lg font-semibold text-[#1A1D2E] mb-4">Historical Reports</h3>
              <HistoricalReportsList
                reports={reports}
                loading={reportsLoading}
                onSelectReport={(report) => {
                  setSelectedReport(report)
                  setViewMode('detail')
                }}
                selectedReportId={selectedReport?.id}
              />
            </div>
          </div>
        )}
      </div>

      {/* New Report Dialog */}
      {showNewReportDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewReportDialog(false)
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-5 border-b border-[#E4E6EE] flex items-center justify-between">
              <h2 className="font-semibold text-lg text-[#1A1D2E]">New Report</h2>
              <button
                onClick={() => setShowNewReportDialog(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100"
              >
                <i className="ti ti-x text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Create a new production report for {activeTab.toUpperCase()}?
              </p>
              <p className="text-xs text-gray-500">
                This will start a draft report for today. You can add line items and submit
                when ready.
              </p>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-[#E4E6EE] flex gap-3 justify-end">
              <button
                onClick={() => setShowNewReportDialog(false)}
                className="px-4 py-2 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateReport}
                className="px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors"
              >
                Create Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
