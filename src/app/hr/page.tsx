'use client'
export const dynamic = 'force-dynamic'
import Link from 'next/link'

interface Card { title: string; description: string; href: string; icon: string; color: string; badge?: string }

const CARDS: Card[] = [
  { title: 'Team Directory', description: 'Employees, roles, contact info, and reporting structure.', href: '/hr/directory', icon: 'ti-users', color: '#5559df', badge: 'Coming soon' },
  { title: 'Time Off', description: 'Vacation, sick leave, and time-off requests with approvals.', href: '/hr/time-off', icon: 'ti-calendar-off', color: '#00c875' },
  { title: 'Onboarding', description: 'New-hire checklists, orientation, and first-week tasks.', href: '/hr/onboarding', icon: 'ti-user-plus', color: '#579bfc', badge: 'Coming soon' },
  { title: 'Training & Certifications', description: 'Employee training records, expirations, and required certifications.', href: '/hr/training', icon: 'ti-school', color: '#a25ddc', badge: 'Coming soon' },
  { title: 'Performance Reviews', description: 'Reviews, goals, and 1-on-1 tracking for each team member.', href: '/hr/reviews', icon: 'ti-chart-arrows-vertical', color: '#fdab3d', badge: 'Coming soon' },
  { title: 'Timesheets & Payroll', description: 'Clock-in/out records, hours worked, and payroll exports.', href: '/hr/timesheets', icon: 'ti-clock', color: '#037f4c', badge: 'Coming soon' },
  { title: 'Recruiting & Job Postings', description: 'Open roles, applicant pipeline, and interview scheduling.', href: '/hr/recruiting', icon: 'ti-user-search', color: '#ff6d3b', badge: 'Coming soon' },
  { title: 'Policies & Handbook', description: 'Employee handbook, workplace policies, and required acknowledgements.', href: '/bizdev/documents', icon: 'ti-book', color: '#bb3354' },
]

export default function HumanResourcesPage() {
  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="mb-6">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-700 border-violet-500/30">HUMAN RESOURCES</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Human Resources</h1>
        <p className="text-gray-500 text-sm mt-0.5">Team management, onboarding, training, and workplace operations.</p>
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
