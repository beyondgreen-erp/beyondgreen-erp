'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useToast } from '@/components/Toast'

interface QCInspection {
  id: string
  work_order_id: string | null
  order_id: string | null
  product_id: string | null
  inspector_email: string | null
  sku: string | null
  product_name: string | null
  batch_number: string | null
  qty_inspected: number
  qty_passed: number
  qty_failed: number
  qty_rework: number
  overall_result: string
  inspection_date: string | null
  inspection_type: string
  notes: string | null
  failure_notes: string | null
  corrective_action: string | null
  created_at: string
}

interface QCParam {
  id: string
  parameter_name: string
  parameter_code: string | null
  description: string | null
  measurement_type: string
  unit: string | null
  min_value: number | null
  max_value: number | null
  is_critical: boolean
  is_global: boolean
  product_id: string | null
}

interface QCResult {
  id?: string
  parameter_id: string
  result: string
  measured_value: string
  notes: string
}

interface WorkOrder { id: string; wo_number: string; product_id: string | null; qty_ordered: number; status: string }
interface Product { id: string; name: string; sku: string | null }
interface UserProfile { email: string; full_name: string }

const RESULT_CFG: Record<string,{label:string;cls:string;dot:string}> = {
  Pending:              { label:'Pending',              cls:'bg-[#2A2A35] text-[#9898A8] border-[#3A3A45]', dot:'bg-[#5A5A6A]' },
  Pass:                 { label:'Pass',                 cls:'bg-[#00C89615] text-[#00C896] border-[#00C89630]', dot:'bg-[#00C896]' },
  'Pass with Conditions':{ label:'Pass w/ Conditions',  cls:'bg-amber-500/15 text-amber-400 border-amber-500/25', dot:'bg-amber-400' },
  Fail:                 { label:'Fail',                 cls:'bg-red-500/15 text-red-400 border-red-500/25', dot:'bg-red-500' },
  'Rework Required':    { label:'Rework Required',      cls:'bg-orange-500/15 text-orange-400 border-orange-500/25', dot:'bg-orange-500' },
}

const INS_TYPES = ['In-Process','Final','Incoming','Re-inspection']

const fmt = (n: number) => n.toLocaleString()

