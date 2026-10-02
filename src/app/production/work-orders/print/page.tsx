'use client'

/**
 * Printable work order travelling sheet.
 *
 * The operator is handed this on paper. Everything the ERP already knows is
 * printed; everything the operator records by hand prints as a ruled blank.
 * The blanks are deliberately the same set of numbers production_observations
 * wants, so the manager keying the sheet back in is also feeding the run-rate
 * history.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { formFor, computeAll, type Field } from '@/lib/workOrderForms'

const sb = createSupabaseBrowserClient()

type Any = Record<string, any>

const txt = (v: any) => (v === null || v === undefined || v === '' ? '' : String(v))

function fmtDate(v: any) {
  if (!v) return ''
  const d = new Date(String(v).length <= 10 ? String(v) + 'T00:00:00' : String(v))
  if (isNaN(d.getTime())) return txt(v)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(v: any) {
  if (!v) return ''
  const s = String(v)
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return s
  let h = Number(m[1])
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m[2]} ${ap}`
}

function fmtNum(v: any) {
  const x = Number(v)
  if (!isFinite(x) || v === null || v === undefined || v === '') return ''
  return x.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** A value the ERP already knows: label above, value on a solid rule. */
function Filled({ label, value, span }: { label: string; value: any; span?: number }) {
  return (
    <div className="cell" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="lbl">{label}</div>
      <div className="val">{txt(value) || <span className="dash">&mdash;</span>}</div>
    </div>
  )
}

/** A value the operator writes in: label above, empty rule below. */
function Blank({ label, span }: { label: string; span?: number }) {
  return (
    <div className="cell" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="lbl">{label}</div>
      <div className="val blank">&nbsp;</div>
    </div>
  )
}

function Section({ title, children, cols = 4 }: { title: string; children: any; cols?: number }) {
  return (
    <section className="sec">
      <h2>{title}</h2>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{children}</div>
    </section>
  )
}

