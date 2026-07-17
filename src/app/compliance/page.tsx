'use client'
export const dynamic = 'force-dynamic'
import Link from 'next/link'

interface Card { title: string; description: string; href: string; icon: string; color: string; badge?: string }

const CARDS: Card[] = [
  { title: 'HACCP', description: 'Hazard analysis, critical control points, and food-safety plan tracking.', href: '/haccp', icon: 'ti-clipboard-check', color: '#00c875' },
  { title: 'Certifications', description: 'Third-party certifications, expirations, and renewal reminders.', href: '/bizdev/certifications', icon: 'ti-rosette', color: '#5559df' },
  { title: 'Quality Control', description: 'Inspections, parameters, results, and QC holds.', href: '/production/quality-control', icon: 'ti-checkup-list', color: '#579bfc' },
  { title: 'Documents & Knowledge', description: 'SDS, policies, procedures, and all controlled documents.', href: '/bizdev/documents', icon: 'ti-folder', color: '#a25ddc' },
  { title: 'Audits', description: 'Internal and external audit schedule, findings, and corrective actions.', href: '/compliance/audits', icon: 'ti-file-search', color: '#fdab3d', badge: 'Coming soon' },
  { title: 'CAPA Log', description: 'Corrective and preventive action tracking with root-cause analysis.', href: '/compliance/capa', icon: 'ti-alert-triangle', color: '#df2f4a', badge: 'Coming soon' },
  { title: 'Regulatory Filings', description: 'FDA, USDA, EPA, and state regulatory submissions.', href: '/compliance/filings', icon: 'ti-building-bank', color: '#037f4c', badge: 'Coming soon' },
  { title: 'Incident Reports', description: 'Non-conformances, customer complaints, and recall readiness.', href: '/compliance/incidents', icon: 'ti-exclamation-circle', color: '#bb3354', badge: 'Coming soon' },
]

export default function CompliancePage() {
  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="mb-6">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-700 border-emerald-500/30">COMPLIANCE</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Compliance</h1>
        <p className="text-gray-500 text-sm mt-0.5">Regulatory, food safety, quality, and controlled documentation across the business.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {CARDS.map(c => (
          <Link key={c.title} href={c.href} className="group relative rounded-xl border border-[#E4E6EE] bg-white p-5 hover:border-transparent hover:shadow-lg transition-all">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.color + '18' }}>
                <i className={`ti ${c.icon} text-2xl`} style={{ color: c.color }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-[#1A1D2E] text-sm truncate">{c.title}</h3>
                  {c.badge && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">{c.badge}</span>}
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{c.description}</p>
              </div>
            </div>
            <i className="ti ti-arrow-up-right absolute top-4 right-4 text-gray-300 group-hover:text-[#1A1D2E] transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
