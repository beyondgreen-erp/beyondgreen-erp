/**
 * Walmart next-day production planner.
 *
 * Model (one day):
 *   x_s  SRPs of SKU s finished (molded + packed) for a pick-up group
 *   pieces:  Σ_s bom[s][p]·x_s ≤ stock_p + Σ_{m with mold p} rate_m·H      (every piece type p)
 *   packing: Σ_s (people_s / rate_s)·x_s ≤ packer-hours                     (when packing is manual)
 *   demand:  x_s ≤ todo_s
 * Machines carrying the same mold are interchangeable within a day, so their hour variables
 * aggregate exactly into one capacity row per mold.
 *
 * 1. Priorities are solved lexicographically: pick-up group 1 is optimised first and frozen,
 *    then group 2 gets what capacity is left, and so on.
 * 2. Inside a group, stage A maximises the minimum completion fraction z (a load only ships
 *    when every SKU is there, so all SKUs are lifted together — max-min fairness); stage B then
 *    spends the remaining capacity maximising total SRPs. Both are LPs, solved with a dense
 *    primal simplex using Bland's rule (cannot cycle).
 * 3. Optional "mold ahead": spare machine time builds pieces for what could not be packed.
 * 4. Machine layout per mold: either the fewest machines that fit the day (default — fewer
 *    start-ups and operators), or every machine in parallel (earliest finish). Inside the chosen
 *    set, each priority is water-filled: machines busy with an earlier priority start later, and
 *    the level T with Σ rate·(T − busy) = pieces needed is that priority's earliest finish.
 * 5. Suggestions: each mold swap, each unavailable machine and one extra packer per shift is
 *    test-applied and the whole plan re-solved; changes that improve the priority score are listed.
 */

export type Piece = 'BGFRK' | 'BGSPN' | 'BGKNF'
export const PIECE_LIST: Piece[] = ['BGFRK', 'BGSPN', 'BGKNF']
export const PIECE_NAME: Record<Piece, string> = { BGFRK: 'Fork', BGSPN: 'Spoon', BGKNF: 'Knife' }

export interface PlanMachine { id: string; code: string; piece: Piece; rate: number; available: boolean }
export interface PlanGroupIn { key: string; label: string; rank: number; todo: Record<string, number> }
export interface PackRate { perHour: number; people: number }
/** Any other BOM input (packs, SRP trays, resin…) with what is on hand. */
export interface Component { key: string; name: string; uom: string; avail: number; perSrp: Record<string, number>; perPiece: Partial<Record<Piece, number>> }
export interface PlannerInput {
  groups: PlanGroupIn[]
  bom: Record<string, Record<string, number>>
  machines: PlanMachine[]
  horizonH: number
  pieceStock: Record<string, number>
  manualPacking: boolean
  packRates: Record<string, PackRate>
  shifts: { n: number; hours: number; packers: number }[]
  moldAhead: boolean
  strategy: 'fewest' | 'fastest'
  components?: Component[]          // enforced material / packaging limits
  packSpeedFactor?: number          // learned from real output (1 = rates as entered)
}
export interface Segment { machineId: string; code: string; piece: Piece; groupKey: string; label: string; start: number; end: number; pcs: number; skus: string[]; ahead: boolean }
export interface GroupResult { key: string; label: string; rank: number; todo: Record<string, number>; planned: Record<string, number>; z: number; totalTodo: number; totalPlanned: number }
export interface PackLine { shift: number; sku: string; srps: number; hours: number; people: number; groupKey: string }
export interface PlannerResult {
  groups: GroupResult[]
  segments: Segment[]
  machineHours: Record<string, number>
  piecesNeeded: Record<string, number>
  piecesMade: Record<string, number>
  piecesCapacity: Record<string, number>
  packHoursUsed: number
  packHoursAvail: number
  pack: PackLine[]
  bottlenecks: string[]
  warnings: string[]
  compUsed: Record<string, number>
  compAvail: Record<string, number>
}

