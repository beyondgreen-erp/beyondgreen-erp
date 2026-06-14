"use client";

import { useState, type CSSProperties } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { SkuItem } from "@/lib/brokerEngine";

export type Row = SkuItem & { id?: string };

type Field = { key: keyof SkuItem; col: string; label: string; num?: boolean };

const FIELDS: Field[] = [
  { key: "sku", col: "sku", label: "SKU" },
  { key: "category", col: "category", label: "Category" },
  { key: "description", col: "description", label: "Description" },
  { key: "variation", col: "variation", label: "Variation" },
  { key: "upc", col: "upc", label: "UPC" },
  { key: "origin", col: "origin", label: "Origin (USA / INDIA / CHINA)" },
  { key: "mfgType", col: "mfg_type", label: "Mfg Type" },
  { key: "material", col: "material", label: "Material" },
  { key: "hts", col: "hts", label: "HTS" },
  { key: "dutyCat", col: "duty_cat", label: "Duty Category" },
  { key: "adcvdScope", col: "adcvd_scope", label: "AD/CVD Scope" },
  { key: "fob", col: "fob", label: "FOB ($)", num: true },
  { key: "landed", col: "landed", label: "Landed ($)", num: true },
  { key: "landedUnit", col: "landed_unit", label: "Landed / Unit ($)", num: true },
  { key: "qtyCase", col: "qty_case", label: "Qty / Case", num: true },
  { key: "caseGrossWt", col: "case_gross_wt", label: "Case Gross Wt", num: true },
  { key: "caseDims", col: "case_dims", label: "Case Dims" },
  { key: "caseCuFt", col: "case_cu_ft", label: "Case CuFt", num: true },
  { key: "casesPallet", col: "cases_pallet", label: "Cases / Pallet", num: true },
  { key: "palletNetWt", col: "pallet_net_wt", label: "Pallet Net Wt", num: true },
  { key: "palletHt", col: "pallet_ht", label: "Pallet Ht", num: true },
  { key: "winLikelihood", col: "win_likelihood", label: "Win Likelihood" },
  { key: "moq", col: "moq", label: "MOQ" },
  { key: "notes", col: "notes", label: "Notes" },
];

export function fromRow(r: Record<string, unknown>): Row {
  const o: Record<string, unknown> = { id: r.id };
  for (const f of FIELDS) o[f.key] = r[f.col] ?? null;
  return o as unknown as Row;
}

export async function loadCatalogItems(): Promise<{ items: Row[]; canEdit: boolean }> {
  const sb = createSupabaseBrowserClient();
  const [{ data: u }, res] = await Promise.all([
    sb.auth.getUser(),
    sb.from("professional_catalog").select("*").order("category").order("sku"),
  ]);
  const rows = (!res.error && res.data ? res.data : []) as Record<string, unknown>[];
  return { items: rows.map(fromRow), canEdit: !!u.user };
}

export default function EditDrawer({
  item,
  onClose,
  onSaved,
}: {
  item: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const fl of FIELDS) {
      const v = item ? (item as unknown as Record<string, unknown>)[fl.key] : null;
      f[fl.key] = v == null ? "" : String(v);
    }
    return f;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true);
    setErr("");
    const sb = createSupabaseBrowserClient();
    const row: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const raw = (form[f.key] || "").trim();
      row[f.col] = raw === "" ? null : f.num ? Number(raw) : raw;
    }
    const resp = item?.id
      ? await sb.from("professional_catalog").update({ ...row, updated_at: new Date().toISOString() }).eq("id", item.id)
      : await sb.from("professional_catalog").insert(row);
    setSaving(false);
    if (resp.error) {
      setErr(resp.error.message);
      return;
    }
    onSaved();
  }

  return (
    <>
      <div style={scrim} onClick={onClose} />
      <aside style={drawer}>
        <div style={head}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item ? "Edit product" : "Add product"}</div>
          <button onClick={onClose} style={xBtn}>X</button>
        </div>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          {FIELDS.map((f) => (
            <label key={f.key} style={{ display: "block", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "#546e7a", display: "block", marginBottom: 3 }}>{f.label}</span>
              <input
                value={form[f.key]}
                inputMode={f.num ? "decimal" : undefined}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                style={inputStyle}
              />
            </label>
          ))}
          {err && <div style={{ color: "#b71c1c", fontSize: 12, marginBottom: 8 }}>{err}</div>}
        </div>
        <div style={footer}>
          <button onClick={save} disabled={saving} style={saveBtn}>{saving ? "Saving..." : "Save"}</button>
          <button onClick={onClose} style={cancelBtn}>Cancel</button>
        </div>
      </aside>
    </>
  );
}

const scrim: CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50 };
const drawer: CSSProperties = { position: "fixed", top: 0, right: 0, height: "100%", width: 440, maxWidth: "92vw", background: "#fff", zIndex: 51, display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" };
const head: CSSProperties = { padding: 16, borderBottom: "1px solid #eceff1", display: "flex", justifyContent: "space-between", alignItems: "center" };
const footer: CSSProperties = { padding: 16, borderTop: "1px solid #eceff1", display: "flex", gap: 8 };
const xBtn: CSSProperties = { border: "none", background: "none", fontSize: 16, cursor: "pointer", color: "#546e7a" };
const inputStyle: CSSProperties = { width: "100%", padding: "7px 9px", border: "1px solid #cfd8dc", borderRadius: 6, fontSize: 13, boxSizing: "border-box" };
const saveBtn: CSSProperties = { padding: "9px 18px", border: "none", borderRadius: 8, background: "#2E7D32", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const cancelBtn: CSSProperties = { padding: "9px 18px", border: "1px solid #cfd8dc", borderRadius: 8, background: "#fff", color: "#37474f", fontWeight: 600, fontSize: 13, cursor: "pointer" };
