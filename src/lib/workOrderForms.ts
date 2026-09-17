/* eslint-disable @typescript-eslint/no-explicit-any */
// The shop floor runs off printed work orders, one layout per kind of job. These
// definitions are those sheets, field for field, so what the ERP prints and what the
// operator has always filled in are the same document:
//
//   OP_018 REV_B  Molding Machine Work Order
//   OP_004 REV_A  Extrusion Blown Film Work Order
//   OP_008 REV_A  Conversion Work Order
//   OP_004 REV_A  Straw Extrusion Work Order
//   OP_004 REV_A  Straw Conversion Work Order
//
// Four groups (Straw Crimping, Cutlery Kitting, Material Blender, Material Regranulator)
// have no sheet yet and use the generic form until theirs arrives.

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea' | 'computed'

export interface Field {
  key: string
  label: string
  type: FieldType
  options?: string[]
  /** computed fields only: derive the value from the rest of the spec */
  compute?: (s: Record<string, any>) => number | string
  /** how many decimals a computed number keeps */
  dp?: number
  placeholder?: string
  /** span the full row instead of one column */
  wide?: boolean
}

export interface Section {
  title?: string
  columns?: 1 | 2
  fields: Field[]
}

export interface FormDef {
  title: string
  docCode: string
  sections: Section[]
}

const n = (v: any) => {
  const x = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return isFinite(x) ? x : 0
}
// The field is labelled Percentage and the sheets are filled in as 70, 30, 5, 1 — so it is
// always out of a hundred. An earlier version treated a value of 1 or less as already a
// fraction, which read a 1% colour masterbatch as 100% and asked for the whole batch
// weight in colour.
const pct = (v: any) => n(v) / 100
const IN_TO_M = 0.0254
const G_TO_LB = 1 / 453.59237

// ── Shared blocks ────────────────────────────────────────────────────────────

const HEADER: Section = {
  columns: 2,
  fields: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'machine_no', label: 'Machine #', type: 'text', placeholder: 'set by the Machine picker' },
    { key: 'wo_code', label: 'Work Order #', type: 'text', placeholder: '260810-MLD-1' },
    { key: 'item_part_number', label: 'Item Part #', type: 'text' },
  ],
}

const SPECIAL_NOTES: Section = {
  columns: 1,
  fields: [{ key: 'special_notes', label: 'Special Notes', type: 'textarea', wide: true }],
}

/** Material n / percentage / lot#, as printed on the extrusion sheets. */
function materials(rows: { key: string; label: string }[]): Section {
  return {
    title: 'Materials',
    columns: 2,
    fields: rows.flatMap(r => ([
      { key: `${r.key}_type`, label: `${r.label} — Type`, type: 'text' as FieldType },
      { key: `${r.key}_pct`, label: `${r.label} — Percentage`, type: 'number' as FieldType },
      { key: `${r.key}_lot`, label: `${r.label} — Lot #`, type: 'text' as FieldType, wide: true },
    ])),
  }
}

// ── Molding Machine Work Order (OP_018 REV_B) ────────────────────────────────

