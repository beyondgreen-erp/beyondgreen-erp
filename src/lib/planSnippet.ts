// One WhatsApp message for a day's production plan: every machine, what it runs, who is on it,
// and the operator link where they tap Start (machine shows Running) and log output.
export interface SnippetLine { machine_code: string; product: string | null; operator: string | null; status?: string | null }

export function planSnippet(planDate: string, lines: SnippetLine[], link: string): string {
  const d = new Date(planDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const sorted = [...lines].sort((a, b) => a.machine_code.localeCompare(b.machine_code, undefined, { numeric: true }))
  const rows = sorted.map(l => {
    const off = (l.product || '').toLowerCase() === 'offline' || l.status === 'Offline'
    return `• *${l.machine_code}* — ${off ? 'OFFLINE' : (l.product || 'TBD')}${l.operator ? ` — ${l.operator}` : ''}`
  })
  return [
    `🏭 *Production Plan — ${d}*`,
    '',
    ...(rows.length ? rows : ['(no machines planned)']),
    '',
    '▶ When your machine is running, open this link, tap your machine and press *Start*. Log output every 2 hours:',
    link,
  ].join('\n')
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
    } catch { return false }
  }
}