/* ───────── dense primal simplex: maximise c·x s.t. A x ≤ b, x ≥ 0, b ≥ 0 ───────── */
export function simplexMax(c: number[], A: number[][], b: number[]): { x: number[]; value: number } {
  const m = A.length, n = c.length, EPS = 1e-9, W = n + m + 1
  const T: number[][] = []
  for (let i = 0; i < m; i++) {
    const row = new Array(W).fill(0)
    for (let j = 0; j < n; j++) row[j] = A[i][j]
    row[n + i] = 1
    row[W - 1] = Math.max(0, b[i])
    T.push(row)
  }
  const obj = new Array(W).fill(0)
  for (let j = 0; j < n; j++) obj[j] = -c[j]
  T.push(obj)
  const basis = Array.from({ length: m }, (_, i) => n + i)
  for (let iter = 0; iter < 10000; iter++) {
    let col = -1
    for (let j = 0; j < W - 1; j++) if (T[m][j] < -EPS) { col = j; break }   // Bland: lowest index enters
    if (col < 0) break
    let row = -1, best = Infinity
    for (let i = 0; i < m; i++) {
      if (T[i][col] > EPS) {
        const r = T[i][W - 1] / T[i][col]
        if (r < best - EPS || (Math.abs(r - best) <= EPS && row >= 0 && basis[i] < basis[row])) { best = r; row = i }
      }
    }
    if (row < 0) break
    const pv = T[row][col]
    for (let j = 0; j < W; j++) T[row][j] /= pv
    for (let i = 0; i <= m; i++) {
      if (i === row) continue
      const f = T[i][col]
      if (Math.abs(f) > EPS) for (let j = 0; j < W; j++) T[i][j] -= f * T[row][j]
    }
    basis[row] = col
  }
  const x = new Array(n).fill(0)
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = T[i][W - 1]
  return { x, value: T[m][W - 1] }
}

const pcsPer = (bom: PlannerInput['bom'], sku: string, p: Piece) => Number(bom[sku]?.[p] || 0)

/** Hours each machine runs (from busy[m]) to make `need` pieces as early as possible. */
function waterFill(ms: PlanMachine[], busy: Record<string, number>, H: number, need: number): Record<string, number> {
  const out: Record<string, number> = {}
  if (need <= 0 || !ms.length) return out
  const cap = (T: number) => ms.reduce((a, m) => a + m.rate * Math.max(0, Math.min(T, H) - (busy[m.id] || 0)), 0)
  if (cap(H) <= need) { for (const m of ms) out[m.id] = Math.max(0, H - (busy[m.id] || 0)); return out }
  let lo = 0, hi = H
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (cap(mid) >= need) hi = mid; else lo = mid }
  for (const m of ms) out[m.id] = Math.max(0, hi - (busy[m.id] || 0))
  return out
}