const MOLDING: FormDef = {
  title: 'Molding Machine Work Order',
  docCode: 'OP_018 REV_B',
  sections: [
    {
      columns: 2,
      fields: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'machine_no', label: 'M/C No.', type: 'text', placeholder: 'set by the Machine picker' },
        { key: 'mold_no', label: 'Mold No.', type: 'text' },
        { key: 'item_part_number', label: 'Item PN', type: 'text' },
        { key: 'wo_code', label: 'WO No.', type: 'text', placeholder: '260810-MLD-1' },
        { key: 'wo_qty', label: 'WO Qty', type: 'number' },
        { key: 'uom', label: 'UOM', type: 'select', options: ['Pks', 'Pcs', 'Cs', 'Ea', 'Lbs'] },
      ],
    },
    {
      title: 'Product Instructions',
      columns: 2,
      fields: [
        { key: 'material_1_type', label: 'Material 1', type: 'text' },
        { key: 'material_1_pct', label: '% Blend', type: 'number' },
        { key: 'material_2_type', label: 'Material 2', type: 'text' },
        { key: 'material_2_pct', label: '% Blend', type: 'number' },
        { key: 'material_3_type', label: 'Material 3', type: 'text' },
        { key: 'material_3_pct', label: '% Blend', type: 'number' },
        { key: 'color_type', label: 'Color', type: 'text' },
        { key: 'color_pct', label: '% Blend', type: 'number' },
      ],
    },
    {
      title: 'Packaging Instructions',
      columns: 2,
      fields: [
        { key: 'items_per_package', label: 'Items Per Package', type: 'number' },
        { key: 'packages_per_box', label: 'Packages Per Box', type: 'number' },
        { key: 'box_size', label: 'Box Size', type: 'text', placeholder: '18x16x12' },
        { key: 'assy_requirement', label: 'Assy. Requirement', type: 'text', placeholder: 'Left and Right' },
        { key: 'assy_components', label: 'Assy. Components', type: 'text', wide: true },
      ],
    },
    { columns: 1, fields: [{ key: 'special_setup', label: 'Special Set-Up', type: 'textarea', wide: true }] },
    { columns: 1, fields: [{ key: 'special_instructions', label: 'Special Instructions', type: 'textarea', wide: true }] },
  ],
}

// ── Extrusion Blown Film Work Order (OP_004 REV_A) ───────────────────────────

const BLOWN_FILM_EXTRUSION: FormDef = {
  title: 'Extrusion Blown Film Work Order',
  docCode: 'OP_004 REV_A',
  sections: [
    HEADER,
    { columns: 2, fields: [{ key: 'meter_quantity', label: 'Meter Quantity', type: 'number' }] },
    {
      columns: 2,
      fields: [
        { key: 'bag_width_in', label: 'Bag Width (in)', type: 'number' },
        { key: 'bag_color', label: 'Bag Color', type: 'text' },
        { key: 'bag_length_in', label: 'Bag Length (in)', type: 'number' },
        { key: 'ink_color', label: 'Ink Color', type: 'text' },
        { key: 'bag_thickness_um', label: 'Bag Thickness (µm)', type: 'number' },
        { key: 'print_plate', label: 'Print Plate #', type: 'text' },
        { key: 'bag_gusset_in', label: 'Bag Gusset Size (in)', type: 'number' },
        { key: 'continuous_print', label: 'Continuous Print?', type: 'select', options: ['yes', 'no'] },
        { key: 'bag_weight_g', label: 'Bag Weight (g)', type: 'number' },
        { key: 'roller_size_in', label: 'Roller Size (in)', type: 'number' },
      ],
    },
    materials([
      { key: 'material_1', label: 'Material 1' },
      { key: 'material_2', label: 'Material 2' },
      { key: 'color_material', label: 'Color Material' },
    ]),
    SPECIAL_NOTES,
    {
      title: 'Production Calculator',
      columns: 2,
      fields: [
        { key: 'cycle_time_m_min', label: 'Ext. Cycle Time (M/Min)', type: 'number' },
        { key: 'bags_needed', label: 'Bags Needed', type: 'number' },
        { key: 'calc_blown_film_m', label: 'Blown Film (M)', type: 'computed', dp: 1, compute: s => n(s.bags_needed) * n(s.bag_length_in) * IN_TO_M },
        {
          key: 'calc_production_hours', label: 'Production Hours', type: 'computed', dp: 2,
          compute: s => { const c = n(s.cycle_time_m_min); return c ? (n(s.bags_needed) * n(s.bag_length_in) * IN_TO_M) / c / 60 : 0 },
        },
        { key: 'calc_mat1_lb', label: 'Material 1 Req. (lb)', type: 'computed', dp: 2, compute: s => n(s.bags_needed) * n(s.bag_weight_g) * pct(s.material_1_pct) * G_TO_LB },
        { key: 'calc_mat2_lb', label: 'Material 2 Req. (lb)', type: 'computed', dp: 2, compute: s => n(s.bags_needed) * n(s.bag_weight_g) * pct(s.material_2_pct) * G_TO_LB },
        { key: 'calc_color_lb', label: 'Color Mat. Req. (lb)', type: 'computed', dp: 2, compute: s => n(s.bags_needed) * n(s.bag_weight_g) * pct(s.color_material_pct) * G_TO_LB },
      ],
    },
  ],
}

