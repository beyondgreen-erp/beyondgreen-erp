'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { parseColor, rgbToHex, rgbToCmyk, cmykToRgb } from '@/lib/packaging/scene'

export interface ColorValue { hex: string | null; cmyk?: number[] | null; spot?: string | null }

/** Fill / stroke editor: hex, CMYK (0–100) and optional spot-colour name. */
export default function ColorField({ label, value, onChange, allowNone = true }: {
  label: string; value: ColorValue; onChange: (v: ColorValue) => void; allowNone?: boolean
}) {
  const [hex, setHex] = useState(value.hex || '')
  const [cmyk, setCmyk] = useState<string[]>((value.cmyk || []).map(n => String(Math.round(n))))
  const [spot, setSpot] = useState(value.spot || '')
  useEffect(() => {
    setHex(value.hex || '')
    setCmyk(value.cmyk && value.cmyk.length === 4 ? value.cmyk.map(n => String(Math.round(n))) : (value.hex ? rgbToCmyk(parseColor(value.hex)?.rgb || [0, 0, 0]).map(n => String(Math.round(n * 100))) : ['', '', '', '']))
    setSpot(value.spot || '')
  }, [value.hex, value.cmyk, value.spot])

  const none = !value.hex
  const commitHex = (h: string) => {
    const c = parseColor(h)
    if (!c) return
    onChange({ hex: rgbToHex(c.rgb), cmyk: null, spot: value.spot || null })
  }
  const commitCmyk = (arr: string[]) => {
    const nums = arr.map(v => Math.max(0, Math.min(100, Number(v) || 0)))
    const rgb = cmykToRgb(nums.map(n => n / 100) as any)
    onChange({ hex: rgbToHex(rgb), cmyk: nums, spot: value.spot || null })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        {allowNone && (
          <button onClick={() => onChange(none ? { hex: '#000000', cmyk: [0, 0, 0, 100] } : { hex: null })}
            className="text-[11px] text-gray-500 hover:text-gray-800">{none ? '+ Add' : 'None'}</button>
        )}
      </div>
      {!none && (
        <>
          <div className="flex items-center gap-2">
            <label className="relative w-8 h-8 rounded border border-gray-300 overflow-hidden shrink-0 cursor-pointer" style={{ background: value.hex! }}>
              <input type="color" value={(value.hex || '#000000').slice(0, 7)} onChange={e => commitHex(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
            <input value={hex} onChange={e => setHex(e.target.value)} onBlur={() => commitHex(hex)} onKeyDown={e => e.key === 'Enter' && commitHex(hex)}
              className="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded" />
          </div>
          <div className="grid grid-cols-4 gap-1">
            {['C', 'M', 'Y', 'K'].map((ch, i) => (
              <label key={ch} className="flex items-center border border-gray-300 rounded px-1">
                <span className="text-[10px] font-bold" style={{ color: ['#00AEEF', '#EC008C', '#C9A800', '#111'][i] }}>{ch}</span>
                <input value={cmyk[i] ?? ''} inputMode="numeric"
                  onChange={e => { const n = cmyk.slice(); n[i] = e.target.value.replace(/[^\d.]/g, ''); setCmyk(n) }}
                  onBlur={() => commitCmyk(cmyk)} onKeyDown={e => e.key === 'Enter' && commitCmyk(cmyk)}
                  className="w-full text-xs py-1 pl-1 outline-none bg-transparent" />
              </label>
            ))}
          </div>
          <input value={spot} placeholder="Spot colour name (optional, e.g. PMS 7482 C)"
            onChange={e => setSpot(e.target.value)} onBlur={() => onChange({ ...value, spot: spot.trim() || null })}
            onKeyDown={e => e.key === 'Enter' && onChange({ ...value, spot: spot.trim() || null })}
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
        </>
      )}
    </div>
  )
}
