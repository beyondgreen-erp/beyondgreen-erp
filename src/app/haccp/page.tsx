'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

type Field = { key: string; label: string; type?: string; options?: string[] }
const PLATFORMS = ['Shopify', 'AMAZON', 'Chewy', 'Private Label', 'faire.com', 'B2B', 'Dropship']
const COMPLAINT_STATUS = ['Open', 'Investigating', 'Resolved', 'Closed']
const CAPA_STATUS = ['Open', 'In Progress', 'Verified', 'Closed']
const CAPA_SOURCE = ['Customer Complaint', 'Internal Audit', 'NCR', 'Manual']

const COMPLAINT_FIELDS: Field[] = [
  { key: 'title', label: 'Title / Product Line' },
  { key: 'complaint_number', label: 'Complaint #' },
  { key: 'product', label: 'Product / SKU' },
  { key: 'platform', label: 'Platform', type: 'select', options: PLATFORMS },
  { key: 'complaint_received_date', label: 'Received Date', type: 'date' },
  { key: 'customer_email', label: 'Customer Email' },
  { key: 'status', label: 'Status', type: 'select', options: COMPLAINT_STATUS },
  { key: 'complaint', label: 'Complaint', type: 'area' },
  { key: 'resolution', label: 'Resolution', type: 'area' },
]
const CAPA_FIELDS: Field[] = [
  { key: 'capa_number', label: 'CAPA #' },
  { key: 'capa_date', label: 'Date', type: 'date' },
  { key: 'source', label: 'Source', type: 'select', options: CAPA_SOURCE },
  { key: 'department', label: 'Department' },
  { key: 'responsible_person', label: 'Responsible Person' },
  { key: 'status', label: 'Status', type: 'select', options: CAPA_STATUS },
  { key: 'description', label: 'Non-Conformance / Problem', type: 'area' },
  { key: 'immediate_correction', label: 'Immediate Correction', type: 'area' },
  { key: 'why1', label: '5 Whys - Why 1?' },
  { key: 'why2', label: 'Why 2?' },
  { key: 'why3', label: 'Why 3?' },
  { key: 'why4', label: 'Why 4?' },
  { key: 'why5', label: 'Why 5? (root cause)' },
  { key: 'root_cause', label: 'Root Cause', type: 'area' },
  { key: 'corrective_action', label: 'Corrective Action', type: 'area' },
  { key: 'corrective_target_date', label: 'Corrective Target Date', type: 'date' },
  { key: 'corrective_effective', label: 'Corrective Effective?', type: 'bool' },
  { key: 'preventive_action', label: 'Preventive Action', type: 'area' },
  { key: 'preventive_target_date', label: 'Preventive Target Date', type: 'date' },
  { key: 'preventive_effective', label: 'Preventive Effective?', type: 'bool' },
  { key: 'verified_by', label: 'Verified By' },
  { key: 'verified_date', label: 'Verified Date', type: 'date' },
  { key: 'evidence', label: 'Evidence', type: 'area' },
]

function fmt(v: any) { if (v === true) return 'Yes'; if (v === false) return 'No'; if (v == null || v === '') return '-'; return String(v) }