// ── Conversion Work Order (OP_008 REV_A) ─────────────────────────────────────

const CONVERSION: FormDef = {
  title: 'Conversion Work Order',
  docCode: 'OP_008 REV_A',
  sections: [
    HEADER,
    { columns: 2, fields: [{ key: 'production_quantity', label: 'Production Quantity', type: 'text', placeholder: '1 cs' }] },
    {
      columns: 2,
      fields: [
        { key: 'bag_width_in', label: 'Bag Width (in)', type: 'number' },
        { key: 'bag_type', label: '# Bag Type', type: 'text', placeholder: 'folded roll' },
        { key: 'bag_length_in', label: 'Bag Length (in)', type: 'number' },
        { key: 'bags_per_roll', label: 'Bags per Roll/Stack', type: 'number' },
        { key: 'bag_thickness_um', label: 'Bag Thickness (µm)', type: 'number' },
        { key: 'handles', label: 'Handles?', type: 'select', options: ['yes', 'no'] },
        { key: 'bag_gusset_in', label: 'Bag Gusset Size (in)', type: 'number' },
        { key: 'core', label: 'Core?', type: 'select', options: ['yes', 'no'] },
        { key: 'bag_weight_g', label: 'Bag Weight (g)', type: 'number' },
      ],
    },
    {
      title: 'Packaging',
      columns: 2,
      fields: [
        { key: 'packaging_part_number', label: 'Packaging Part #', type: 'text' },
        { key: 'case_size_in', label: 'Case Size (in)', type: 'text', placeholder: '14x14x14' },
        { key: 'rolls_per_pack', label: 'Rolls/Stacks per Pack', type: 'number' },
        { key: 'packs_per_case', label: 'Packs/Rolls per Case', type: 'number' },
        { key: 'label_part_number', label: 'Label Part #', type: 'text' },
        { key: 'pallet_size', label: 'Pallet Size', type: 'text', placeholder: '45x45' },
        { key: 'labels_per_roll', label: 'Labels per Roll/Stack', type: 'number' },
        { key: 'cases_per_pallet', label: 'Cases per Pallet', type: 'number' },
        { key: 'label_description', label: 'Label Description', type: 'text', wide: true },
      ],
    },
    SPECIAL_NOTES,
    {
      title: 'Production Calculator',
      columns: 2,
      fields: [
        { key: 'bags_per_minute', label: 'Bags per Minute', type: 'number' },
        { key: 'bags_needed', label: 'Bags Needed', type: 'number' },
        {
          key: 'calc_packs_needed', label: '# of Packs Needed', type: 'computed', dp: 0,
          compute: s => { const d = n(s.bags_per_roll) * n(s.rolls_per_pack); return d ? n(s.bags_needed) / d : 0 },
        },
        {
          key: 'calc_production_hours', label: 'Production Hours', type: 'computed', dp: 3,
          compute: s => { const r = n(s.bags_per_minute); return r ? n(s.bags_needed) / r / 60 : 0 },
        },
        {
          key: 'calc_cases', label: '# of Cases', type: 'computed', dp: 0,
          compute: s => {
            const perPack = n(s.bags_per_roll) * n(s.rolls_per_pack)
            const packs = perPack ? n(s.bags_needed) / perPack : 0
            const ppc = n(s.packs_per_case)
            return ppc ? packs / ppc : 0
          },
        },
        {
          key: 'calc_labels', label: '# of Labels Required', type: 'computed', dp: 0,
          compute: s => { const b = n(s.bags_per_roll); return b ? (n(s.bags_needed) / b) * n(s.labels_per_roll) : 0 },
        },
      ],
    },
  ],
}

