'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { getFileUrl } from '@/lib/fileHelpers'
import Comments from '@/components/Comments'

const GROUPS = [
  { key: 'topics', title: 'Current Employees', color: '#00c875' },
  { key: 'group_title', title: 'Past Employees', color: '#9d50dd' },
]

const STATUS_COLORS: Record<string, string> = {
  'Active': '#00c875', 'Past': '#9d50dd', 'Maternity/paternity leave': '#fdab3d',
}
const SITE_COLORS: Record<string, string> = {
  'bG - Wakeham': '#fdab3d', 'bG - Dietrich': '#037f4c', 'Remote': '#ff007f',
}
const DEPT_COLORS: Record<string, string> = {
  'Sales': '#66ccff', 'Marketing': '#784bd1', 'Business Development': '#4eccc6', 'HR': '#ff5ac4',
  'IT': '#00c875', 'Customer Support': '#cd9282', 'Manufacturing': '#579bfc',
  'Shipping/Receiving': '#cab641', 'Accounting': '#ffcb00', 'Warehouse Operations': '#333333',
  'Admin': '#7e3b8a', 'Legal': '#401694',
}
const SEN_COLORS: Record<string, string> = {
  'Executive': '#00c875', 'Manager': '#784bd1', 'Team Lead': '#9d50dd',
  'Mid-level': '#cab641', 'Contract': '#007eb5', 'NA': '#ffcb00',
}
const GENDER_COLORS: Record<string, string> = { 'Male': '#579bfc', 'Female': '#00c875', 'Diverse': '#74afcc' }