export function planDay(inp: PlannerInput): PlannerResult {
  const H = Math.max(0, inp.horizonH)
  const ms = inp.machines.filter(m => m.available && m.rate > 0)
  const stock: Record<string, number> = Object.fromEntries(PIECE_LIST.map(p => [p, Math.max(0, Number(inp.pieceStock[p] || 0))]))
  const machCap: Record<string, number> = Object.fromEntries(PIECE_LIST.map(p => [p, ms.filter(m => m.piece === p).reduce((a, m) => a + m.rate * H, 0)]))
  const capLeft: Record<string, number> = Object.fromEntries(PIECE_LIST.map(p => [p, stock[p] + machCap[p]]))
  const psf = Math.max(0.05, inp.packSpeedFactor || 1)
  const packAvail = inp.manualPacking ? inp.shifts.reduce((a, s) => a + s.hours * s.packers, 0) : Infinity
  let packRem = packAvail
  const packCost = (sku: string) => {
    if (!inp.manualPacking) return 0
    const r = inp.packRates[sku]
    return r && r.perHour > 0 ? r.people / (r.perHour * psf) : 0
  }
  const comps = inp.components || []
  const compLeft: Record<string, number> = Object.fromEntries(comps.map(c => [c.key, Math.max(0, c.avail)]))
  const compUsed: Record<string, number> = Object.fromEntries(comps.map(c => [c.key, 0]))
  const compCoef = (c: Component, sku: string) => (c.perSrp[sku] || 0) + PIECE_LIST.reduce((a, p) => a + pcsPer(inp.bom, sku, p) * (c.perPiece[p] || 0), 0)
  const warnings: string[] = []
  for (const g of inp.groups) for (const s of Object.keys(g.todo)) {
    if (g.todo[s] > 0 && inp.manualPacking && !inp.packRates[s]) warnings.push(`${s} has no packing rate, so its packing time is not counted.`)
    if (g.todo[s] > 0 && !PIECE_LIST.some(p => pcsPer(inp.bom, s, p) > 0)) warnings.push(`${s} has no fork/spoon/knife BOM, so no molding is planned for it.`)
  }

  const groupsOut: GroupResult[] = []
  // pieces each priority needs from machines, in order (ahead = molded today, packed later)
  const demand: Record<string, { g: PlanGroupIn; pcs: number; skus: string[]; ahead: boolean }[]> = { BGFRK: [], BGSPN: [], BGKNF: [] }
  const piecesNeeded: Record<string, number> = { BGFRK: 0, BGSPN: 0, BGKNF: 0 }
  const stockLeft = { ...stock }
  const leftover: { g: PlanGroupIn; rest: Record<string, number> }[] = []

  for (const g of inp.groups) {
    const skus = Object.keys(g.todo).filter(s => g.todo[s] > 0)
    const planned: Record<string, number> = {}
    if (!skus.length) { groupsOut.push({ key: g.key, label: g.label, rank: g.rank, todo: g.todo, planned, z: 1, totalTodo: 0, totalPlanned: 0 }); continue }

    // stage A — max z with x_s = z·todo_s
    {
      const A: number[][] = [], b: number[] = []
      for (const p of PIECE_LIST) { const coef = skus.reduce((a, s) => a + pcsPer(inp.bom, s, p) * g.todo[s], 0); if (coef > 0) { A.push([coef]); b.push(capLeft[p]) } }
      if (Number.isFinite(packRem)) { const pc = skus.reduce((a, s) => a + packCost(s) * g.todo[s], 0); if (pc > 0) { A.push([pc]); b.push(packRem) } }
      for (const c of comps) { const co = skus.reduce((a, s) => a + compCoef(c, s) * g.todo[s], 0); if (co > 0) { A.push([co]); b.push(compLeft[c.key]) } }
      A.push([1]); b.push(1)
      const z = Math.max(0, Math.min(1, simplexMax([1], A, b).x[0]))
      for (const s of skus) planned[s] = z * g.todo[s]
    }
    // stage B — extra SRPs y_s on top of the base
    {
      const base: Record<string, number> = { BGFRK: 0, BGSPN: 0, BGKNF: 0 }; let basePk = 0
      for (const s of skus) { for (const p of PIECE_LIST) base[p] += pcsPer(inp.bom, s, p) * planned[s]; basePk += packCost(s) * planned[s] }
      const nS = skus.length
      const A: number[][] = [], b: number[] = []
      for (const p of PIECE_LIST) if (skus.some(s => pcsPer(inp.bom, s, p) > 0)) { A.push(skus.map(s => pcsPer(inp.bom, s, p))); b.push(Math.max(0, capLeft[p] - base[p])) }
      skus.forEach((s, i) => { const r = new Array(nS).fill(0); r[i] = 1; A.push(r); b.push(Math.max(0, g.todo[s] - planned[s])) })
      if (Number.isFinite(packRem)) { const r = skus.map(s => packCost(s)); if (r.some(v => v > 0)) { A.push(r); b.push(Math.max(0, packRem - basePk)) } }
      for (const c of comps) {
        const r = skus.map(s => compCoef(c, s)); if (!r.some(v => v > 0)) continue
        const used = skus.reduce((a, s, i) => a + r[i] * planned[s], 0)
        A.push(r); b.push(Math.max(0, compLeft[c.key] - used))
      }
      const sol = simplexMax(skus.map(() => 1), A, b)
      skus.forEach((s, i) => { planned[s] += Math.max(0, sol.x[i]) })
    }
    for (const s of skus) planned[s] = Math.max(0, Math.min(g.todo[s], Math.floor(planned[s] + 1e-6)))   // whole SRPs

    for (const p of PIECE_LIST) {
      const pcs = skus.reduce((a, s) => a + pcsPer(inp.bom, s, p) * planned[s], 0)
      if (pcs <= 0) continue
      piecesNeeded[p] += pcs
      capLeft[p] -= pcs
      const fromStock = Math.min(stockLeft[p], pcs); stockLeft[p] -= fromStock
      if (pcs - fromStock > 0) demand[p].push({ g, pcs: pcs - fromStock, skus: skus.filter(s => planned[s] > 0 && pcsPer(inp.bom, s, p) > 0), ahead: false })
    }
    if (Number.isFinite(packRem)) packRem -= skus.reduce((a, s) => a + packCost(s) * planned[s], 0)
    for (const c of comps) { const u = skus.reduce((a, s) => a + compCoef(c, s) * planned[s], 0); compLeft[c.key] -= u; compUsed[c.key] += u }
    const totalTodo = skus.reduce((a, s) => a + g.todo[s], 0), totalPlanned = skus.reduce((a, s) => a + planned[s], 0)
    groupsOut.push({ key: g.key, label: g.label, rank: g.rank, todo: g.todo, planned, z: Math.min(...skus.map(s => planned[s] / g.todo[s])), totalTodo, totalPlanned })
    const rest: Record<string, number> = {}
    for (const s of skus) if (g.todo[s] - planned[s] > 0) rest[s] = g.todo[s] - planned[s]
    if (Object.keys(rest).length) leftover.push({ g, rest })
  }

  if (inp.moldAhead) {
    for (const { g, rest } of leftover) for (const p of PIECE_LIST) {
      let need = Object.keys(rest).reduce((a, s) => a + pcsPer(inp.bom, s, p) * rest[s], 0)
      const fromStock = Math.min(stockLeft[p], need); stockLeft[p] -= fromStock; need -= fromStock
      need = Math.min(need, Math.max(0, capLeft[p]))
      for (const c of comps) { const pp = c.perPiece[p] || 0; if (pp > 0) need = Math.min(need, Math.floor(Math.max(0, compLeft[c.key]) / pp)) }
      if (need <= 0) continue
      capLeft[p] -= need
      for (const c of comps) { const pp = c.perPiece[p] || 0; if (pp > 0) { compLeft[c.key] -= need * pp; compUsed[c.key] += need * pp } }
      demand[p].push({ g, pcs: need, skus: Object.keys(rest).filter(s => pcsPer(inp.bom, s, p) > 0), ahead: true })
    }
  }

  // machine layout per mold
  const segments: Segment[] = []
  for (const p of PIECE_LIST) {
    const total = demand[p].reduce((a, d) => a + d.pcs, 0)
    if (total <= 0) continue
    let pool = ms.filter(m => m.piece === p).sort((a, b) => b.rate - a.rate || a.code.localeCompare(b.code, undefined, { numeric: true }))
    if (inp.strategy === 'fewest') {
      let k = 0, cap = 0
      while (k < pool.length && cap < total - 1e-6) { cap += pool[k].rate * H; k++ }
      pool = pool.slice(0, Math.max(1, k))
    }
    const busy: Record<string, number> = Object.fromEntries(pool.map(m => [m.id, 0]))
    for (const d of demand[p]) {
      const hrs = waterFill(pool, busy, H, d.pcs)
      for (const m of pool) {
        const h = Math.min(hrs[m.id] || 0, H - busy[m.id]); if (h <= 1e-6) continue
        segments.push({ machineId: m.id, code: m.code, piece: p, groupKey: d.g.key, label: d.g.label, start: busy[m.id], end: busy[m.id] + h, pcs: Math.round(m.rate * h), skus: d.skus, ahead: d.ahead })
        busy[m.id] += h
      }
    }
  }

  // packing schedule — priority order, filled shift by shift
  const pack: PackLine[] = []
  let packHoursUsed = 0
  if (inp.manualPacking && inp.shifts.length) {
    const shiftLeft = inp.shifts.map(s => s.hours * s.packers)
    for (const g of groupsOut) for (const s of Object.keys(g.planned)) {
      let q = g.planned[s]; if (q <= 0) continue
      const cost = packCost(s), r = inp.packRates[s]
      for (let i = 0; i < inp.shifts.length && q > 0; i++) {
        const take = Math.min(q, cost > 0 ? Math.floor(shiftLeft[i] / cost + 1e-6) : q)
        if (take <= 0) continue
        pack.push({ shift: inp.shifts[i].n, sku: s, srps: take, hours: r ? take / (r.perHour * psf) : 0, people: r?.people || 1, groupKey: g.key })
        shiftLeft[i] -= cost * take; packHoursUsed += cost * take; q -= take
      }
      if (q > 0) {   // rounding remainder → last shift
        const n = inp.shifts[inp.shifts.length - 1].n
        const last = pack.find(x => x.sku === s && x.groupKey === g.key && x.shift === n)
        if (last) { last.srps += q; last.hours += r ? q / (r.perHour * psf) : 0 } else pack.push({ shift: n, sku: s, srps: q, hours: r ? q / (r.perHour * psf) : 0, people: r?.people || 1, groupKey: g.key })
        packHoursUsed += cost * q
      }
    }
  }

  const machineHours: Record<string, number> = {}
  const piecesMade: Record<string, number> = { BGFRK: 0, BGSPN: 0, BGKNF: 0 }
  for (const sg of segments) { machineHours[sg.machineId] = (machineHours[sg.machineId] || 0) + (sg.end - sg.start); piecesMade[sg.piece] += sg.pcs }

  const bottlenecks: string[] = []
  const g1 = groupsOut.find(g => g.totalTodo > 0)
  if (g1 && g1.totalPlanned < g1.totalTodo) {
    if (inp.manualPacking && packAvail > 0 && packAvail - packHoursUsed < 0.5) bottlenecks.push(`Packing: all ${Math.round(packAvail)} packer-hours are used.`)
    for (const p of PIECE_LIST) {
      const needsP = Object.keys(g1.todo).some(s => g1.todo[s] > (g1.planned[s] || 0) && pcsPer(inp.bom, s, p) > 0)
      if (!needsP) continue
      if (!ms.some(m => m.piece === p)) bottlenecks.push(`${PIECE_NAME[p]} molding: no available machine has a ${PIECE_NAME[p].toLowerCase()} mold.`)
      else if (stock[p] + machCap[p] - piecesNeeded[p] < Math.max(...ms.filter(m => m.piece === p).map(m => m.rate)) * 0.05) bottlenecks.push(`${PIECE_NAME[p]} molding: every ${PIECE_NAME[p].toLowerCase()} machine is full for the day.`)
    }
  }
  if (g1 && g1.totalPlanned < g1.totalTodo) for (const c of comps) {
    const needed = Object.keys(g1.todo).some(s => g1.todo[s] > (g1.planned[s] || 0) && compCoef(c, s) > 0)
    if (needed && compLeft[c.key] < Math.max(1, c.avail * 0.02)) bottlenecks.push(`Material: ${c.name} — only ${Math.round(c.avail).toLocaleString('en-US')} ${c.uom} on hand.`)
  }
  return { compUsed, compAvail: Object.fromEntries(comps.map(c => [c.key, c.avail])), groups: groupsOut, segments, machineHours, piecesNeeded, piecesMade, piecesCapacity: Object.fromEntries(PIECE_LIST.map(p => [p, stock[p] + machCap[p]])), packHoursUsed, packHoursAvail: packAvail, pack, bottlenecks, warnings: Array.from(new Set(warnings)) }
}