export default function HaccpPage() {
  const [board, setBoard] = useState('complaints')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any>(null)
  const [isNew, setIsNew] = useState(false)
  const [ai, setAi] = useState(false)
  const [aiText, setAiText] = useState('')
  const [busy, setBusy] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const fields = board === 'capa' ? CAPA_FIELDS : COMPLAINT_FIELDS

  useEffect(() => { sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) }) }, [sb])
  useEffect(() => { load() }, [board])
  useEffect(() => { const p = new URLSearchParams(window.location.search); const b = p.get('board'); if (b === 'complaints' || b === 'capa') setBoard(b) }, [])
  useEffect(() => { const p = new URLSearchParams(window.location.search); const id = p.get('item'); if (id && rows.length) { const f = rows.find((x) => String(x.id) === id); if (f) { openEdit(f); window.history.replaceState({}, '', '/haccp') } } }, [rows])

  async function load() {
    setLoading(true)
    try { const r = await fetch('/api/haccp?board=' + board); const j = await r.json(); setRows(j.rows || []) } catch (e) {}
    setLoading(false)
  }
  function openAdd() { setEditing({}); setIsNew(true) }
  function openEdit(row: any) { setEditing({ ...row }); setIsNew(false) }
  async function uploadAttachment(e: any) {
    const files = e.target.files; if (!files || !files.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files) as any[]) {
        const dataBase64: string = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1]); rd.readAsDataURL(file); });
        const r = await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', board, id: (editing && editing.id) || '', file: { name: file.name, contentType: file.type, dataBase64 } }) });
        const j = await r.json();
        if (j.ok) { setEditing((prev: any) => ({ ...prev, attachments: [ ...((prev && prev.attachments) || []), { url: j.url, name: j.name, contentType: j.contentType } ] })); } else { alert(j.error || 'Upload failed'); }
      }
    } catch (err: any) { alert((err && err.message) || 'Upload failed'); }
    setBusy(false); e.target.value = '';
  }
  function removeAttachment(idx: number) {
    setEditing((prev: any) => ({ ...prev, attachments: (((prev && prev.attachments) || []).filter((_: any, i: number) => i !== idx)) }));
  }
  async function save() {
    setBusy(true)
    try {
      const r = await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: isNew ? 'create' : 'update', board, id: editing.id, data: editing, created_by: userEmail }) })
      const j = await r.json()
      if (j.ok) { setEditing(null); await load() } else { alert(j.error || 'Save failed') }
    } catch (e: any) { alert(e?.message || 'Save failed') }
    setBusy(false)
  }
  async function remove(row: any) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', board, id: row.id }) })
    await load()
  }
  async function runAi() {
    if (!aiText.trim()) return
    setBusy(true)
    try {
      const r = await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ai_quick_add', board, text: aiText, created_by: userEmail }) })
      const j = await r.json()
      if (j.ok) { setAi(false); setAiText(''); await load() } else { alert(j.error || 'AI add failed') }
    } catch (e: any) { alert(e?.message || 'AI add failed') }
    setBusy(false)
  }

  const cols: string[][] = board === 'capa'
    ? [['capa_number', 'CAPA #'], ['source', 'Source'], ['description', 'Problem'], ['corrective_action', 'Corrective Action'], ['status', 'Status'], ['capa_date', 'Date'], ['capa_file_url', 'File']]
    : [['complaint_number', 'Complaint #'], ['title', 'Title'], ['product', 'Product'], ['platform', 'Platform'], ['complaint', 'Complaint'], ['status', 'Status'], ['complaint_received_date', 'Date']]

  return (
    <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
      <div className="mb-5">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-700 border-emerald-500/30">HACCP - COMPLIANCE</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Compliance</h1>
        <p className="text-gray-500 text-sm mt-0.5">Customer complaints and the CAPA log. Every customer complaint automatically opens a linked CAPA.</p>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 bg-white border border-[#E4E6EE] rounded-xl p-1">
          <button onClick={() => setBoard('complaints')} className={'px-4 py-2 text-sm font-semibold rounded-lg ' + (board === 'complaints' ? 'bg-[#1A1D2E] text-white' : 'text-gray-600 hover:bg-gray-100')}>Customer Complaints</button>
          <button onClick={() => setBoard('capa')} className={'px-4 py-2 text-sm font-semibold rounded-lg ' + (board === 'capa' ? 'bg-[#1A1D2E] text-white' : 'text-gray-600 hover:bg-gray-100')}>CAPA Log</button>
        </div>
        <button onClick={() => setAi(true)} className="ml-auto text-sm font-semibold px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-700 hover:bg-gray-50">AI Quick Add</button>
        <button onClick={openAdd} className="text-sm font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#1A1D2E' }}>+ Add</button>
      </div>

      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr className="text-xs text-gray-500 border-b border-[#E4E6EE]" style={{ background: '#F9FAFB' }}>{cols.map((c) => <th key={c[0]} className="px-4 py-3 whitespace-nowrap">{c[1]}</th>)}<th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={cols.length + 1} className="px-4 py-8 text-center text-gray-400 text-sm">Loading...</td></tr>
              : rows.length === 0 ? <tr><td colSpan={cols.length + 1} className="px-4 py-8 text-center text-gray-400 text-sm">No entries yet.</td></tr>
                : rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#F1F2F6] hover:bg-[#FAFBFF] align-top">
                    {cols.map((c) => <td key={c[0]} className="px-4 py-3 text-sm text-gray-700">{c[0] === 'capa_file_url' ? (row.capa_file_url ? <span className="flex items-center gap-2 whitespace-nowrap"><a href={row.capa_file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open</a><button onClick={() => { navigator.clipboard.writeText(row.capa_file_url); alert('Link copied'); }} className="text-xs px-2 py-0.5 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50">Copy link</button></span> : <span className="text-gray-300">-</span>) : <div className="line-clamp-3 max-w-xs">{fmt(row[c[0]])}</div>}</td>)}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button onClick={() => { const u = window.location.origin + '/haccp?board=' + board + '&item=' + row.id; navigator.clipboard.writeText(u); alert('Item link copied - share it with the team'); }} className="text-xs font-semibold px-2 py-1 rounded-lg border border-[#E4E6EE] text-[#1A1D2E] mr-1">Copy link</button><button onClick={() => openEdit(row)} className="text-xs font-semibold px-2 py-1 rounded-lg border border-[#E4E6EE] text-gray-700 hover:bg-gray-50">Edit</button>
                      <button onClick={() => remove(row)} className="ml-1 text-xs font-semibold px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Delete</button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={(isNew ? 'Add ' : 'Edit ') + (board === 'capa' ? 'CAPA' : 'Complaint')} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={f.type === 'area' ? 'col-span-2' : ''}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                {f.type === 'area' ? <textarea value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} rows={3} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />
                  : f.type === 'select' ? <select value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE]"><option value=""></option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    : f.type === 'bool' ? <select value={editing[f.key] === true ? 'yes' : editing[f.key] === false ? 'no' : ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null })} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE]"><option value="">-</option><option value="yes">Yes</option><option value="no">No</option></select>
                      : <input type={f.type === 'date' ? 'date' : 'text'} value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />}
              </div>
            ))}
          </div>
          <div className="col-span-2 mt-2">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Attachments (files or images)</label>
            <input type="file" multiple onChange={uploadAttachment} className="block text-xs mb-2" />
            <div className="flex flex-wrap gap-2">
              {(((editing && editing.attachments) || []) as any[]).map((a: any, i: number) => (
                <div key={i} className="border border-[#E4E6EE] rounded-lg p-2 text-xs flex flex-col items-start gap-1" style={{ maxWidth: "160px" }}>
                  {String(a.contentType || "").indexOf("image") === 0 ? <img src={a.url} alt={a.name} style={{ maxWidth: "140px", maxHeight: "90px", objectFit: "cover", borderRadius: "6px" }} /> : <span className="text-gray-600 break-all">{a.name}</span>}
                  <div className="flex gap-2 mt-1">
                    <a href={a.url} target="_blank" className="text-[#1A1D2E] font-semibold">Open</a>
                    <button onClick={() => { navigator.clipboard.writeText(a.url); alert("Link copied"); }} className="text-[#1A1D2E] font-semibold">Copy link</button>
                    <button onClick={() => removeAttachment(i)} className="text-red-500 font-semibold">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditing(null)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600">Cancel</button>
            <button onClick={save} disabled={busy} className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: '#1A1D2E' }}>{busy ? 'Saving...' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {ai && (
        <Modal title={'AI Quick Add - ' + (board === 'capa' ? 'CAPA' : 'Complaint')} onClose={() => setAi(false)}>
          <p className="text-xs text-gray-500 mb-2">Paste an email, note, or complaint below. The AI reads it, pulls out the fields, and adds the entry{board === 'complaints' ? ' (and automatically opens a linked CAPA)' : ''}.</p>
          <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={10} placeholder="Paste text here..." className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setAi(false)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600">Cancel</button>
            <button onClick={runAi} disabled={busy || !aiText.trim()} className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: '#1A1D2E' }}>{busy ? 'Extracting...' : 'Extract & Add'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[#1A1D2E]">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl px-2">X</button>
        </div>
        {children}
      </div>
    </div>
  )
}
