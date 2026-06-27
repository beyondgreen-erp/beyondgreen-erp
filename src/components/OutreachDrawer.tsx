/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
"use client"
import { useState, useEffect } from 'react'

interface Outreach {
  id: string
  customer_id: string
  sent_at: string
  sent_by: string
  subject: string
  body: string
  response_received: boolean
  response_at: string | null
  response_notes: string | null
  follow_up_days: number
  follow_up_due: string | null
  follow_up_approved: boolean
  follow_up_sent_at: string | null
  status: string
}

interface Props {
  customerId: string
  companyName: string
  customerEmail: string
  userEmail: string
  isLead: boolean
  onClose: () => void
}

export default function OutreachDrawer({ customerId, companyName, customerEmail, userEmail, isLead, onClose }: Props) {
  const [history, setHistory] = useState<Outreach[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [composeMode, setComposeMode] = useState<'initial' | 'followup'>('initial')
  const [sending, setSending] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [followUpDays, setFollowUpDays] = useState(7)
  const [respondingTo, setRespondingTo] = useState<string | null>(null)
  const [responseNotes, setResponseNotes] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const pendingFollowUps = history.filter(h =>
    !h.response_received && !h.follow_up_approved &&
    h.follow_up_due && new Date(h.follow_up_due) <= new Date()
  )

  useEffect(() => { loadHistory() }, [customerId])

  async function loadHistory() {
    setLoading(true)
    const r = await fetch(`/api/outreach?customer_id=${customerId}`)
    const d = await r.json()
    setHistory(Array.isArray(d) ? d : [])
    setLoading(false)
  }

  // Ask the AI to draft (or follow-up draft) an email. Fills the editable compose fields.
  async function aiDraft(mode: 'initial' | 'followup' = 'initial', prior?: { subject: string; body: string }) {
    setAiError(''); setAiLoading(true)
    try {
      const r = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai_draft', customer_id: customerId, sent_by: userEmail, mode, prior_subject: prior?.subject || '', prior_body: prior?.body || '' })
      })
      const d = await r.json()
      if (!r.ok || d.error) { setAiError(d.error || 'AI draft failed'); setAiLoading(false); return }
      setSubject(d.subject || ''); setBody(d.body || '')
    } catch (e) {
      setAiError('AI draft failed')
    }
    setAiLoading(false)
  }

  function openCompose(mode: 'initial' | 'followup', prior?: { subject: string; body: string }) {
    setComposeMode(mode); setComposing(true); setAiError('')
    if (mode === 'followup') {
      setFollowUpDays(7)
      aiDraft('followup', prior)
    }
  }

  async function sendEmail() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    await fetch('/api/outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', customer_id: customerId, subject, body, sent_by: userEmail, follow_up_days: followUpDays, customer_email: customerEmail, company_name: companyName })
    })
    setSubject(''); setBody(''); setFollowUpDays(7); setComposing(false); setComposeMode('initial'); setSending(false)
    loadHistory()
  }

  async function markResponded(id: string) {
    await fetch('/api/outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_responded', id, response_notes: responseNotes })
    })
    setRespondingTo(null); setResponseNotes('')
    loadHistory()
  }

  async function approveFollowUp(id: string) {
    await fetch('/api/outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve_followup', id })
    })
    loadHistory()
  }

  const S = {
    overlay: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.45)', zIndex:70 },
    drawer: { position:'fixed' as const, top:0, right:0, height:'100%', width:'520px', maxWidth:'96vw', background:'#fff', zIndex:71, display:'flex', flexDirection:'column' as const, boxShadow:'-4px 0 24px rgba(0,0,0,0.15)' },
    header: { padding:'20px 24px 16px', borderBottom:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between', alignItems:'flex-start' },
    body: { flex:1, overflowY:'auto' as const, padding:'20px 24px' },
    tag: (color: string) => ({ display:'inline-block', padding:'2px 8px', borderRadius:'99px', fontSize:'11px', fontWeight:700, background:color, color:'#fff', marginLeft:'8px' }),
    btn: (bg: string, fg='#fff') => ({ padding:'8px 16px', border:'none', borderRadius:'8px', background:bg, color:fg, fontSize:'13px', fontWeight:700, cursor:'pointer' }),
    inp: { width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:'8px', fontSize:'13px', boxSizing:'border-box' as const, marginBottom:'10px' },
    card: (border: string) => ({ border:`1px solid ${border}`, borderRadius:'10px', padding:'14px 16px', marginBottom:'12px', background:'#fafafa' }),
    label: { fontSize:'12px', fontWeight:600, color:'#475569', display:'block', marginBottom:'4px' },
  }

  const statusColor: Record<string,string> = { sent:'#3b82f6', responded:'#16a34a', follow_up_pending:'#f59e0b', follow_up_sent:'#8b5cf6', closed:'#6b7280' }

  return (
    <>
      <div style={S.overlay} onClick={onClose} />
      <div style={S.drawer}>
        <div style={S.header}>
          <div>
            <div style={{ fontWeight:800, fontSize:'17px', color:'#1a2e1a' }}>
              Email Outreach
              {isLead && <span style={S.tag('#f59e0b')}>LEAD</span>}
              {!isLead && <span style={S.tag('#3b82f6')}>PROSPECT</span>}
            </div>
            <div style={{ fontSize:'13px', color:'#64748b', marginTop:'2px' }}>{companyName} {customerEmail && `· ${customerEmail}`}</div>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={() => openCompose('initial')} style={S.btn('#1a2e1a')}>✉ Compose</button>
            <button onClick={onClose} style={S.btn('#f1f5f9','#475569')}>Close</button>
          </div>
        </div>

        {/* Pending follow-up banner */}
        {pendingFollowUps.length > 0 && (
          <div style={{ background:'#fef3c7', borderBottom:'1px solid #fde68a', padding:'12px 24px' }}>
            <div style={{ fontWeight:700, fontSize:'13px', color:'#92400e' }}>⏰ {pendingFollowUps.length} follow-up{pendingFollowUps.length>1?'s':''} due</div>
            {pendingFollowUps.map(f => (
              <div key={f.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'8px', background:'#fff', borderRadius:'8px', padding:'10px 12px' }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:'13px' }}>{f.subject}</div>
                  <div style={{ fontSize:'11px', color:'#92400e' }}>Sent {new Date(f.sent_at).toLocaleDateString()} · follow-up was due {new Date(f.follow_up_due!).toLocaleDateString()}</div>
                </div>
                <button onClick={() => openCompose('followup', { subject: f.subject, body: f.body })} style={{ ...S.btn('#f59e0b'), padding:'6px 12px', fontSize:'12px' }}>✨ Draft Follow-Up</button>
              </div>
            ))}
          </div>
        )}

        <div style={S.body}>
          {/* Compose panel */}
          {composing && (
            <div style={{ ...S.card('#2E7D32'), background:'#f0fdf4', marginBottom:'20px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                <div style={{ fontWeight:700, fontSize:'14px', color:'#166534' }}>
                  {composeMode === 'followup' ? '✨ AI follow-up to ' : '✉ New Email to '}{companyName}
                </div>
                <button onClick={() => aiDraft(composeMode, composeMode === 'followup' ? { subject, body } : undefined)} disabled={aiLoading}
                  style={{ ...S.btn('#7c3aed'), padding:'6px 12px', fontSize:'12px', opacity: aiLoading ? 0.6 : 1 }}>
                  {aiLoading ? 'Drafting…' : (subject || body ? '✨ Redraft with AI' : '✨ AI Draft')}
                </button>
              </div>

              {aiError && (
                <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', borderRadius:'8px', padding:'8px 12px', fontSize:'12px', marginBottom:'10px' }}>
                  {aiError}
                </div>
              )}

              <label style={S.label}>To</label>
              <input style={S.inp} value={customerEmail} readOnly />
              <label style={S.label}>Subject</label>
              <input style={S.inp} value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Introducing beyondGREEN compostable solutions" />
              <label style={S.label}>Message <span style={{ fontWeight:400, color:'#94a3b8' }}>(AI suggestion — edit freely)</span></label>
              <textarea rows={8} style={{ ...S.inp, resize:'vertical' }} value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={`Hi ${companyName.split(' ')[0]},\n\nClick “✨ AI Draft” above, or write your own…`}
              />
              <div style={{ fontSize:'12px', color:'#64748b', marginBottom:'12px' }}>✍️ Your email signature is added automatically when the email is sent.</div>
              <label style={S.label}>Schedule follow-up reminder (days if no reply)</label>
              <div style={{ display:'flex', gap:'8px', marginBottom:'12px' }}>
                {[3,5,7,14,30].map(d => (
                  <button key={d} onClick={() => setFollowUpDays(d)}
                    style={{ padding:'6px 12px', border:`2px solid ${followUpDays===d?'#2E7D32':'#e2e8f0'}`, borderRadius:'8px', background:followUpDays===d?'#2E7D32':'#fff', color:followUpDays===d?'#fff':'#374151', fontSize:'12px', fontWeight:700, cursor:'pointer' }}>
                    {d}d
                  </button>
                ))}
              </div>
              <div style={{ fontSize:'12px', color:'#64748b', marginBottom:'14px' }}>
                Follow-up reminder on {new Date(Date.now()+followUpDays*86400000).toLocaleDateString()} if no reply received.
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={sendEmail} disabled={!subject.trim()||!body.trim()||sending}
                  style={{ ...S.btn('#2E7D32'), flex:1, opacity:(!subject.trim()||!body.trim()||sending)?0.5:1 }}>
                  {sending ? 'Sending…' : '✓ Send Email'}
                </button>
                <button onClick={() => { setComposing(false); setComposeMode('initial') }} style={S.btn('#f1f5f9','#475569')}>Cancel</button>
              </div>
            </div>
          )}

          {/* History */}
          <div style={{ fontWeight:700, fontSize:'13px', color:'#64748b', marginBottom:'12px', textTransform:'uppercase', letterSpacing:'0.05em' }}>
            {loading ? 'Loading...' : `${history.length} Email${history.length!==1?'s':''} Sent`}
          </div>

          {history.length === 0 && !loading && (
            <div style={{ textAlign:'center', padding:'40px 20px', color:'#94a3b8' }}>
              <div style={{ fontSize:'32px', marginBottom:'8px' }}>✉</div>
              <div style={{ fontWeight:600 }}>No emails logged yet</div>
              <div style={{ fontSize:'13px' }}>Click Compose, then “✨ AI Draft” to generate your first email</div>
            </div>
          )}

          {history.map(h => (
            <div key={h.id} style={S.card(h.response_received ? '#86efac' : h.follow_up_approved ? '#c4b5fd' : '#e2e8f0')}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
                <div style={{ fontWeight:700, fontSize:'14px', color:'#1a2e1a' }}>{h.subject}</div>
                <span style={{ ...S.tag(statusColor[h.status]||'#6b7280'), marginLeft:0 }}>{h.status.replace('_',' ')}</span>
              </div>
              <div style={{ fontSize:'12px', color:'#64748b', marginBottom:'8px' }}>
                Sent {new Date(h.sent_at).toLocaleString()} by {h.sent_by}
                {h.follow_up_due && !h.response_received && (
                  <span style={{ marginLeft:'8px', color: new Date(h.follow_up_due) <= new Date() ? '#ef4444' : '#f59e0b' }}>
                    · Follow-up {new Date(h.follow_up_due) <= new Date() ? 'overdue' : 'due'} {new Date(h.follow_up_due).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div style={{ fontSize:'13px', color:'#374151', background:'#f8fafc', borderRadius:'6px', padding:'8px 10px', marginBottom:'8px', whiteSpace:'pre-wrap', maxHeight:'80px', overflow:'hidden' }}>{h.body}</div>

              {h.response_received && (
                <div style={{ fontSize:'12px', color:'#16a34a', fontWeight:600 }}>
                  ✓ Response received {h.response_at ? new Date(h.response_at).toLocaleDateString() : ''}
                  {h.response_notes && <span style={{ color:'#374151', fontWeight:400 }}> · {h.response_notes}</span>}
                </div>
              )}

              {!h.response_received && (
                <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                  {respondingTo === h.id ? (
                    <>
                      <input style={{ ...S.inp, flex:1, marginBottom:0 }} value={responseNotes} onChange={e => setResponseNotes(e.target.value)} placeholder="Notes on response (optional)" />
                      <button onClick={() => markResponded(h.id)} style={{ ...S.btn('#16a34a'), whiteSpace:'nowrap' as const }}>✓ Save</button>
                      <button onClick={() => setRespondingTo(null)} style={S.btn('#f1f5f9','#475569')}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setRespondingTo(h.id)} style={{ ...S.btn('#f1f5f9','#475569'), fontSize:'12px' }}>Mark Responded</button>
                      <button onClick={() => openCompose('followup', { subject: h.subject, body: h.body })} style={{ ...S.btn('#7c3aed'), fontSize:'12px' }}>✨ Draft Follow-Up with AI</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