// ── Straw Extrusion / Straw Conversion (OP_004 REV_A) ────────────────────────

function strawForm(title: string, qtyLabel: string): FormDef {
  return {
    title,
    docCode: 'OP_004 REV_A',
    sections: [
      HEADER,
      { columns: 2, fields: [{ key: 'straw_quantity', label: qtyLabel, type: 'text', placeholder: '200 cs' }] },
      {
        columns: 2,
        fields: [
          { key: 'inner_diameter_mm', label: 'Inner Diameter (mm)', type: 'number' },
          { key: 'straw_color', label: 'Straw Color', type: 'text' },
          { key: 'straw_length_in', label: 'Straw Length (in)', type: 'number' },
          { key: 'wrapper', label: 'Wrapper', type: 'select', options: ['yes', 'no'] },
          { key: 'wall_thickness_mm', label: 'Wall Thickness (mm)', type: 'number' },
          { key: 'wrapper_print', label: 'Wrapper Print', type: 'text' },
          { key: 'straw_weight_g', label: 'Straw Weight (g)', type: 'number' },
          { key: 'print_color', label: 'Print Color', type: 'text' },
          { key: 'print_plate', label: 'Print Plate', type: 'text' },
        ],
      },
      materials([
        { key: 'material_1', label: 'Material 1' },
        { key: 'material_2', label: 'Material 2' },
        { key: 'material_3', label: 'Material 3' },
        { key: 'color_material', label: 'Color Material' },
      ]),
      SPECIAL_NOTES,
      {
        title: 'Production Calculator',
        columns: 2,
        fields: [
          { key: 'cycle_time_m_min', label: 'Ext. Cycle Time (M/Min)', type: 'number' },
          { key: 'straws_needed', label: 'Straws Needed', type: 'number' },
          { key: 'calc_blown_film_m', label: 'Blown Film (M)', type: 'computed', dp: 1, compute: s => n(s.straws_needed) * n(s.straw_length_in) * IN_TO_M },
          {
            key: 'calc_production_hours', label: 'Production Hours', type: 'computed', dp: 3,
            compute: s => { const c = n(s.cycle_time_m_min); return c ? (n(s.straws_needed) * n(s.straw_length_in) * IN_TO_M) / c / 60 : 0 },
          },
          { key: 'calc_mat1_lb', label: 'Material 1 Req. (lb)', type: 'computed', dp: 2, compute: s => n(s.straws_needed) * n(s.straw_weight_g) * pct(s.material_1_pct) * G_TO_LB },
          { key: 'calc_mat2_lb', label: 'Material 2 Req. (lb)', type: 'computed', dp: 2, compute: s => n(s.straws_needed) * n(s.straw_weight_g) * pct(s.material_2_pct) * G_TO_LB },
          { key: 'calc_color_lb', label: 'Color Mat. Req. (lb)', type: 'computed', dp: 2, compute: s => n(s.straws_needed) * n(s.straw_weight_g) * pct(s.color_material_pct) * G_TO_LB },
        ],
      },
    ],
  }
}

const STRAW_EXTRUSION = strawForm('Straw Extrusion Work Order', 'Straw Quantity')
const STRAW_CONVERSION = strawForm('Straw Conversion Work Order', 'Straw Quantity')

// ── Generic (groups whose printed sheet has not been supplied yet) ───────────

