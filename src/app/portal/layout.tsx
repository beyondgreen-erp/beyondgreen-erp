import type { Metadata } from 'next'

// Client-facing pages: never show the ERP name in the browser tab, and keep them out of search.
export const metadata: Metadata = {
  title: 'beyondGREEN Client Portal',
  description: 'Orders, projects, quotes, documents and calls with the beyondGREEN team.',
  robots: { index: false, follow: false },
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children
}
