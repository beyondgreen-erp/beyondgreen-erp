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

const STATUSES = ['Active', 'Past', 'Maternity/paternity leave']
const SITES = ['bG - Wakeham', 'bG - Dietrich', 'Remote']
const DEPARTMENTS = ['Sales', 'Marketing', 'Business Development', 'HR', 'IT', 'Customer Support', 'Manufacturing', 'Shipping/Receiving', 'Accounting', 'Warehouse Operations', 'Admin', 'Legal']
const JOB_DESCRIPTIONS = ['Sales', 'Operations', 'IT', 'Marketing', 'Legal', 'Web Development', 'Content Creation', 'Business Development', 'Product Development', 'Vendor Relations', 'Sourcing', 'Shipping / Receiving', 'Production', 'Warehouse', 'Executive', 'Accounting', 'Admin', 'Compliance']
const SENIORITIES = ['Executive', 'Manager', 'Team Lead', 'Mid-level', 'Contract', 'NA']
const GENDERS = ['Male', 'Female', 'Diverse']

const STATUS_COLORS: Record<string, string> = { 'Active': '#00c875', 'Past': '#9d50dd', 'Maternity/paternity leave': '#fdab3d' }
const SITE_COLORS: Record<string, string> = { 'bG - Wakeham': '#fdab3d', 'bG - Dietrich': '#037f4c', 'Remote': '#ff007f' }
const DEPT_COLORS: Record<string, string> = { 'Sales': '#66ccff', 'Marketing': '#784bd1', 'Business Development': '#4eccc6', 'HR': '#ff5ac4', 'IT': '#00c875', 'Customer Support': '#cd9282', 'Manufacturing': '#579bfc', 'Shipping/Receiving': '#cab641', 'Accounting': '#ffcb00', 'Warehouse Operations': '#333333', 'Admin': '#7e3b8a', 'Legal': '#401694' }
const SEN_COLORS: Record<string, string> = { 'Executive': '#00c875', 'Manager': '#784bd1', 'Team Lead': '#9d50dd', 'Mid-level': '#cab641', 'Contract': '#007eb5', 'NA': '#ffcb00' }