const GENERIC: FormDef = {
  title: 'Work Order',
  docCode: 'awaiting printed form',
  sections: [
    HEADER,
    {
      columns: 2,
      fields: [
        { key: 'wo_qty', label: 'Quantity', type: 'number' },
        { key: 'uom', label: 'UOM', type: 'select', options: ['Pks', 'Pcs', 'Cs', 'Ea', 'Lbs'] },
        { key: 'material_1_type', label: 'Material In', type: 'text' },
        { key: 'material_2_type', label: 'Material Out', type: 'text' },
      ],
    },
    SPECIAL_NOTES,
  ],
}

export type FormType =
  | 'molding' | 'blown_film_extrusion' | 'conversion'
  | 'straw_extrusion' | 'straw_conversion' | 'generic'

export const FORMS: Record<FormType, FormDef> = {
  molding: MOLDING,
  blown_film_extrusion: BLOWN_FILM_EXTRUSION,
  conversion: CONVERSION,
  straw_extrusion: STRAW_EXTRUSION,
  straw_conversion: STRAW_CONVERSION,
  generic: GENERIC,
}

export interface GroupDef {
  name: string
  form: FormType
  /** machines.equipment_group values that belong to this tile, best match first */
  machineGroups: string[]
  /** short code used when the work order number is generated */
  code: string
  accent: string
}

export const GROUPS: GroupDef[] = [
  { name: 'Cutlery Molding', form: 'molding', machineGroups: ['MOLDING'], code: 'MLD', accent: '#0ea5e9' },
  { name: 'Specialty Molding', form: 'molding', machineGroups: ['MOLDING'], code: 'SMLD', accent: '#6366f1' },
  { name: 'Blown Film Extrusion', form: 'blown_film_extrusion', machineGroups: ['EXTRUDER'], code: 'EXT', accent: '#10b981' },
  { name: 'Blown Film Conversion', form: 'conversion', machineGroups: ['CONVERSION'], code: 'CON', accent: '#14b8a6' },
  { name: 'Profile Extrusion', form: 'straw_extrusion', machineGroups: ['STRAWS'], code: 'STR', accent: '#f59e0b' },
  { name: 'Straw Wrapping', form: 'straw_conversion', machineGroups: ['STRAWS'], code: 'WRP', accent: '#f97316' },
  { name: 'Straw Crimping', form: 'generic', machineGroups: ['STRAWS'], code: 'CRP', accent: '#ef4444' },
  { name: 'Cutlery Kitting', form: 'generic', machineGroups: ['MOLDING', 'MACHINES'], code: 'KIT', accent: '#8b5cf6' },
  { name: 'Material Blender', form: 'generic', machineGroups: ['MACHINES', 'WAREHOUSE EQUIPMENT'], code: 'BLN', accent: '#64748b' },
  { name: 'Material Regranulator', form: 'generic', machineGroups: ['MACHINES', 'WAREHOUSE EQUIPMENT'], code: 'RGR', accent: '#475569' },
]

export const groupByName = (name: string | null | undefined) => GROUPS.find(g => g.name === name)

export function formFor(groupName: string | null | undefined, formType?: string | null): FormDef {
  if (formType && (FORMS as any)[formType]) return (FORMS as any)[formType]
  const g = groupByName(groupName)
  return g ? FORMS[g.form] : GENERIC
}

/** 260917-MLD-1 — the shape the shop already writes by hand. */
export function nextWoCode(group: GroupDef, existing: string[], date = new Date()) {
  const y = String(date.getFullYear()).slice(2)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const stem = `${y}${m}${d}-${group.code}-`
  let seq = 1
  const used = new Set(existing.filter(Boolean))
  while (used.has(stem + seq)) seq++
  return stem + seq
}

/** Run every computed field in a form against the current spec. */
export function computeAll(form: FormDef, spec: Record<string, any>) {
  const out: Record<string, number | string> = {}
  for (const sec of form.sections) {
    for (const f of sec.fields) {
      if (f.type === 'computed' && f.compute) {
        const v = f.compute(spec)
        out[f.key] = typeof v === 'number' ? Number(v.toFixed(f.dp ?? 2)) : v
      }
    }
  }
  return out
}