function ResultBadge({ result }: { result: string }) {
  const c = RESULT_CFG[result] ?? RESULT_CFG.Pending
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${c.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

export default function QCPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const { toast } = useToast()
  const [rows, setRows] = useState<QCInspection[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [params, setParams] = useState<QCParam[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('Pending')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<QCInspection | null>(null)
  const [saving, setSaving] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [results, setResults] = useState<Record<string, QCResult>>({})
  const [tableExists, setTableExists] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    work_order_id: '', product_id: '', inspector_email: '',
    batch_number: '', qty_inspected: '0', qty_passed: '0',
    qty_failed: '0', qty_rework: '0',
    overall_result: 'Pending', inspection_type: 'Final',
    inspection_date: new Date().toISOString().slice(0,10),
    notes: '', failure_notes: '', corrective_action: '',
  })

  async function load() {
    setLoading(true)
    const [insp, wos, prods, pms, usrs] = await Promise.all([
      sb.from('qc_inspections').select('*').order('created_at',{ascending:false}),
      sb.from('work_orders').select('id,wo_number,product_id,qty_ordered,status').order('created_at',{ascending:false}).limit(100),
      sb.from('products').select('id,name,sku').order('name').limit(500),
      sb.from('qc_parameters').select('*').eq('is_active',true).order('display_order'),
      sb.from('user_profiles').select('email,full_name').order('full_name'),
    ])
    if (insp.error?.code === '42P01') { setTableExists(false); setLoading(false); return }
    setTableExists(true)
    setRows(insp.data ?? [])
    setWorkOrders(wos.data ?? [])
    setProducts(prods.data ?? [])
    setParams(pms.data ?? [])
    setUsers(usrs.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  const woMap = Object.fromEntries(workOrders.map(w => [w.id, w]))
  const prodMap = Object.fromEntries(products.map(p => [p.id, p]))

  const tabs = ['Pending','Pass','Pass with Conditions','Fail','Rework Required','All']
  const filtered = rows.filter(r => {
    if (tab !== 'All' && r.overall_result !== tab) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (r.sku ?? '').toLowerCase().includes(q) ||
           (r.product_name ?? '').toLowerCase().includes(q) ||
           (r.batch_number ?? '').toLowerCase().includes(q) ||
           (r.overall_result ?? '').toLowerCase().includes(q)
  })

  const stats = {
    today: rows.filter(r => r.inspection_date === new Date().toISOString().slice(0,10)).length,
    pending: rows.filter(r => r.overall_result === 'Pending').length,
    passRate: rows.length > 0
      ? Math.round(rows.filter(r => ['Pass','Pass with Conditions'].includes(r.overall_result)).length / rows.filter(r => r.overall_result !== 'Pending').length * 100) || 0
      : 0,
    failed: rows.filter(r => r.overall_result === 'Fail').length,
  }

  function openAdd() {
    setEditing(null)
    setForm({
      work_order_id: '', product_id: '', inspector_email: userEmail,
      batch_number: `BATCH-${Date.now().toString().slice(-6)}`,
      qty_inspected: '0', qty_passed: '0', qty_failed: '0', qty_rework: '0',
      overall_result: 'Pending', inspection_type: 'Final',
      inspection_date: new Date().toISOString().slice(0,10),
      notes: '', failure_notes: '', corrective_action: '',
    })
    setResults({})
    setOpen(true)
  }

  function openEdit(r: QCInspection) {
    setEditing(r)
    setForm({
      work_order_id: r.work_order_id ?? '',
      product_id: r.product_id ?? '',
      inspector_email: r.inspector_email ?? '',
      batch_number: r.batch_number ?? '',
      qty_inspected: String(r.qty_inspected),
      qty_passed: String(r.qty_passed),
      qty_failed: String(r.qty_failed),
      qty_rework: String(r.qty_rework),
      overall_result: r.overall_result,
      inspection_type: r.inspection_type,
      inspection_date: r.inspection_date ?? new Date().toISOString().slice(0,10),
      notes: r.notes ?? '',
      failure_notes: r.failure_notes ?? '',
      corrective_action: r.corrective_action ?? '',
    })
    if (r.id) {
      sb.from('qc_results').select('*').eq('inspection_id', r.id).then(({ data }) => {
        const map: Record<string, QCResult> = {}
        for (const res of (data ?? [])) map[res.parameter_id] = res
        setResults(map)
      })
    }
    setOpen(true)
  }

  function close() { setOpen(false); setTimeout(() => setEditing(null), 300) }

  function setParamResult(paramId: string, result: string) {
    setResults(prev => ({ ...prev, [paramId]: { ...prev[paramId], parameter_id: paramId, result, measured_value: prev[paramId]?.measured_value ?? '', notes: prev[paramId]?.notes ?? '' } }))
  }

  function autoCalculateResult(): string {
    const criticals = params.filter(p => p.is_critical)
    const anyCriticalFailed = criticals.some(p => results[p.id]?.result === 'Fail')
    if (anyCriticalFailed) return 'Fail'
    const allCriticalPassed = criticals.every(p => ['Pass','N/A'].includes(results[p.id]?.result ?? ''))
    const anyNonCriticalFailed = params.filter(p => !p.is_critical).some(p => results[p.id]?.result === 'Fail')
    if (allCriticalPassed && anyNonCriticalFailed) return 'Pass with Conditions'
    const allDone = params.length > 0 && params.every(p => ['Pass','Fail','N/A'].includes(results[p.id]?.result ?? ''))
    if (allDone && !anyCriticalFailed && !anyNonCriticalFailed) return 'Pass'
    return 'Pending'
  }

  async function save(submit: boolean) {
    setSaving(true)
    const wo = form.work_order_id ? woMap[form.work_order_id] : null
    const prod = form.product_id ? prodMap[form.product_id] : null
    const autoResult = submit ? autoCalculateResult() : form.overall_result
    const finalResult = submit ? (form.overall_result !== 'Pending' ? form.overall_result : autoResult) : form.overall_result

    const payload = {
      work_order_id: form.work_order_id || null,
      order_id: null,
      product_id: form.product_id || null,
      inspector_email: form.inspector_email || null,
      sku: prod?.sku ?? wo?.product_id ? prodMap[wo!.product_id!]?.sku ?? null : null,
      product_name: prod?.name ?? null,
      batch_number: form.batch_number || null,
      qty_inspected: parseFloat(form.qty_inspected) || 0,
      qty_passed: parseFloat(form.qty_passed) || 0,
      qty_failed: parseFloat(form.qty_failed) || 0,
      qty_rework: parseFloat(form.qty_rework) || 0,
      overall_result: finalResult,
      inspection_type: form.inspection_type,
      inspection_date: form.inspection_date || null,
      notes: form.notes || null,
      failure_notes: form.failure_notes || null,
      corrective_action: form.corrective_action || null,
      completed_at: submit && finalResult !== 'Pending' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    let inspectionId = editing?.id
    if (editing) {
      const { error } = await sb.from('qc_inspections').update(payload).eq('id', editing.id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
    } else {
      const { data, error } = await sb.from('qc_inspections').insert(payload).select('id').single()
      if (error || !data) { toast(error?.message ?? 'Insert failed', 'error'); setSaving(false); return }
      inspectionId = (data as any).id
    }

    if (inspectionId && Object.keys(results).length > 0) {
      const resultRows = Object.values(results).map(r => ({
        inspection_id: inspectionId,
        parameter_id: r.parameter_id,
        result: r.result,
        measured_value: r.measured_value || null,
        notes: r.notes || null,
        checked_by: userEmail || null,
        checked_at: new Date().toISOString(),
      }))
      await sb.from('qc_results').delete().eq('inspection_id', inspectionId!)
      await sb.from('qc_results').insert(resultRows)
    }

    if (submit && form.work_order_id && finalResult === 'Pass') {
      await sb.from('work_orders').update({ status: 'QC Passed', updated_at: new Date().toISOString() }).eq('id', form.work_order_id)
    } else if (submit && form.work_order_id && finalResult === 'Fail') {
      await sb.from('work_orders').update({ status: 'QC Failed', updated_at: new Date().toISOString() }).eq('id', form.work_order_id)
    } else if (submit && form.work_order_id && finalResult === 'Rework Required') {
      await sb.from('work_orders').update({ status: 'Rework Required', updated_at: new Date().toISOString() }).eq('id', form.work_order_id)
    }

    toast(submit ? `Inspection ${finalResult === 'Pass' ? 'passed' : finalResult === 'Fail' ? 'failed' : 'submitted'}` : 'Draft saved', submit && finalResult === 'Fail' ? 'error' : 'success')
    setSaving(false)
    close()
    load()
  }

  const visibleParams = params.filter(p => p.is_global || (form.product_id && p.product_id === form.product_id))
  const criticalParams = visibleParams.filter(p => p.is_critical)
  const nonCriticalParams = visibleParams.filter(p => !p.is_critical)
  const checkedCount = visibleParams.filter(p => results[p.id]?.result && results[p.id].result !== 'Pending').length

  if (!tableExists) {
    return (
      <div className="p-8 max-w-2xl">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">OPERATIONS</span>
        <h1 className="text-2xl font-bold text-[#1A1D2E] mt-2 mb-6">Quality Control</h1>
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-8 text-center">
          <div className="w-14 h-14 bg-amber-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-[#1A1D2E] font-semibold text-lg mb-2">QC Tables Not Found</h2>
          <p className="text-[#9898A8] text-sm mb-6 max-w-md mx-auto">The Quality Control database tables need to be created. Run the QC schema SQL in your Supabase SQL editor to enable this module.</p>
          <div className="bg-[#F5F6FA] border border-[#E4E6EE] rounded-xl p-4 text-left text-xs font-mono text-[#00C896] overflow-x-auto">
            {`CREATE TABLE IF NOT EXISTS qc_inspections (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  work_order_id uuid REFERENCES work_orders(id),\n  product_id uuid REFERENCES products(id),\n  inspector_email text,\n  sku text, product_name text, batch_number text,\n  qty_inspected numeric DEFAULT 0,\n  qty_passed numeric DEFAULT 0,\n  qty_failed numeric DEFAULT 0,\n  qty_rework numeric DEFAULT 0,\n  overall_result text DEFAULT 'Pending',\n  inspection_date date DEFAULT CURRENT_DATE,\n  inspection_type text DEFAULT 'Final',\n  notes text, failure_notes text, corrective_action text,\n  created_at timestamptz DEFAULT now(),\n  updated_at timestamptz DEFAULT now(),\n  completed_at timestamptz\n);\n-- See full schema in CLAUDE.md`}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 md:p-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">OPERATIONS</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5 tracking-tight">Quality Control</h1>
          <p className="text-[#5A5A6A] text-sm mt-0.5">{loading ? 'Loading…' : `${filtered.length} inspection${filtered.length !== 1 ? 's' : ''}`}</p>
        </div>
        <button onClick={openAdd} className="bg-[#00C896] hover:bg-[#00B085] text-black font-semibold text-sm px-5 py-2.5 rounded-xl transition-all flex items-center gap-2 self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Inspection
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Inspections Today', value: fmt(stats.today), color: 'text-[#1A1D2E]', bg: 'bg-white' },
          { label: 'Pass Rate', value: `${stats.passRate}%`, color: stats.passRate >= 90 ? 'text-[#00C896]' : stats.passRate >= 70 ? 'text-amber-400' : 'text-red-400', bg: 'bg-white' },
          { label: 'Pending Review', value: fmt(stats.pending), color: stats.pending > 0 ? 'text-amber-400' : 'text-[#1A1D2E]', bg: 'bg-white' },
          { label: 'Failed This Week', value: fmt(stats.failed), color: stats.failed > 0 ? 'text-red-400' : 'text-[#1A1D2E]', bg: 'bg-white' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border border-[#E4E6EE] rounded-2xl p-4`}>
            <p className={`text-2xl font-bold ${s.color}`}>{loading ? '—' : s.value}</p>
            <p className="text-[#5A5A6A] text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-white border border-[#E4E6EE] rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t ? 'bg-[#2A2A35] text-white' : 'text-[#5A5A6A] hover:text-[#9898A8]'}`}
          >
            {t} {t !== 'All' && rows.filter(r => r.overall_result === t).length > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${tab === t ? 'bg-[#3A3A45]' : 'bg-[#2A2A35]'}`}>
                {rows.filter(r => r.overall_result === t).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5A5A6A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          placeholder="Search by SKU, product, batch…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#00C896] transition-all"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
        {loading
          ? <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
          : filtered.length === 0
            ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-14 h-14 bg-[#1E1E24] rounded-2xl flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-[#3A3A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                </div>
                <p className="text-[#1A1D2E] font-medium mb-1">No inspections</p>
                <p className="text-[#5A5A6A] text-sm">Create a new QC inspection to get started</p>
              </div>
            )
            : (
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-[#E4E6EE]">
                    {['Work Order','SKU / Product','Batch','Inspector','Date','Type','Qty','Result','Actions'].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const wo = r.work_order_id ? woMap[r.work_order_id] : null
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-[#E4E6EE]/60 last:border-0 hover:bg-[#F5F6FA] transition-colors cursor-pointer ${i % 2 === 1 ? 'bg-[#F5F6FA]/30' : ''}`}
                        onClick={() => openEdit(r)}
                      >
                        <td className="px-4 py-3.5 text-[#1A1D2E] font-mono text-xs">{wo?.wo_number ?? '—'}</td>
                        <td className="px-4 py-3.5">
                          <p className="text-[#00C896] font-mono text-xs">{r.sku ?? '—'}</p>
                          <p className="text-[#9898A8] text-xs mt-0.5 truncate max-w-[140px]">{r.product_name ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3.5 text-[#9898A8] text-xs font-mono">{r.batch_number ?? '—'}</td>
                        <td className="px-4 py-3.5 text-[#9898A8] text-xs">{r.inspector_email ? r.inspector_email.split('@')[0] : '—'}</td>
                        <td className="px-4 py-3.5 text-[#9898A8] text-xs">{r.inspection_date ? new Date(r.inspection_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</td>
                        <td className="px-4 py-3.5 text-[#9898A8] text-xs">{r.inspection_type}</td>
                        <td className="px-4 py-3.5">
                          <p className="text-[#1A1D2E] text-xs">{r.qty_inspected} insp.</p>
                          <p className="text-[#5A5A6A] text-[10px]">{r.qty_passed} pass / {r.qty_failed} fail</p>
                        </td>
                        <td className="px-4 py-3.5"><ResultBadge result={r.overall_result} /></td>
                        <td className="px-4 py-3.5">
                          <button
                            onClick={e => { e.stopPropagation(); openEdit(r) }}
                            className="text-xs text-[#00C896] hover:text-[#00B085] font-medium border border-[#00C89630] px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
        }
      </div>

      {/* Backdrop */}
      <div className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close} />

      {/* Slide-out panel */}
      <div ref={panelRef} onClick={e => e.stopPropagation()} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[720px] bg-white border-l border-[#E4E6EE] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0">
          <div>
            <h2 className="text-[#1A1D2E] font-semibold">{editing ? 'QC Inspection' : 'New QC Inspection'}</h2>
            {editing && <p className="text-[#5A5A6A] text-xs mt-0.5">{editing.sku} — {editing.product_name}</p>}
          </div>
          <button onClick={close} className="p-2 rounded-xl text-[#6B7280] hover:text-[#1A1D2E] hover:bg-[#F5F6FA] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Basic Info */}
          <section>
            <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Inspection Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-[#9898A8] mb-1.5">Work Order</label>
                <select value={form.work_order_id} onChange={e => {
                  const wo = woMap[e.target.value]
                  setForm(p => ({ ...p, work_order_id: e.target.value, product_id: wo?.product_id ?? p.product_id }))
                }} className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] w-full focus:outline-none focus:border-[#3B6FE0] transition-all">
                  <option value="">— None —</option>
                  {workOrders.map(w => <option key={w.id} value={w.id}>{w.wo_number} ({w.status})</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-[#9898A8] mb-1.5">Product</label>
                <select value={form.product_id} onChange={e => setForm(p => ({ ...p, product_id: e.target.value }))} className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] w-full focus:outline-none focus:border-[#3B6FE0] transition-all">
                  <option value="">— None —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.sku ? `[${p.sku}] ` : ''}{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#9898A8] mb-1.5">Inspector</label>
                <select value={form.inspector_email} onChange={e => setForm(p => ({ ...p, inspector_email: e.target.value }))} className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] w-full focus:outline-none focus:border-[#3B6FE0] transition-all">
                  <option value="">— Select —</option>
                  {users.map(u => <option key={u.email} value={u.email}>{u.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#9898A8] mb-1.5">Batch Number</label>
                <input value={form.batch_number} onChange={e => setForm(p => ({ ...p, batch_number: e.target.value }))} className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] w-full focus:outline-none focus:border-[#3B6FE0] transition-all" />
              </div>
              <div>
                <label className="block text-xs text-[#9898A8] mb-1.5">Inspection Date</label>
                <input type="date" value={form.inspection_date} onChange={e => setForm(p => ({ ...p, inspection_date: e.target.value }))} className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] w-full focus:outline-none focus:border-[#3B6FE0] transition-all" />
              </div>
              <div>
                <label className="block text-xs text-[#9898A8] mb-1.5">Type</label>
                <select value={form.inspection_type} onChange={e => setForm(p => ({ ...p, inspection_type: e.target.value }))} className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] w-full focus:outline-none focus:border-[#3B6FE0] transition-all">
                  {INS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Quantities */}
          <section>
            <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Quantities</h3>
            <div className="grid grid-cols-4 gap-3">
              {[
                { key: 'qty_inspected', label: 'Inspected' },
                { key: 'qty_passed', label: 'Passed' },
                { key: 'qty_failed', label: 'Failed' },
                { key: 'qty_rework', label: 'Rework' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-[#9898A8] mb-1.5">{label}</label>
                  <input
                    type="number"
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    className="bg-white border border-[#E4E6EE] rounded-xl px-3 py-2.5 text-sm text-[#1A1D2E] w-full focus:outline-none focus:border-[#3B6FE0] transition-all text-center font-mono"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Parameters Checklist */}
          {visibleParams.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider">Parameters</h3>
                <span className="text-xs text-[#5A5A6A]">{checkedCount}/{visibleParams.length} checked</span>
              </div>
              <div className="w-full bg-[#1E1E24] rounded-full h-1.5 mb-4">
                <div className="bg-[#00C896] h-1.5 rounded-full transition-all" style={{ width: `${visibleParams.length > 0 ? (checkedCount / visibleParams.length) * 100 : 0}%` }} />
              </div>

              {criticalParams.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Critical Parameters</span>
                  </div>
                  <div className="space-y-2">
                    {criticalParams.map(p => (
                      <ParamRow key={p.id} param={p} result={results[p.id]} onChange={(r) => setParamResult(p.id, r)} onMeasure={(v) => setResults(prev => ({ ...prev, [p.id]: { ...prev[p.id], parameter_id: p.id, result: prev[p.id]?.result ?? 'Pending', measured_value: v, notes: prev[p.id]?.notes ?? '' } }))} />
                    ))}
                  </div>
                </div>
              )}

              {nonCriticalParams.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-[#5A5A6A]" />
                    <span className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider">Standard Parameters</span>
                  </div>
                  <div className="space-y-2">
                    {nonCriticalParams.map(p => (
                      <ParamRow key={p.id} param={p} result={results[p.id]} onChange={(r) => setParamResult(p.id, r)} onMeasure={(v) => setResults(prev => ({ ...prev, [p.id]: { ...prev[p.id], parameter_id: p.id, result: prev[p.id]?.result ?? 'Pending', measured_value: v, notes: prev[p.id]?.notes ?? '' } }))} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Overall Result */}
          <section>
            <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Overall Result</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(RESULT_CFG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setForm(p => ({ ...p, overall_result: key }))}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${form.overall_result === key ? cfg.cls + ' ring-2 ring-offset-1 ring-offset-white ring-current' : 'bg-[#F5F6FA] border-[#E4E6EE] text-[#6B7280] hover:text-[#1A1D2E]'}`}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </section>

          {/* Notes */}
          <section>
            <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Notes</h3>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="General inspection notes…"
              rows={2}
              className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] w-full focus:outline-none focus:border-[#3B6FE0] transition-all resize-none"
            />
            {(form.overall_result === 'Fail' || form.overall_result === 'Rework Required') && (
              <>
                <textarea
                  value={form.failure_notes}
                  onChange={e => setForm(p => ({ ...p, failure_notes: e.target.value }))}
                  placeholder="Failure description (required for Fail/Rework)…"
                  rows={2}
                  className="mt-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] placeholder-red-400/50 w-full focus:outline-none focus:border-red-500/50 transition-all resize-none"
                />
                <textarea
                  value={form.corrective_action}
                  onChange={e => setForm(p => ({ ...p, corrective_action: e.target.value }))}
                  placeholder="Corrective action required…"
                  rows={2}
                  className="mt-2 bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] w-full focus:outline-none focus:border-[#3B6FE0] transition-all resize-none"
                />
              </>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] flex gap-3">
          <button onClick={close} className="flex-1 bg-white hover:bg-[#F5F6FA] border border-[#E4E6EE] text-[#1A1D2E] text-sm px-4 py-2.5 rounded-xl transition-all">
            Cancel
          </button>
          <button onClick={() => save(false)} disabled={saving} className="px-5 py-2.5 rounded-xl border border-[#E4E6EE] text-[#9898A8] hover:text-[#1A1D2E] text-sm transition-all disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button onClick={() => save(true)} disabled={saving} className="flex-1 bg-[#00C896] hover:bg-[#00B085] text-black font-semibold text-sm px-5 py-2.5 rounded-xl transition-all disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit Inspection'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ParamRowProps { param: QCParam; result?: QCResult; onChange: (r: string) => void; onMeasure: (v: string) => void }
function ParamRow({ param, result, onChange, onMeasure }: ParamRowProps) {
  const r = result?.result ?? 'Pending'
  return (
    <div className={`bg-[#F5F6FA] border rounded-xl p-3 transition-all ${r === 'Pass' ? 'border-[#00C89630]' : r === 'Fail' ? 'border-red-500/30' : r === 'N/A' ? 'border-[#3A3A45]' : 'border-[#E4E6EE]'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#1A1D2E] text-xs font-medium">{param.parameter_name}</span>
            {param.parameter_code && <span className="text-[#5A5A6A] font-mono text-[10px]">{param.parameter_code}</span>}
            {param.is_critical && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">CRITICAL</span>}
          </div>
          {param.description && <p className="text-[#5A5A6A] text-[11px] mt-0.5 leading-relaxed">{param.description}</p>}
          {param.measurement_type !== 'pass_fail' && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                placeholder={`Measured value${param.unit ? ` (${param.unit})` : ''}`}
                value={result?.measured_value ?? ''}
                onChange={e => onMeasure(e.target.value)}
                className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-1.5 text-xs text-[#1A1D2E] placeholder-[#9CA3AF] w-36 focus:outline-none focus:border-[#00C896] transition-all"
              />
              {param.unit && <span className="text-[#5A5A6A] text-xs">{param.unit}</span>}
              {(param.min_value != null || param.max_value != null) && (
                <span className="text-[#5A5A6A] text-[10px]">Range: {param.min_value ?? '—'} – {param.max_value ?? '—'}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          {(['Pass','Fail','N/A'] as const).map(v => (
            <button
              key={v}
              onClick={() => onChange(v)}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-all border ${
                r === v
                  ? v === 'Pass' ? 'bg-[#00C89620] text-[#00C896] border-[#00C89640]'
                  : v === 'Fail' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                  : 'bg-[#2A2A35] text-[#9898A8] border-[#3A3A45]'
                  : 'bg-transparent text-[#5A5A6A] border-[#E4E6EE] hover:text-gray-700 hover:border-gray-400'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
