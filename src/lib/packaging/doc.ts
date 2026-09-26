/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ProofInfo } from './proofTemplate'
// Packaging design document model + persistence helpers.
// A design lives in the private `packaging` storage bucket:
//   designs/{id}/current.json      – the live working file (autosaved)
//   designs/{id}/thumb.png         – preview thumbnail
//   designs/{id}/assets/{hash}.png – placed images (referenced as "asset:<path>" in JSON)
//   designs/{id}/versions/{n}.json – saved versions
//   designs/{id}/final/...         – exported final files
export const BUCKET = 'packaging'

export interface DocLayer { id: string; name: string; visible: boolean; locked: boolean; color: string; kind?: 'dieline' | 'art' }
export interface Swatch { name: string; hex: string; cmyk?: [number, number, number, number]; spot?: string }

export interface DesignDoc {
  version: 1
  width: number    // pt
  height: number   // pt
  unit: 'in' | 'mm' | 'pt'
  layers: DocLayer[] // top → bottom
  activeLayerId: string
  swatches: Swatch[]
  objects: any[]   // fabric object JSON
  proof?: ProofInfo // official approval-proof sheet data (ERP snapshot)
  /** The uploaded original, stored byte-for-byte (never modified) */
  source?: { path: string; name: string; size: number; sha256: string; uploaded_at: string; uploaded_by?: string; text?: 'live' | 'outline' }
}

export interface DesignRow {
  id: string; name: string; customer_id: string | null; customer_name: string | null; sku: string | null; product_type: string | null
  status: string; width_pt: number; height_pt: number; unit: 'in' | 'mm' | 'pt'; rev: number
  doc_path: string | null; thumb_path: string | null; notes: string | null
  product_id?: string | null; proof_no?: number | null
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string
}

/** Custom properties persisted on every fabric object. */
export const OBJ_PROPS = ['id', 'layerId', 'name', 'cmykFill', 'spotFill', 'cmykStroke', 'spotStroke', 'overprint', 'lockedObj', 'assetPath', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockRotation', 'lockScalingX', 'lockScalingY', 'hasControls', 'sourceFont']

export const STATUSES = ['Draft', 'In Review', 'Printer Review', 'Approved', 'Final', 'Archived'] as const
export const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700', 'In Review': 'bg-amber-100 text-amber-800', 'Printer Review': 'bg-violet-100 text-violet-800',
  Approved: 'bg-emerald-100 text-emerald-800', Final: 'bg-blue-100 text-blue-800', Archived: 'bg-gray-200 text-gray-500',
}
export const PRODUCT_TYPES = ['Folding carton', 'Shipping box', 'Pouch / bag', 'Label', 'Sleeve', 'Header card', 'Tray', 'Other']

export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))

export const DEFAULT_SWATCHES: Swatch[] = [
  { name: 'Dieline (spot)', hex: '#EC008C', cmyk: [0, 100, 0, 0], spot: 'Dieline' },
  { name: 'Fold / Crease (spot)', hex: '#00AEEF', cmyk: [100, 0, 0, 0], spot: 'Crease' },
  { name: 'bG Green', hex: '#2ABF06', cmyk: [70, 0, 100, 0] },
  { name: 'Ink', hex: '#1F2937', cmyk: [75, 60, 45, 70] },
  { name: 'Rich Black', hex: '#0B0B0B', cmyk: [60, 40, 40, 100] },
  { name: 'Black', hex: '#231F20', cmyk: [0, 0, 0, 100] },
  { name: 'White', hex: '#FFFFFF', cmyk: [0, 0, 0, 0] },
  { name: 'Kraft', hex: '#C8A27A', cmyk: [20, 35, 55, 5] },
]

export function newDoc(width: number, height: number, unit: DesignDoc['unit']): DesignDoc {
  const art = uid(), die = uid()
  return {
    version: 1, width, height, unit,
    layers: [
      { id: die, name: 'Dieline', visible: true, locked: true, color: '#EC008C', kind: 'dieline' },
      { id: art, name: 'Artwork', visible: true, locked: false, color: '#3B6FE0', kind: 'art' },
    ],
    activeLayerId: art,
    swatches: DEFAULT_SWATCHES.slice(),
    objects: [],
  }
}

export const UNIT_PT: Record<DesignDoc['unit'], number> = { in: 72, mm: 72 / 25.4, pt: 1 }
export function fmtUnit(pt: number, unit: DesignDoc['unit'], digits = 3) {
  return +(pt / UNIT_PT[unit]).toFixed(digits)
}

export async function sha1Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-1', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function safeFileName(s: string) {
  return (s || 'design').replace(/[^\w\- .()]+/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}
