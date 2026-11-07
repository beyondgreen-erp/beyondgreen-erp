'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import PortalShell, { api, GREEN, INK, cardCls, Empty } from '@/components/portal/PortalShell'

function DocsBody() {
  const [docs, setDocs] = useState<any[] | null>(null)
  const [packs, setPacks] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { api('documents').then(r => { setDocs(r.data.documents || []); setPacks(r.data.packs || []) }) }, [])
  if (docs === null) return <Empty>Loading…</Empty>
  const packBlock = packs.length ? (
    <div className={`${cardCls} p-4`}>
      <p className="text-xs font-bold uppercase text-gray-400 mb-1">Compliance packs for what you order</p>
      <p className="text-xs text-gray-500 mb-2">Added automatically for every product type on your orders. Each pack is one ZIP with a cover sheet, the certificates that cover that exact item, statements, TDS and SDS.</p>
      <div className="divide-y divide-[#F1F3F9]">
        {packs.map(p => (
          <div key={p.key} className="py-2.5">
            <div className="flex items-center gap-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === p.key ? null : p.key)}><p className="text-sm font-semibold" style={{ color: INK }}>{p.name}</p><p className="text-xs text-gray-500">{p.documents.length} file{p.documents.length === 1 ? '' : 's'} · {open === p.key ? 'hide details' : 'see what is inside'}</p></button>
              <a href={p.url} className="shrink-0 text-sm font-semibold" style={{ color: GREEN }}>Download</a>
            </div>
            {open === p.key && (
              <div className="mt-2 text-xs text-gray-600 space-y-1">
                {p.note && <p>{p.note}</p>}
                <ul className="list-disc pl-4">{p.documents.map((d: any) => <li key={d.label}>{d.label}</li>)}</ul>
                {p.on_request?.length ? <p><b>On request:</b> {p.on_request.join('; ')}</p> : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  ) : null
  if (!docs.length) return <div className="space-y-4">{packBlock}<Empty>No other documents shared yet. Ask us for our W-9, insurance certificate or any certificate and we will post it here.</Empty></div>
  const groups: Record<string, any[]> = {}
  docs.forEach(d => { (groups[d.category || 'Other'] ||= []).push(d) })
  return (
    <div className="space-y-4">
      {packBlock}
      {Object.entries(groups).map(([cat, list]) => (
        <div key={cat} className={`${cardCls} p-4`}>
          <p className="text-xs font-bold uppercase text-gray-400 mb-2">{cat}</p>
          <div className="divide-y divide-[#F1F3F9]">
            {list.map(d => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold" style={{ color: INK }}>{d.name}</p>{d.description && <p className="text-xs text-gray-500">{d.description}</p>}</div>
                {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-semibold" style={{ color: GREEN }}>Open</a> : <span className="text-xs text-gray-400">Unavailable</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-gray-500">Need something else for vendor setup (W-9, COI, SDS, PFAS statement, spec sheet)? Message the team and we will post it here.</p>
    </div>
  )
}

export default function DocumentsPage() {
  return <PortalShell title="Documents" subtitle="Vendor setup documents, certifications and spec sheets, ready to download."><DocsBody /></PortalShell>
}
