'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import PortalShell, { api, GREEN, INK, cardCls, Empty } from '@/components/portal/PortalShell'

function DocsBody() {
  const [docs, setDocs] = useState<any[] | null>(null)
  useEffect(() => { api('documents').then(r => setDocs(r.data.documents || [])) }, [])
  if (docs === null) return <Empty>Loading…</Empty>
  if (!docs.length) return <Empty>No documents shared yet. Ask us for our W-9, insurance certificate or any certificate and we will post it here.</Empty>
  const groups: Record<string, any[]> = {}
  docs.forEach(d => { (groups[d.category || 'Other'] ||= []).push(d) })
  return (
    <div className="space-y-4">
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
