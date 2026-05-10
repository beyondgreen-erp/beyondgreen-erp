import Link from 'next/link'

const modules = [
  {
    name: 'Production',
    borderColor: 'border-emerald-500/30',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-400',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
      </svg>
    ),
    description: 'Monitor machines, manage daily production plans, and track capacity.',
    links: [
      { label: 'Machine Status', href: '/production/machine-status' },
      { label: 'Daily Plan', href: '/production/daily-plan' },
      { label: 'Production Overview', href: '/production/overview' },
      { label: 'Capacity Plan', href: '/production/capacity-plan' },
    ],
    stats: [
      { label: 'Machines Online', value: '—' },
      { label: 'Open Plans', value: '—' },
      { label: 'Capacity Used', value: '—' },
    ],
  },
  {
    name: 'Sales',
    borderColor: 'border-blue-500/30',
    bgColor: 'bg-blue-500/10',
    textColor: 'text-blue-400',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    ),
    description: 'Manage orders, customers, shipments, invoices, inventory, and vendors.',
    links: [
      { label: 'Quotations', href: '/sales/quotations' },
      { label: 'Sales Orders', href: '/sales/orders' },
      { label: 'Shipping Queue', href: '/sales/shipping-queue' },
      { label: 'Invoices', href: '/sales/invoices' },
    ],
    stats: [
      { label: 'Open Orders', value: '—' },
      { label: 'Pending Shipments', value: '—' },
      { label: 'Unpaid Invoices', value: '—' },
    ],
  },
  {
    name: 'Business Dev',
    borderColor: 'border-violet-500/30',
    bgColor: 'bg-violet-500/10',
    textColor: 'text-violet-400',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    description: 'Track tasks, manage certifications, and maintain your document pool.',
    links: [
      { label: 'Task Board', href: '/bizdev/tasks' },
      { label: 'Certifications', href: '/bizdev/certifications' },
      { label: 'Document Pool', href: '/bizdev/documents' },
    ],
    stats: [
      { label: 'Open Tasks', value: '—' },
      { label: 'Active Certs', value: '—' },
      { label: 'Documents', value: '—' },
    ],
  },
]

export default function DashboardPage() {
  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back to beyondGREEN ERP</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {modules.map((mod) => (
          <div
            key={mod.name}
            className={`rounded-xl border ${mod.borderColor} bg-gray-900 p-6 flex flex-col gap-5`}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${mod.bgColor} ${mod.textColor}`}>
                {mod.icon}
              </div>
              <div>
                <h2 className="text-white font-semibold">{mod.name}</h2>
                <p className="text-gray-500 text-xs mt-0.5">{mod.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {mod.stats.map((stat) => (
                <div key={stat.label} className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <p className={`text-lg font-bold ${mod.textColor}`}>{stat.value}</p>
                  <p className="text-gray-500 text-xs mt-0.5 leading-tight">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              {mod.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors group"
                >
                  <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
                    {link.label}
                  </span>
                  <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