function Sheet() {
  const params = useSearchParams()
  const id = params.get('id') || ''

  const [wo, setWo] = useState<Any | null>(null)
  const [product, setProduct] = useState<Any | null>(null)
  const [machine, setMachine] = useState<Any | null>(null)
  const [bom, setBom] = useState<Any[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  const load = useCallback(async () => {
    if (!id) { setState('missing'); return }

    const { data: w } = await sb
      .from('work_orders')
      .select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, po_number, required_ship_date, customers(company_name))')
      .eq('id', id)
      .maybeSingle()

    if (!w) { setState('missing'); return }
    setWo(w)

    const sku = txt(w.item_part_number).trim()

    const [p, m, b] = await Promise.all([
      sku
        ? sb.from('products')
            .select('sku,product_name,description,unit_of_measure,sell_uom,pieces_per_pack,packs_per_case,product_size,product_color,print_color,bag_length_in,bag_width_in,weight_per_unit_grams,our_part_number,customer_part_number,special_instructions')
            .ilike('sku', sku).limit(1)
        : Promise.resolve({ data: [] as Any[] }),
      w.machine_id
        ? sb.from('machines').select('name,machine_code,equipment_group,equipment_type,location').eq('id', w.machine_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sku
        ? sb.from('product_bom').select('component_sku,role,uom_type,qty_value,percentage,notes').ilike('finished_good_sku', sku)
        : Promise.resolve({ data: [] as Any[] }),
    ])

    const pd: any = (p as any).data
    setProduct((Array.isArray(pd) ? pd[0] : pd) ?? null)
    setMachine((m as any).data ?? null)

    const rows: Any[] = (((b as any).data ?? []) as Any[])
    if (rows.length) {
      const skus = Array.from(new Set(rows.map(r => txt(r.component_sku).trim()).filter(Boolean)))
      const { data: comps } = await sb
        .from('products').select('sku,product_name,unit_of_measure').in('sku', skus)
      const byS: Record<string, Any> = {}
      for (const c of (comps ?? []) as Any[]) byS[txt(c.sku).trim().toUpperCase()] = c
      setBom(rows.map(r => ({ ...r, _p: byS[txt(r.component_sku).trim().toUpperCase()] ?? null })))
    } else {
      setBom([])
    }

    setState('ready')
  }, [id])

  useEffect(() => { load() }, [load])

  // Open the browser print dialog once the sheet has actually rendered.
  useEffect(() => {
    if (state !== 'ready') return
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [state])

  if (state === 'loading') return <div className="msg">Loading work order&hellip;</div>
  if (state === 'missing' || !wo) return <div className="msg">That work order could not be found.</div>

  const form = formFor(wo.group_name, wo.form_type)
  const spec: Any = (wo.spec && typeof wo.spec === 'object') ? wo.spec : {}
  const merged: Any = { ...spec, ...computeAll(form, spec) }

  const so = wo.sales_orders ?? null
  const customer = so?.customers?.company_name ?? ''

  // Spec fields worth printing: anything the form defines that has a value.
  const specFields: Field[] = []
  for (const sec of form.sections) {
    for (const f of sec.fields) {
      const v = merged[f.key]
      if (v !== null && v !== undefined && v !== '' && v !== 0) specFields.push(f)
    }
  }

  const qty = wo.qty_required ?? wo.qty_ordered ?? null
  const hours = wo.scheduled_hours

  return (
    <div className="sheet">
      <style>{CSS}</style>

      <header>
        <div>
          <div className="co">beyondGREEN biotech</div>
          <h1>Work Order &mdash; {wo.wo_code || `WO-${wo.wo_number ?? ''}`}</h1>
          <div className="sub">{form.title} &middot; {form.docCode}</div>
        </div>
        <div className="hdr-right">
          <div><span>Status</span> {txt(wo.status) || '—'}</div>
          <div><span>Priority</span> {txt(wo.priority) || 'Normal'}</div>
          <div><span>Printed</span> {new Date().toLocaleString('en-US')}</div>
        </div>
      </header>

      <Section title="Order">
        <Filled label="Sales Order" value={so?.order_number} />
        <Filled label="Customer" value={customer} />
        <Filled label="Customer PO" value={so?.po_number} />
        <Filled label="Required Ship" value={fmtDate(so?.required_ship_date ?? wo.due_date)} />
      </Section>

      <Section title="Item">
        <Filled label="SKU" value={wo.item_part_number || product?.sku} />
        <Filled label="Description" value={product?.product_name || product?.description} span={2} />
        <Filled label="UOM" value={wo.uom || product?.sell_uom || product?.unit_of_measure} />
        <Filled label="Our Part No." value={product?.our_part_number} />
        <Filled label="Customer Part No." value={product?.customer_part_number} />
        <Filled label="Size" value={product?.product_size} />
        <Filled label="Colour / Print" value={[product?.product_color, product?.print_color].filter(Boolean).join(' / ')} />
        <Filled label="Qty Required" value={fmtNum(qty)} />
        <Filled label="Pieces / Pack" value={fmtNum(product?.pieces_per_pack)} />
        <Filled label="Packs / Case" value={fmtNum(product?.packs_per_case)} />
        <Filled label="Unit Weight (g)" value={fmtNum(product?.weight_per_unit_grams)} />
      </Section>

      <Section title="Assignment">
        <Filled label="Machine" value={machine ? (machine.machine_code || machine.name) : wo.assigned_machine} />
        <Filled label="Equipment Group" value={machine?.equipment_group || wo.group_name} />
        <Filled label="Scheduled Date" value={fmtDate(wo.scheduled_date ?? wo.start_date)} />
        <Filled label="Scheduled Start" value={fmtTime(wo.scheduled_start)} />
        <Filled label="Operator" value={wo.assigned_operator} />
        <Filled label="Est. Run Hours" value={hours ? `${fmtNum(hours)} hr` : ''} />
        <Filled label="Location" value={machine?.location} />
        <Filled label="Due" value={fmtDate(wo.due_date)} />
      </Section>

      {specFields.length > 0 && (
        <Section title="Specification">
          {specFields.map(f => (
            <Filled key={f.key} label={f.label} value={merged[f.key]} span={f.wide ? 2 : 1} />
          ))}
        </Section>
      )}

      <section className="sec">
        <h2>Bill of Materials &mdash; record the lot and actual quantity used</h2>
        {bom.length === 0 ? (
          <p className="none">No BOM on file for this SKU. Record every material used below.</p>
        ) : null}
        <table>
          <thead>
            <tr>
              <th style={{ width: '13%' }}>Component SKU</th>
              <th style={{ width: '27%' }}>Description</th>
              <th style={{ width: '10%' }}>Role</th>
              <th style={{ width: '13%' }}>Planned</th>
              <th style={{ width: '18%' }}>Lot / Batch No.</th>
              <th style={{ width: '19%' }}>Actual Used</th>
            </tr>
          </thead>
          <tbody>
            {bom.map((c, i) => (
              <tr key={i}>
                <td>{txt(c.component_sku)}</td>
                <td>{txt(c._p?.product_name)}</td>
                <td>{txt(c.role).replace(/_/g, ' ')}</td>
                <td>
                  {c.uom_type === 'percentage'
                    ? `${fmtNum(c.qty_value ?? c.percentage)} %`
                    : `${fmtNum(c.qty_value)} ${txt(c.uom_type).replace('pcs_', 'pcs / ')}`}
                </td>
                <td className="fill" />
                <td className="fill" />
              </tr>
            ))}
            {Array.from({ length: Math.max(2, 8 - bom.length) }).map((_, i) => (
              <tr key={`e${i}`}>
                <td className="fill" /><td className="fill" /><td className="fill" />
                <td className="fill" /><td className="fill" /><td className="fill" />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Section title="Run record — to be completed by the operator" cols={4}>
        <Blank label="Shift" />
        <Blank label="Date Run" />
        <Blank label="Actual Start Time" />
        <Blank label="Actual Stop Time" />
        <Blank label="Total Run Hours" />
        <Blank label="Good Qty Produced" />
        <Blank label="Scrap / Reject Qty" />
        <Blank label="Scrap Reason" />
      </Section>

      <section className="sec">
        <h2>Downtime</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '15%' }}>From</th>
              <th style={{ width: '15%' }}>To</th>
              <th style={{ width: '14%' }}>Minutes</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}><td className="fill" /><td className="fill" /><td className="fill" /><td className="fill" /></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sec">
        <h2>Notes</h2>
        {wo.notes ? <p className="pre">{txt(wo.notes)}</p> : null}
        {product?.special_instructions ? <p className="pre">{txt(product.special_instructions)}</p> : null}
        <div className="lines"><div /><div /><div /><div /></div>
      </section>

      <Section title="Sign-off" cols={3}>
        <Blank label="Operator (print name &amp; sign)" />
        <Blank label="Supervisor" />
        <Blank label="QC Check" />
      </Section>

      <footer>
        {form.docCode} &middot; {wo.wo_code || `WO-${wo.wo_number ?? ''}`} &middot; beyondGREEN biotech &middot; return this sheet to the production manager
      </footer>

      <div className="noprint actions">
        <button onClick={() => window.print()}>Print</button>
        <button onClick={() => window.close()}>Close</button>
      </div>
    </div>
  )
}

export default function WorkOrderPrintPage() {
  return (
    <Suspense fallback={<div className="msg">Loading&hellip;</div>}>
      <Sheet />
    </Suspense>
  )
}

const CSS = `
.sheet { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
  color: #111; max-width: 8.1in; margin: 0 auto; padding: 18px 20px 40px; font-size: 11px; background: #fff; }
.msg { font-family: ui-sans-serif, system-ui, sans-serif; padding: 40px; color: #555; }
.sheet header { display: flex; justify-content: space-between; align-items: flex-start;
  border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
.sheet .co { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #15803d; font-weight: 700; }
.sheet h1 { font-size: 19px; margin: 2px 0 0; font-weight: 700; }
.sheet .sub { font-size: 10px; color: #555; margin-top: 2px; }
.hdr-right { text-align: right; font-size: 10px; line-height: 1.6; }
.hdr-right span { color: #777; display: inline-block; min-width: 54px; text-align: left; }
.sec { margin-bottom: 11px; break-inside: avoid; }
.sec h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .09em; color: #374151;
  font-weight: 700; margin: 0 0 5px; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; }
.grid { display: grid; gap: 7px 12px; }
.cell .lbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
.cell .val { font-size: 11.5px; font-weight: 600; border-bottom: 1px solid #111;
  min-height: 17px; padding: 1px 2px; word-break: break-word; }
.cell .val.blank { border-bottom: 1px solid #111; background: #fafafa; min-height: 21px; }
.cell .dash { color: #9ca3af; font-weight: 400; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280;
  text-align: left; border-bottom: 1px solid #111; padding: 3px 4px; font-weight: 700; }
td { font-size: 10.5px; padding: 4px; border-bottom: 1px solid #d1d5db; vertical-align: top; }
td.fill { height: 19px; }
.none { font-size: 10px; color: #b45309; margin: 0 0 5px; }
.pre { white-space: pre-wrap; font-size: 10.5px; margin: 0 0 6px; }
.lines div { border-bottom: 1px solid #d1d5db; height: 19px; }
footer { margin-top: 14px; border-top: 1px solid #d1d5db; padding-top: 6px;
  font-size: 8.5px; color: #6b7280; text-align: center; }
.actions { margin-top: 18px; display: flex; gap: 8px; justify-content: center; }
.actions button { font-size: 12px; font-weight: 600; padding: 7px 18px; border-radius: 8px;
  border: 2px solid #d1d5db; background: #fff; cursor: pointer; }
@media print {
  .noprint { display: none !important; }
  .sheet { max-width: none; padding: 0; font-size: 10.5px; }
  @page { size: letter portrait; margin: 0.45in; }
}
`
