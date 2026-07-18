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
