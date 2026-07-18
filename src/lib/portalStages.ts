// Client-facing project statuses shared by the portal page and the ERP admin preview.
export const STAGES = [
  'Quote', 'Confirmed', 'In Production', 'Quality Check',
  'Ready to Ship', 'Shipped', 'Delivered', 'On Hold', 'Cancelled',
] as const

export type StageTone = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'gray'

export const STAGE_TONE: Record<string, StageTone> = {
  'Quote': 'gray',
  'Confirmed': 'blue',
  'In Production': 'blue',
  'Quality Check': 'violet',
  'Ready to Ship': 'blue',
  'Shipped': 'green',
  'Delivered': 'green',
  'On Hold': 'amber',
  'Cancelled': 'red',
}

export const TONES: Record<StageTone, { bg: string; text: string }> = {
  green: { bg: '#E4F7EE', text: '#037f4c' },
  blue: { bg: '#E8F0FE', text: '#1D4ED8' },
  amber: { bg: '#FEF3E2', text: '#B45309' },
  red: { bg: '#FDECEC', text: '#C0341D' },
  violet: { bg: '#F1EAFB', text: '#6D28D9' },
  gray: { bg: '#EEF0F4', text: '#5A6E8A' },
}

/** Map an internal ERP status to a clean client-facing stage. Used by the portal API and the admin preview. */
export function clientStage(kind: 'so' | 'quote', status: string | null): { label: string; tone: StageTone } {
  const s = (status || '').trim().toLowerCase()
  if (kind === 'quote') {
    if (s.includes('accept')) return { label: 'Accepted', tone: 'green' }
    if (s.includes('sent')) return { label: 'Quote Sent', tone: 'blue' }
    if (s.includes('reject') || s.includes('declin')) return { label: 'Not Proceeding', tone: 'red' }
    if (s.includes('expire')) return { label: 'Expired', tone: 'gray' }
    return { label: 'Being Prepared', tone: 'gray' }
  }
  const map: [string, { label: string; tone: StageTone }][] = [
    ['cancel', { label: 'Cancelled', tone: 'red' }],
    ['hold', { label: 'On Hold', tone: 'amber' }],
    ['partial', { label: 'Partially Shipped', tone: 'blue' }],
    ['shipped', { label: 'Shipped', tone: 'green' }],
    ['deliver', { label: 'Delivered', tone: 'green' }],
    ['closed', { label: 'Completed', tone: 'green' }],
    ['complete', { label: 'Completed', tone: 'green' }],
    ['ready to ship', { label: 'Ready to Ship', tone: 'blue' }],
    ['waiting for pu', { label: 'Ready for Pickup', tone: 'blue' }],
    ['will call', { label: 'Ready for Pickup', tone: 'blue' }],
    ['qc', { label: 'Quality Check', tone: 'violet' }],
    ['quality', { label: 'Quality Check', tone: 'violet' }],
    ['production queue', { label: 'Preparing Production', tone: 'blue' }],
    ['in production', { label: 'In Production', tone: 'blue' }],
    ['production', { label: 'In Production', tone: 'blue' }],
    ['bom', { label: 'Preparing Production', tone: 'blue' }],
    ['component', { label: 'Preparing Production', tone: 'blue' }],
    ['resubmit', { label: 'Awaiting Confirmation', tone: 'amber' }],
    ['awaiting confirmation', { label: 'Awaiting Confirmation', tone: 'amber' }],
    ['confirm', { label: 'Order Confirmed', tone: 'blue' }],
    ['pending', { label: 'Order Received', tone: 'gray' }],
    ['new', { label: 'Order Received', tone: 'gray' }],
  ]
  for (const [k, v] of map) if (s.includes(k)) return v
  return { label: status || 'In Progress', tone: 'gray' }
}
