'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Exact specification read from the original file: flat size, dimension callouts, colour builds, plates.
import type { DesignSpec } from '@/lib/packaging/specExtract'

export default function SpecSheet({ spec, source, compact }: { spec: DesignSpec; source?: { name: string; sha256: string } | null; compact?: boolean }) {
  const h = spec.dims.filter(d => !d.vertical), v = spec.dims.filter(d => d.vertical)
  const printingPlates = spec.plates.filter(p => !p.technical), techPlates = spec.plates.filter(p => p.technical)
  const pageIn = (pt: number) => (pt / 72).toFixed(2)
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="flex gap-3 text-sm py-1"><span className="w-28 shrink-0 text-gray-500 text-xs uppercase tracking-wide pt-0.5">{k}</span><span className="text-gray-900 min-w-0">{children}</span></div>
  return (
    <div className="space-y-4">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Sizes</p>
        {spec.flat && <Row k="Largest marked"><b>{spec.flat.w} {spec.flat.unit} (W) × {spec.flat.h} {spec.flat.unit} (H)</b> <span className="text-gray-500 text-xs">— the largest horizontal and vertical dimensions written on the dieline</span></Row>}
        {spec.page.w > 0 && <Row k="File page">{pageIn(spec.page.w)} × {pageIn(spec.page.h)} in</Row>}
        {spec.dims.length > 0 && (
          <div className={`grid ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'} gap-3 mt-2`}>
            <div><p className="text-[11px] font-semibold text-gray-500 mb-1">↔ Horizontal callouts</p>
              <div className="flex flex-wrap gap-1">{h.map(d => <span key={d.text + 'h'} className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-800">{d.text}{d.uses > 1 ? ` ×${d.uses}` : ''}</span>)}</div></div>
            <div><p className="text-[11px] font-semibold text-gray-500 mb-1">↕ Vertical callouts</p>
              <div className="flex flex-wrap gap-1">{v.map(d => <span key={d.text + 'v'} className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-800">{d.text}{d.uses > 1 ? ` ×${d.uses}` : ''}</span>)}</div></div>
          </div>
        )}
      </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Colour codes (exact values from the file)</p>
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {printingPlates.map(p => (
            <div key={p.name} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="w-5 h-5 rounded border border-gray-300 shrink-0" style={{ background: p.hex }} />
              <b className="flex-1 min-w-0 truncate">{p.name}</b><span className="text-[10px] px-1.5 rounded bg-blue-50 text-blue-700">SPOT</span>
              {p.cmyk && <span className="font-mono text-xs text-gray-600">C{p.cmyk[0]} M{p.cmyk[1]} Y{p.cmyk[2]} K{p.cmyk[3]}</span>}
              {p.lab && <span className="font-mono text-xs text-gray-600">L*{p.lab[0]} a*{p.lab[1]} b*{p.lab[2]}</span>}
            </div>
          ))}
          {spec.colors.map((c, i) => (
            <div key={c.label + i} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="w-5 h-5 rounded border border-gray-300 shrink-0" style={{ background: c.hex }} />
              <span className="font-mono text-xs text-gray-900 flex-1 whitespace-nowrap">{c.label}</span>
              <span className="text-[10px] text-gray-400">{i === 0 ? 'most used' : ''}</span>
            </div>
          ))}
          {spec.paper && <div className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-gray-500"><span className="w-5 h-5 rounded border border-gray-300 bg-white shrink-0" />No ink (substrate shows through) — C0 M0 Y0 K0</div>}
          {!spec.colors.length && !printingPlates.length && <p className="px-2.5 py-2 text-sm text-gray-500">No colour values found.</p>}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Process CMYK builds as defined in the artwork file. On-screen swatches are approximations — print to the values.</p>
      </section>
      {techPlates.length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Die / technical plates (non-printing)</p>
          <div className="flex flex-wrap gap-1.5">{techPlates.map(p => <span key={p.name} className="text-xs px-2 py-1 rounded border border-gray-200 flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: p.hex }} />{p.name}{p.cmyk ? <span className="font-mono text-gray-400">{p.cmyk.join('/')}</span> : p.lab ? <span className="font-mono text-gray-400">Lab {p.lab.join('/')}</span> : null}</span>)}</div>
        </section>
      )}
      {source && <p className="text-[11px] text-gray-400 break-all">Read from <b>{source.name}</b> · SHA-256 {source.sha256}</p>}
      {spec.notes.map((n, i) => <p key={i} className="text-[11px] text-amber-700">{n}</p>)}
    </div>
  )
}