const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const avatarColor = (name: string) => {
  const palette = ['#5559df', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#037f4c', '#ff6d3b', '#bb3354', '#00a89b', '#7e3b8a']
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export default function EmployeeDirectoryPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<any | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [view, setView] = useState<'table' | 'cards'>('cards')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: e }, { data: cm }] = await Promise.all([
      sb.from('employees').select('*').order('position', { nullsFirst: false }),
      sb.from('comments').select('record_id').eq('record_type', 'employee'),
    ])
    setRows(e || [])
    const counts: Record<string, number> = {}
    ;(cm || []).forEach((c: any) => { counts[c.record_id] = (counts[c.record_id] || 0) + 1 })
    setCommentCounts(counts)
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const match = (r: any) => {
    if (!q) return true
    const s = q.toLowerCase()
    return ['name', 'email', 'phone', 'department', 'job_description', 'site', 'seniority', 'manager_name', 'location'].some(k => String(r[k] ?? '').toLowerCase().includes(s))
  }
  const groupRows = (key: string) => rows.filter(r => r.group_key === key && match(r))
  const filesOf = (r: any) => ((r.files || []) as any[])

  async function openFile(f: any) {
    const url = await getFileUrl(sb, f.path)
    if (url) window.open(url, '_blank'); else alert('Could not open the file.')
  }

  const total = rows.length
  const detailFiles = detail ? filesOf(detail) : []

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-blue">👥 Human Resources</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">bG Employee Directory</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${total} employees`}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-white border border-[#E4E6EE] rounded-lg p-1">
            <button onClick={() => setView('cards')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${view === 'cards' ? 'bg-[#3B6FE0] text-white' : 'text-gray-500 hover:text-gray-700'}`}>Cards</button>
            <button onClick={() => setView('table')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${view === 'table' ? 'bg-[#3B6FE0] text-white' : 'text-gray-500 hover:text-gray-700'}`}>Table</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, dept, role…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
        </div>
      </div>

      <div className="space-y-4">
        {GROUPS.map(group => {
          const gr = groupRows(group.key)
          const isCol = collapsed[group.key]
          return (
            <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
              <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
              </div>
              {!isCol && view === 'cards' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
                  {gr.map(r => {
                    const nc = commentCounts[r.id] || 0
                    const nf = (r.files?.length || 0)
                    return (
                      <div key={r.id} onClick={() => setDetail(r)} className="rounded-xl border border-[#E4E6EE] bg-white p-4 hover:border-transparent hover:shadow-lg transition-all cursor-pointer group">
                        <div className="flex items-start gap-3">
                          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[#1A1D2E] text-sm truncate group-hover:text-[#3B6FE0] transition-colors">{r.name}</p>
                            <p className="text-xs text-gray-500 truncate">{r.job_description || r.department || '—'}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {r.status && <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: statusColor(r.status) }}>{r.status}</span>}
                          {r.site && <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: SITE_COLORS[r.site] || '#c4c4c4' }}>{r.site}</span>}
                          {r.department && <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: DEPT_COLORS[r.department] || '#c4c4c4' }}>{r.department}</span>}
                        </div>
                        <div className="mt-2.5 pt-2.5 border-t border-[#F0F2F6] space-y-1 text-xs text-gray-500">
                          {r.email && <div className="flex items-center gap-1.5"><i className="ti ti-mail text-gray-400 shrink-0" /><span className="truncate">{r.email}</span></div>}
                          {r.phone && <div className="flex items-center gap-1.5"><i className="ti ti-phone text-gray-400 shrink-0" /><span>{r.phone}</span></div>}
                          {r.start_date && <div className="flex items-center gap-1.5"><i className="ti ti-calendar text-gray-400 shrink-0" /><span>Started {fmtDate(r.start_date)}</span></div>}
                        </div>
                        {(nc > 0 || nf > 0) && (
                          <div className="mt-2.5 flex items-center gap-3 text-[11px] text-gray-400">
                            {nf > 0 && <span className="flex items-center gap-1"><i className="ti ti-paperclip" />{nf}</span>}
                            {nc > 0 && <span className="flex items-center gap-1 text-emerald-600 font-semibold"><i className="ti ti-message-circle" />{nc}</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {gr.length === 0 && <div className="col-span-full px-4 py-8 text-center text-gray-400 text-sm">No employees</div>}
                </div>
              )}
              {!isCol && view === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[1100px]">
                    <thead>
                      <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                        <th className="text-left px-4 py-2 font-semibold">Name</th>
                        <th className="text-left px-3 py-2 font-semibold w-[140px]">Site</th>
                        <th className="text-left px-3 py-2 font-semibold w-[160px]">Department</th>
                        <th className="text-left px-3 py-2 font-semibold w-[150px]">Job</th>
                        <th className="text-left px-3 py-2 font-semibold w-[120px]">Seniority</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">Start</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">Status</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[80px]">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const nc = commentCounts[r.id] || 0
                        const nf = (r.files?.length || 0)
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => setDetail(r)}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-bold" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-[#1A1D2E] truncate">{r.name}</p>
                                  {r.email && <p className="text-[11px] text-gray-400 truncate">{r.email}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">{r.site ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: SITE_COLORS[r.site] || '#c4c4c4' }}>{r.site}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{r.department ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: DEPT_COLORS[r.department] || '#c4c4c4' }}>{r.department}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.job_description || '—'}</td>
                            <td className="px-3 py-2.5">{r.seniority ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: SEN_COLORS[r.seniority] || '#c4c4c4' }}>{r.seniority}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.start_date) || '—'}</td>
                            <td className="px-3 py-2.5">{r.status ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: statusColor(r.status) }}>{r.status}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nf ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nf}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400 text-sm">No employees</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={() => setDetail(null)}>
          <div className="relative w-full max-w-[820px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-5 text-white" style={{ background: avatarColor(detail.name) }}>
              <div className="min-w-0 flex items-start gap-4">
                <div className="w-16 h-16 rounded-full flex items-center justify-center shrink-0 text-white text-xl font-bold bg-white/20 border-2 border-white/40">{initials(detail.name)}</div>
                <div className="min-w-0">
                  <p className="text-white/70 text-xs uppercase tracking-wide">{detail.group_title}</p>
                  <h2 className="text-xl font-bold leading-tight">{detail.name}</h2>
                  <p className="text-white/80 text-sm mt-0.5">{detail.job_description || detail.department || ''}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {detail.status && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.status}</span>}
                    {detail.site && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.site}</span>}
                    {detail.seniority && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.seniority}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <Field label="Email" value={detail.email} />
                <Field label="Phone" value={detail.phone} />
                <Field label="Department" value={detail.department} />
                <Field label="Job Description" value={detail.job_description} />
                <Field label="Seniority" value={detail.seniority} />
                <Field label="Manager" value={detail.manager_name} />
                <Field label="Site" value={detail.site} />
                <Field label="Gender" value={detail.gender} />
                <Field label="Start Date" value={fmtDate(detail.start_date)} />
                <Field label="End Date" value={fmtDate(detail.end_date)} />
                <Field label="Birthday" value={fmtDate(detail.birthday)} />
                <Field label="Location" value={detail.location} wide />
              </div>

              {detailFiles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Files ({detailFiles.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {detailFiles.map((f: any, idx: number) => (
                      <button key={idx} onClick={() => openFile(f)} className="flex items-center gap-2 text-xs bg-[#F5F7FB] border border-[#E4E6EE] rounded-lg px-3 py-2 hover:bg-[#EAF0FC] text-left">
                        <span className="text-[#3B6FE0]">📄</span>
                        <span className="font-semibold text-gray-700 truncate max-w-[240px]">{f.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="employee" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, wide }: { label: string; value: any; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : ''}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 mt-0.5">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  )
}