/** Score per priority: (completion of the whole load, SRPs), compared lexicographically. */
function better(a: PlannerResult, b: PlannerResult): boolean {
  for (let i = 0; i < Math.max(a.groups.length, b.groups.length); i++) {
    const ga = a.groups[i], gb = b.groups[i]
    if (!ga || !gb) break
    if (Math.abs(ga.z - gb.z) > 1e-3) return ga.z > gb.z
    if (Math.abs(ga.totalPlanned - gb.totalPlanned) >= 1) return ga.totalPlanned > gb.totalPlanned
  }
  return false
}

export interface Suggestion { kind: 'swap' | 'start' | 'packer'; text: string; gainP1: number; gainP2: number; machineId?: string; piece?: Piece }
export function suggest(inp: PlannerInput, base: PlannerResult): Suggestion[] {
  const out: Suggestion[] = []
  const d = (r: PlannerResult, i: number) => (r.groups[i]?.totalPlanned || 0) - (base.groups[i]?.totalPlanned || 0)
  for (const m of inp.machines) {
    if (!m.available) {
      const r = planDay({ ...inp, machines: inp.machines.map(x => (x.id === m.id ? { ...x, available: true } : x)) })
      if (better(r, base)) out.push({ kind: 'start', machineId: m.id, piece: m.piece, gainP1: d(r, 0), gainP2: d(r, 1), text: `Get ${m.code} (${PIECE_NAME[m.piece].toLowerCase()} mold) running` })
      continue
    }
    for (const p of PIECE_LIST) {
      if (p === m.piece) continue
      const r = planDay({ ...inp, machines: inp.machines.map(x => (x.id === m.id ? { ...x, piece: p } : x)) })
      if (better(r, base)) out.push({ kind: 'swap', machineId: m.id, piece: p, gainP1: d(r, 0), gainP2: d(r, 1), text: `Swap ${m.code} from the ${PIECE_NAME[m.piece].toLowerCase()} mold to a ${PIECE_NAME[p].toLowerCase()} mold` })
    }
  }
  if (inp.manualPacking) {
    const r = planDay({ ...inp, shifts: inp.shifts.map(s => ({ ...s, packers: s.packers + 1 })) })
    if (better(r, base)) out.push({ kind: 'packer', gainP1: d(r, 0), gainP2: d(r, 1), text: 'Add one more packer on each shift' })
  }
  return out.sort((a, b) => b.gainP1 - a.gainP1 || b.gainP2 - a.gainP2).slice(0, 6)
}
