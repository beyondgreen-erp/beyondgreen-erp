import Link from 'next/link'

export const metadata = { title: 'Work Orders board retired' }

const BOARDS = [
  { href: '/production/walmart', label: 'Walmart' },
  { href: '/production/straw', label: 'Straws' },
  { href: '/production/mts-bags', label: 'MTS Bags' },
  { href: '/production/mts-cutlery', label: 'Cutlery' },
  { href: '/production/private-label-bags', label: 'Private Label' },
  { href: '/production/contract-molding', label: 'Molding' },
]

export default function RetiredWorkOrdersBoard() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
      <div style={{ fontSize: 12, letterSpacing: 1, color: '#8A8F9C', fontWeight: 600 }}>PRODUCTION</div>
      <h1 style={{ fontSize: 26, margin: '8px 0 12px', color: '#1B1D23' }}>This board has been retired</h1>
      <p style={{ color: '#4A4F5C', lineHeight: 1.6, margin: '0 0 8px' }}>
        The combined Work Orders board was replaced by a board per production line. Open the one you need below.
      </p>
      <p style={{ color: '#4A4F5C', lineHeight: 1.6, margin: '0 0 24px' }}>
        Work orders that were still open here were cancelled on November 2, 2026. If one of them is still live, raise it again on the matching board.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {BOARDS.map((b) => (
          <Link
            key={b.href}
            href={b.href}
            style={{ display: 'block', padding: '14px 16px', border: '1px solid #E5EDF5', borderRadius: 10, background: '#FBFDFF', color: '#1B1D23', fontWeight: 600, textDecoration: 'none' }}
          >
            {b.label}
          </Link>
        ))}
      </div>
      <p style={{ marginTop: 24 }}>
        <Link href="/production/daily-plan" style={{ color: '#2E7D4F', fontWeight: 600 }}>Daily Production Plan</Link>
      </p>
    </div>
  )
}
