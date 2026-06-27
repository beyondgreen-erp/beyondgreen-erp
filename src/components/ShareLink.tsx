'use client'
import { useState } from 'react'

/** Copy-a-shareable-deep-link button. Builds <origin><path>?item=<id> so a
 *  recipient who opens it lands on the board with this item's panel opened. */
export default function ShareLink({ id, className }: { id: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    const url = `${window.location.origin}${window.location.pathname}?item=${encodeURIComponent(id)}`
    try { await navigator.clipboard.writeText(url) }
    catch {
      const t = document.createElement('textarea'); t.value = url
      document.body.appendChild(t); t.select(); try { document.execCommand('copy') } catch {} t.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button type="button" onClick={copy} title="Copy a shareable link to this item"
      className={className || 'inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-2.5 py-1.5 rounded-lg transition-colors shrink-0'}>
      <i className={`ti ${copied ? 'ti-check' : 'ti-link'} text-sm ${copied ? 'text-green-600' : ''}`} />
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}
