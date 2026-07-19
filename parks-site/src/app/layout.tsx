import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pet Waste Bag Program for Cities, HOAs and More! | beyondGREEN',
  description:
    'beyondGREEN dog waste bags for city parks, HOAs, and park districts. Made in USA, priced from $0.032/bag, with a free-dispenser program and sponsor-slot revenue for local businesses.',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Pet Waste Bag Program for Cities, HOAs and More!',
    description:
      'USA-made dog waste bags for parks, cities, and HOAs. From $0.032/bag with sponsor-slot revenue and free dispensers for volume programs.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#F5F7FA', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
