'use client'
export const dynamic = 'force-dynamic'
import Link from 'next/link'

const cards = [
  {
    href: '/settings/profile',
    title: 'My Profile',
    description: 'Edit your name, department, phone and password',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    color: 'text-emerald-400',
    border: 'hover:border-emerald-500/40',
  },
  {
    href: '/settings/team',
    title: 'Team Directory',
    description: 'View all team members, roles, and online status',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    color: 'text-blue-400',
    border: 'hover:border-blue-500/40',
  },
  {
    href: '/settings/users',
    title: 'User Management',
    description: 'Manage roles, departments, and access for all users',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    color: 'text-violet-400',
    border: 'hover:border-violet-500/40',
  },
  {
    href: '/settings/company',
    title: 'Company Profile',
    description: 'Company name, industry, website, and contact details',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    color: 'text-amber-400',
    border: 'hover:border-amber-500/40',
  },
  {
    href: '/settings/notifications',
    title: 'Notifications',
    description: 'Configure email and in-app notification preferences',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
    color: 'text-cyan-400',
    border: 'hover:border-cyan-500/40',
  },
  {
    href: '/settings/email',
    title: 'Email Connection',
    description: 'Connect and configure outbound email settings',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    color: 'text-pink-400',
    border: 'hover:border-pink-500/40',
  },
  {
    href: '/settings/berg-brain',
    title: 'BERG Brain',
    description: 'Teach BERG facts about beyondGREEN',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    color: 'text-emerald-300',
    border: 'hover:border-emerald-400/40',
  },
  {
    href: '/settings/berg-alerts',
    title: 'BERG Alerts',
    description: 'View and manage BERG intelligence alerts',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'text-emerald-300',
    border: 'hover:border-emerald-400/40',
  },
]

export default function SettingsPage() {
  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-gray-700/40 text-gray-400 border-gray-700">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your profile, team, and platform preferences</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map(card => (
          <Link
            key={card.href}
            href={card.href}
            className={`group bg-gray-900 border border-gray-800 ${card.border} rounded-xl p-5 flex flex-col gap-3 transition-colors`}
          >
            <div className={`${card.color}`}>{card.icon}</div>
            <div>
              <p className="text-white font-semibold text-sm group-hover:text-white">{card.title}</p>
              <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{card.description}</p>
            </div>
            <div className="mt-auto flex items-center justify-end">
              <svg className={`w-4 h-4 ${card.color} opacity-0 group-hover:opacity-100 transition-opacity`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