const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const initials = (name: string) => (name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const avatarColor = (name: string) => {
  const palette = ['#5559df', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#037f4c', '#ff6d3b', '#bb3354', '#00a89b', '#7e3b8a']
  let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

const emptyForm = {
  name: '', status: 'Active', group_key: 'topics', site: '', department: '', job_description: '',
  seniority: '', gender: '', email: '', phone: '', birthday: '', location: '',
  manager_name: '', employee_person: '', start_date: '', end_date: '',
}
type F = typeof emptyForm

function dbErr(e: { code?: string; message: string; hint?: string }) {
  return [e.message, e.code && `(${e.code})`, e.hint && `Hint: ${e.hint}`].filter(Boolean).join(' — ')
}

export default function EmployeeDirectoryPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  // Total days-off taken per employee, keyed by lower-cased name (for case-insensitive match)
  const [daysOff, setDaysOff] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<any | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<F>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [showHidden, setShowHidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: e }, { data: cm }, { data: to }] = await Promise.all([
      sb.from('employees').select('*').order('position', { nullsFirst: false }),
      sb.from('comments').select('record_id').eq('record_type', 'employee'),
      // Approved time-off requests, aggregated in-app so we don't need a view.
      sb.from('time_off_requests').select('employee_name,days,status').eq('status', 'Approved'),
    ])
    setRows(e || [])
    const counts: Record<string, number> = {}
    ;(cm || []).forEach((c: any) => { counts[c.record_id] = (counts[c.record_id] || 0) + 1 })
    setCommentCounts(counts)
    const dayTotals: Record<string, number> = {}
    ;(to || []).forEach((r: any) => {
      const key = String(r.employee_name || '').trim().toLowerCase()
      if (!key) return
      dayTotals[key] = (dayTotals[key] || 0) + Number(r.days || 0)
    })
    setDaysOff(dayTotals)
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const match = (r: any) => {
    if (!q) return true
    const s = q.toLowerCase()
    return ['name', 'email', 'phone', 'department', 'job_description', 'site', 'seniority', 'manager_name', 'location'].some(k => String(r[k] ?? '').toLowerCase().includes(s))
  }
  const isVisible = (r: any) => showHidden ? r.group_key === '__hidden__' : (r.group_key === 'topics' || r.group_key === 'group_title')
  const groupRows = (key: string) => rows.filter(r => r.group_key === key && match(r))
  const hiddenRows = rows.filter(r => r.group_key === '__hidden__' && match(r))
  const filesOf = (r: any) => ((r.files || []) as any[])

  async function openFile(f: any) {
    const url = await getFileUrl(sb, f.path)
    if (url) window.open(url, '_blank'); else alert('Could not open the file.')
  }

  function openAdd() {
    setDetail(null); setEditing(true); setErr(''); setForm(emptyForm)
  }
  function openEdit(r: any) {
    setDetail(r); setEditing(false); setErr('')
    setForm({
      name: r.name || '', status: r.status || 'Active',
      group_key: r.group_key === '__hidden__' ? 'topics' : (r.group_key || 'topics'),
      site: r.site || '', department: r.department || '', job_description: r.job_description || '',
      seniority: r.seniority || '', gender: r.gender || '',
      email: r.email || '', phone: r.phone || '',
      birthday: r.birthday || '', location: r.location || '',
      manager_name: r.manager_name || '', employee_person: r.employee_person || '',
      start_date: r.start_date || '', end_date: r.end_date || '',
    })
  }
  function close() { setDetail(null); setEditing(false); setForm(emptyForm); setErr('') }

  async function save() {
    if (!form.name.trim()) { setErr('Name is required.'); return }
    setSaving(true); setErr('')
    const gt = form.group_key === 'topics' ? 'Current Employees' : form.group_key === 'group_title' ? 'Past Employees' : (detail?.group_title || 'Current Employees')
    const p: any = {
      name: form.name.trim(),
      status: form.status || null,
      group_key: form.group_key,
      group_title: gt,
      site: form.site || null,
      department: form.department || null,
      job_description: form.job_description || null,
      seniority: form.seniority || null,
      gender: form.gender || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      birthday: form.birthday || null,
      location: form.location.trim() || null,
      manager_name: form.manager_name.trim() || null,
      employee_person: form.employee_person.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      updated_at: new Date().toISOString(),
    }
    if (detail) {
      const { error } = await sb.from('employees').update(p).eq('id', detail.id)
      if (error) { setErr(dbErr(error)); setSaving(false); return }
    } else {
      p.id = crypto.randomUUID()
      p.position = (rows[rows.length - 1]?.position || rows.length) + 1
      const { error } = await sb.from('employees').insert(p)
      if (error) { setErr(dbErr(error)); setSaving(false); return }
    }
    setSaving(false); close(); load()
  }

  async function toggleHide() {
    if (!detail) return
    setSaving(true)
    const nowHidden = detail.group_key === '__hidden__'
    if (nowHidden) {
      // Restore: parse original group from group_title HIDDEN::orig_key::orig_title
      const m = String(detail.group_title || '').match(/^HIDDEN::([^:]+)::(.+)$/)
      const origKey = m ? m[1] : 'topics'
      const origTitle = m ? m[2] : 'Current Employees'
      await sb.from('employees').update({ group_key: origKey, group_title: origTitle, updated_at: new Date().toISOString() }).eq('id', detail.id)
    } else {
      await sb.from('employees').update({
        group_key: '__hidden__',
        group_title: `HIDDEN::${detail.group_key}::${detail.group_title}`,
        updated_at: new Date().toISOString(),
      }).eq('id', detail.id)
    }
    setSaving(false); close(); load()
  }

  async function handleDelete() {
    if (!detail) return
    if (!confirm(`Permanently delete ${detail.name}? This cannot be undone.`)) return
    setSaving(true)
    const { error } = await sb.from('employees').delete().eq('id', detail.id)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    setSaving(false); close(); load()
  }

  const total = rows.filter(isVisible).length
  const totalHidden = rows.filter(r => r.group_key === '__hidden__').length
  const detailFiles = detail ? filesOf(detail) : []
  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40 focus:border-transparent transition'

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-blue">👥 Human Resources</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">bG Employee Directory</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${total} ${showHidden ? 'hidden' : 'active'} employee${total !== 1 ? 's' : ''}`}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, dept, role…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
          {totalHidden > 0 && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div onClick={() => setShowHidden(v => !v)} className={`w-9 h-5 rounded-full transition-colors relative ${showHidden ? 'bg-[#3B6FE0]' : 'bg-[#F5F6FA] border border-[#E4E6EE]'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showHidden ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-gray-500">Hidden ({totalHidden})</span>
            </label>
          )}
          <button onClick={openAdd} className="flex items-center gap-2 bg-[#3B6FE0] hover:bg-[#2E5CC7] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm">
            <i className="ti ti-plus" /> Add Employee
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {(showHidden ? [{ key: '__hidden__', title: 'Hidden Employees', color: '#6B7280' }] : GROUPS).map(group => {
          const gr = showHidden ? hiddenRows : groupRows(group.key)
          const isCol = collapsed[group.key]
          return (
            <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
              <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
              </div>
              {!isCol && (
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
                        <th className="text-left px-3 py-2 font-semibold w-[130px]">Status</th>
                        <th className="text-right px-3 py-2 font-semibold w-[80px]">Days Off</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[80px]">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const nc = commentCounts[r.id] || 0
                        const nf = (r.files?.length || 0)
                        const ndays = daysOff[String(r.name || '').trim().toLowerCase()] || 0
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openEdit(r)}>
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
                            <td className="px-3 py-2.5 text-gray-600 truncate max-w-[150px]" title={r.job_description || ''}>{r.job_description || '—'}</td>
                            <td className="px-3 py-2.5">{r.seniority ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: SEN_COLORS[r.seniority] || '#c4c4c4' }}>{r.seniority}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(r.start_date) || '—'}</td>
                            <td className="px-3 py-2.5">{r.status ? <span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap" style={{ background: STATUS_COLORS[r.status] || '#c4c4c4' }}>{r.status}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-right">{ndays ? <a href="/hr/time-off" onClick={e => e.stopPropagation()} className="text-[#3B6FE0] text-xs font-semibold hover:underline">{ndays} {ndays === 1 ? 'day' : 'days'}</a> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nf ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nf}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400 text-sm">{q ? 'No matches.' : 'No employees'}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(detail || editing) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={close}>
          <div className="relative w-full max-w-[820px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-5 text-white" style={{ background: avatarColor(form.name || 'New') }}>
              <div className="min-w-0 flex items-start gap-4">
                <div className="w-16 h-16 rounded-full flex items-center justify-center shrink-0 text-white text-xl font-bold bg-white/20 border-2 border-white/40">{initials(form.name || '+')}</div>
                <div className="min-w-0">
                  <p className="text-white/70 text-xs uppercase tracking-wide">{detail ? (detail.group_key === '__hidden__' ? 'Hidden' : detail.group_title) : 'New Employee'}</p>
                  <h2 className="text-xl font-bold leading-tight">{form.name || 'Add Employee'}</h2>
                  {detail && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {detail.status && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.status}</span>}
                      {detail.site && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.site}</span>}
                      {detail.seniority && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.seniority}</span>}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={close} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 max-h-[70vh] overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inp} placeholder="Full name" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Group</label>
                  <select value={form.group_key} onChange={e => setForm({ ...form, group_key: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="topics">Current Employees</option>
                    <option value="group_title">Past Employees</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="">— None —</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Site</label>
                  <select value={form.site} onChange={e => setForm({ ...form, site: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="">— None —</option>
                    {SITES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Department</label>
                  <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="">— None —</option>
                    {DEPARTMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Job Description</label>
                  <select value={form.job_description} onChange={e => setForm({ ...form, job_description: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="">— None —</option>
                    {JOB_DESCRIPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Seniority</label>
                  <select value={form.seniority} onChange={e => setForm({ ...form, seniority: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="">— None —</option>
                    {SENIORITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Gender</label>
                  <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="">— None —</option>
                    {GENDERS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inp} placeholder="name@beyondgreenbiotech.com" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Phone</label>
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={inp} placeholder="Phone number" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={inp} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className={inp} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Birthday</label>
                  <input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} className={inp} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Manager</label>
                  <input value={form.manager_name} onChange={e => setForm({ ...form, manager_name: e.target.value })} className={inp} placeholder="Manager name" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">Location</label>
                  <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className={inp} placeholder="Address, city, state" />
                </div>
              </div>

              {detail && detailFiles.length > 0 && (
                <div className="border-t border-[#EEF0F4] pt-4">
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

              {detail && (
                <div className="border-t border-[#EEF0F4] pt-4">
                  <Comments recordId={detail.id} recordType="employee" currentUserEmail={userEmail} title="Notes & Comments" />
                </div>
              )}
            </div>

            <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
              {err && <div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5"><i className="ti ti-alert-circle text-red-500 mt-0.5 shrink-0" /><p className="text-red-500 text-xs">{err}</p></div>}
              <div className="flex gap-2 justify-between">
                <div className="flex gap-2">
                  {detail && <button onClick={handleDelete} disabled={saving} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50" title="Delete permanently"><i className="ti ti-trash" /></button>}
                  {detail && <button onClick={toggleHide} disabled={saving} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50">{detail.group_key === '__hidden__' ? 'Un-hide' : 'Hide'}</button>}
                </div>
                <div className="flex gap-2">
                  <button onClick={close} className="text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
                  <button onClick={save} disabled={saving} className="bg-[#3B6FE0] hover:bg-[#2E5CC7] disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">{saving ? 'Saving…' : (detail ? 'Save' : 'Add Employee')}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
