'use client'
import { useState, useEffect, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

interface Message {
  id: string; subject: string; from: { emailAddress: { name: string; address: string } }
  bodyPreview: string; receivedDateTime: string; isRead: boolean; conversationId: string
  body?: { content: string; contentType: string }; toRecipients?: Array<{ emailAddress: { address: string } }>
}

export default function InboxPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [connected, setConnected] = useState(false)
  const [accessToken, setAccessToken] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [selected, setSelected] = useState<Message | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [replying, setReplying] = useState(false)
  const [sending, setSending] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [logType, setLogType] = useState('customer')
  const [linkedId, setLinkedId] = useState('')
  const [linkedLabel, setLinkedLabel] = useState('')
  const [logNote, setLogNote] = useState('')
  const [logRecords, setLogRecords] = useState<Array<{ id: string; name: string }>>([])
  const [userId, setUserId] = useState('')
  const [composing, setComposing] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => { if (data.user) setUserId(data.user.id) })
    const saved = sessionStorage.getItem('inbox_token')
    const savedEmail = sessionStorage.getItem('inbox_email')
    if (saved && savedEmail) { setAccessToken(saved); setEmail(savedEmail); setConnected(true); syncInbox(saved) }
  }, [])

  async function connect() {
    setError(''); setLoading(true)
    const res = await fetch('/api/inbox/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error || 'Connection failed'); return }
    setAccessToken(data.accessToken)
    setMessages(data.messages || [])
    setConnected(true)
    sessionStorage.setItem('inbox_token', data.accessToken)
    sessionStorage.setItem('inbox_email', email)
  }

  async function syncInbox(token?: string) {
    setSyncing(true)
    const t = token || accessToken
    const res = await fetch('/api/inbox/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: '__token__', accessToken: t }) })
    const data = await res.json()
    setSyncing(false)
    if (data.messages) setMessages(data.messages)
  }

  async function sendReply() {
    if (!replyBody.trim() || !selected) return
    setSending(true)
    const res = await fetch('/api/inbox/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, to: selected.from.emailAddress.address, subject: 'Re: ' + selected.subject, body: replyBody.replace(/\n/g, '<br>'), replyToId: selected.id })
    })
    setSending(false)
    if (res.ok) { setReplying(false); setReplyBody('') }
  }

  async function sendNew() {
    if (!composeTo || !composeSubject) return
    setSending(true)
    const res = await fetch('/api/inbox/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, to: composeTo, subject: composeSubject, body: composeBody.replace(/\n/g, '<br>') })
    })
    setSending(false)
    if (res.ok) { setComposing(false); setComposeTo(''); setComposeSubject(''); setComposeBody('') }
  }

  async function loadLogRecords(type: string) {
    const tableMap: Record<string, string> = { customer: 'customers', sales_order: 'sales_orders', certification: 'certifications', task: 'tasks', vendor: 'vendors' }
    const labelMap: Record<string, string> = { customer: 'company_name', sales_order: 'order_number', certification: 'name', task: 'name', vendor: 'company_name' }
    const table = tableMap[type]
    const labelCol = labelMap[type]
    if (!table) return
    const { data } = await sb.from(table).select('id,' + labelCol).limit(50)
    setLogRecords((data || []).map((r: Record<string, unknown>) => ({ id: r.id as string, name: r[labelCol] as string })))
  }

  async function logEmail() {
    if (!linkedId || !selected) return
    await fetch('/api/inbox/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, messageId: selected.id, threadId: selected.conversationId, fromEmail: selected.from.emailAddress.address, subject: selected.subject, bodySnippet: selected.bodyPreview, logType, linkedId, linkedLabel, note: logNote })
    })
    setShowLog(false); setLogNote(''); setLinkedId(''); setLinkedLabel('')
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const inp = 'width:100%;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;font-size:13px;outline:none;font-family:inherit;box-sizing:border-box;color:#0F1C2E'

  if (!connected) return (
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 w-full max-w-md shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#3B6FE0] flex items-center justify-center text-white font-bold text-sm">✉</div>
          <div><div className="font-bold text-[#0F1C2E]">Connect Your Inbox</div><div className="text-xs text-[#8A9FC0]">Private to you only — no one else can see your emails</div></div>
        </div>
        {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm mb-4">{error}</div>}
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-bold text-[#5A6E8A] uppercase tracking-wide mb-1">Microsoft 365 Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@beyondgreenbiotech.com" style={{...{}}} className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5A6E8A] uppercase tracking-wide mb-1">App Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Generated from account.microsoft.com/security" className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm outline-none" />
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 mb-5">
          <strong>How to get your App Password:</strong><br/>
          1. Go to <strong>account.microsoft.com/security</strong><br/>
          2. Click &ldquo;Advanced security options&rdquo;<br/>
          3. Under &ldquo;App passwords&rdquo; click Create<br/>
          4. Name it &ldquo;beyondGREEN ERP&rdquo; and copy the password shown
        </div>
        <button onClick={connect} disabled={loading || !email || !password} className="w-full bg-[#3B6FE0] text-white rounded-xl py-3 font-bold text-sm disabled:opacity-50">
          {loading ? 'Connecting...' : 'Connect Inbox'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="h-screen flex flex-col bg-[#F7F8FA]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-[#0F1C2E]">✉ Inbox</span>
          <span className="text-xs text-[#8A9FC0] bg-[#F1F4F9] px-2 py-0.5 rounded-full">{email}</span>
          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">● Private</span>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setComposing(true)} className="px-3 py-1.5 bg-[#3B6FE0] text-white text-xs font-bold rounded-lg">+ Compose</button>
          <button onClick={()=>syncInbox()} disabled={syncing} className="px-3 py-1.5 bg-white border border-[#E2E8F0] text-xs font-semibold rounded-lg text-[#5A6E8A]">{syncing ? '⟳ Syncing...' : '⟳ Refresh'}</button>
          <button onClick={()=>{setConnected(false);sessionStorage.removeItem('inbox_token');sessionStorage.removeItem('inbox_email')}} className="px-3 py-1.5 bg-white border border-[#E2E8F0] text-xs font-semibold rounded-lg text-red-500">Disconnect</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Thread list */}
        <div className="w-80 flex-shrink-0 border-r border-[#E2E8F0] overflow-y-auto bg-white">
          {messages.length === 0 && <p className="text-center text-sm text-[#8A9FC0] py-12">No messages found</p>}
          {messages.map(msg => (
            <div key={msg.id} onClick={()=>setSelected(msg)} className={'px-4 py-3 border-b border-[#F1F4F9] cursor-pointer hover:bg-[#F7F8FA] ' + (selected?.id===msg.id ? 'bg-blue-50 border-l-2 border-l-[#3B6FE0]' : '') + (!msg.isRead ? ' bg-[#FAFBFF]' : '')}>
              <div className="flex justify-between items-start mb-0.5">
                <p className={'text-sm truncate font-' + (!msg.isRead ? 'bold' : 'medium') + ' text-[#0F1C2E]'}>{msg.from?.emailAddress?.name || msg.from?.emailAddress?.address}</p>
                <span className="text-xs text-[#8A9FC0] ml-2 flex-shrink-0">{fmtDate(msg.receivedDateTime)}</span>
              </div>
              <p className={'text-xs truncate ' + (!msg.isRead ? 'text-[#0F1C2E] font-semibold' : 'text-[#5A6E8A]')}>{msg.subject}</p>
              <p className="text-xs text-[#8A9FC0] truncate mt-0.5">{msg.bodyPreview}</p>
            </div>
          ))}
        </div>

        {/* Message viewer */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-[#8A9FC0]">
              <div className="text-4xl mb-3">✉</div>
              <p className="text-sm">Select a message to read</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {/* Message header */}
              <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 mb-4">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-lg font-bold text-[#0F1C2E]">{selected.subject}</h2>
                  <div className="flex gap-2">
                    <button onClick={()=>{setShowLog(true);loadLogRecords(logType)}} className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-lg">📋 Log to ERP</button>
                    <button onClick={()=>setReplying(r=>!r)} className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-[#3B6FE0] text-xs font-bold rounded-lg">↩ Reply</button>
                  </div>
                </div>
                <div className="text-sm text-[#5A6E8A] space-y-0.5">
                  <p><strong className="text-[#0F1C2E]">From:</strong> {selected.from?.emailAddress?.name} &lt;{selected.from?.emailAddress?.address}&gt;</p>
                  <p><strong className="text-[#0F1C2E]">To:</strong> {selected.toRecipients?.map(r=>r.emailAddress.address).join(', ')}</p>
                  <p><strong className="text-[#0F1C2E]">Date:</strong> {new Date(selected.receivedDateTime).toLocaleString()}</p>
                </div>
              </div>

              {/* Body */}
              <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 mb-4">
                {selected.body?.contentType === 'html'
                  ? <div className="prose prose-sm max-w-none text-[#0F1C2E]" dangerouslySetInnerHTML={{ __html: selected.body.content }} />
                  : <pre className="text-sm text-[#0F1C2E] whitespace-pre-wrap font-sans">{selected.body?.content || selected.bodyPreview}</pre>
                }
              </div>

              {/* Reply composer */}
              {replying && (
                <div className="bg-white rounded-xl border border-[#3B6FE0] p-4">
                  <p className="text-xs font-bold text-[#5A6E8A] uppercase mb-2">Reply to {selected.from?.emailAddress?.address}</p>
                  <textarea value={replyBody} onChange={e=>setReplyBody(e.target.value)} rows={5} placeholder="Write your reply..." className="w-full border border-[#E2E8F0] rounded-lg p-3 text-sm outline-none resize-none" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={sendReply} disabled={sending||!replyBody} className="px-4 py-2 bg-[#3B6FE0] text-white text-xs font-bold rounded-lg disabled:opacity-50">{sending ? 'Sending...' : 'Send Reply'}</button>
                    <button onClick={()=>setReplying(false)} className="px-4 py-2 bg-white border border-[#E2E8F0] text-xs text-[#5A6E8A] rounded-lg">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Log to ERP modal */}
      {showLog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h3 className="font-bold text-[#0F1C2E] text-lg mb-4">📋 Log Email to ERP</h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-bold text-[#5A6E8A] uppercase mb-1">Log to Board</label>
                <select value={logType} onChange={e=>{setLogType(e.target.value);setLinkedId('');setLinkedLabel('');loadLogRecords(e.target.value)}} className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm outline-none">
                  <option value="customer">Customer</option>
                  <option value="sales_order">Sales Order</option>
                  <option value="certification">Certification</option>
                  <option value="task">Task</option>
                  <option value="vendor">Vendor</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A6E8A] uppercase mb-1">Select Record</label>
                <select value={linkedId} onChange={e=>{const r=logRecords.find(x=>x.id===e.target.value);setLinkedId(e.target.value);setLinkedLabel(r?.name||'')}} className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm outline-none">
                  <option value="">— Select —</option>
                  {logRecords.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A6E8A] uppercase mb-1">Note (optional)</label>
                <textarea value={logNote} onChange={e=>setLogNote(e.target.value)} rows={2} placeholder="Add a note about this email..." className="w-full border border-[#E2E8F0] rounded-lg p-2.5 text-sm outline-none resize-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={logEmail} disabled={!linkedId} className="flex-1 bg-[#3B6FE0] text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">Log Email</button>
              <button onClick={()=>setShowLog(false)} className="px-4 py-2.5 border border-[#E2E8F0] rounded-xl text-sm text-[#5A6E8A]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Compose modal */}
      {composing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-xl">
            <h3 className="font-bold text-[#0F1C2E] text-lg mb-4">✉ New Email</h3>
            <div className="space-y-3 mb-4">
              <input value={composeTo} onChange={e=>setComposeTo(e.target.value)} placeholder="To: email@example.com" className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm outline-none" />
              <input value={composeSubject} onChange={e=>setComposeSubject(e.target.value)} placeholder="Subject" className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm outline-none" />
              <textarea value={composeBody} onChange={e=>setComposeBody(e.target.value)} rows={8} placeholder="Write your message..." className="w-full border border-[#E2E8F0] rounded-lg p-3 text-sm outline-none resize-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={sendNew} disabled={sending||!composeTo||!composeSubject} className="flex-1 bg-[#3B6FE0] text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">{sending ? 'Sending...' : 'Send'}</button>
              <button onClick={()=>setComposing(false)} className="px-4 py-2.5 border border-[#E2E8F0] rounded-xl text-sm text-[#5A6E8A]">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}