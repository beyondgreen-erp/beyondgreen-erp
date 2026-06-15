"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ITEMS, ENGINE, MARGIN_TIERS, computeLanded, competitorChinaLanded,
  sellAtMargin, marginAtPrice, bidToWin, fmtUSD, type SkuItem, type Origin,
} from "@/lib/brokerEngine";
import EditDrawer, { loadCatalogItems, type Row } from "./EditDrawer";
import EnterpriseFeatures from "./EnterpriseFeatures"

const ORIGINS: Origin[] = ["USA", "INDIA", "CHINA"];

function winColor(label: string | null): { bg: string; fg: string } {
  const s = (label || "").toUpperCase();
  if (s.startsWith("STRONG")) return { bg: "#C8E6C9", fg: "#1B5E20" };
  if (s.startsWith("MODERATE")) return { bg: "#FFF3C4", fg: "#7B6000" };
  if (s.startsWith("WEAK")) return { bg: "#FFCDD2", fg: "#B71C1C" };
  return { bg: "#eceff1", fg: "#546e7a" };
}

export default function PortalClient({ initialItems }: { initialItems: Row[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [origin, setOrigin] = useState("All");
  const [win, setWin] = useState("All");
  const [selected, setSelected] = useState<SkuItem | null>(null);
  const [items, setItems] = useState<Row[]>(initialItems);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let active = true;
    loadCatalogItems()
      .then(({ items: rows, canEdit: ce }) => {
        if (!active) return;
        setCanEdit(ce);
        if (rows.length) setItems(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [bump]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(ITEMS.map((i) => i.category))).sort()],
    []
  );

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter((i) => {
      if (cat !== "All" && i.category !== cat) return false;
      if (origin !== "All" && i.origin !== origin) return false;
      if (win !== "All" && !(i.winLikelihood || "").toUpperCase().startsWith(win)) return false;
      if (ql) {
        const hay = `${i.sku} ${i.description} ${i.variation ?? ""} ${i.hts ?? ""} ${i.upc ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    }).slice(0, 600);
  }, [items, q, cat, origin, win]);

  const strong = useMemo(() => ITEMS.filter((i) => (i.winLikelihood || "").toUpperCase().startsWith("STRONG")).length, []);

  async function logout() {
    await fetch("/api/professional/logout", { method: "POST" });
    router.push("/professional/login");
    router.refresh();
  }

  function exportCSV() {
    const data = items as unknown as Array<Record<string, unknown>>;
    if (!data.length) return;
    const keys = Array.from(
      data.reduce((set: Set<string>, it) => {
        Object.keys(it).forEach((k) => set.add(k));
        return set;
      }, new Set<string>())
    );
    const esc = (v: unknown) => {
      const s =
        v === null || v === undefined
          ? ""
          : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [keys.join(",")];
    for (const it of data) lines.push(keys.map((k) => esc(it[k])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `beyondGREEN-Professional-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div style={S.brandRow}>
          <span style={S.leaf}>‹/›</span>
          <div>
      <div style={S.brand}>beyondGREEN Professional</div>
            <div style={S.tagline}>Landed cost &amp; bid pricing · {items.length} SKUs · rates as of {ENGINE.asOf}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{canEdit && (<button onClick={() => setAdding(true)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#1565c0", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add product</button>)}<button onClick={exportCSV} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#2E7D32", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Export CSV</button><button onClick={logout} style={S.logout}>Sign out</button></div>
      </header>

      <div style={S.statRow}>
        <Stat label="SKUs" value={ITEMS.length.toString()} />
        <Stat label="Strong-win SKUs" value={strong.toString()} accent="#2E7D32" />
        <Stat label="China ocean / 40HQ" value={fmtUSD(ENGINE.oceanChina, 0)} />
        <Stat label="Paper-bag AD/CVD (China)" value={`${ENGINE.adcvd["PAPERBAG-HANDLE"].CHINA}%`} accent="#B71C1C" />
        <Stat label="Paper-bag AD/CVD (India)" value={`${ENGINE.adcvd["PAPERBAG-HANDLE"].INDIA}%`} accent="#2E7D32" />
      </div>

      <div style={S.controls}>
        <input
          placeholder="Search SKU, description, HTS, UPC…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={S.search}
        />
        <Select label="Category" value={cat} onChange={setCat} options={categories} />
        <Select label="Origin" value={origin} onChange={setOrigin} options={["All", ...ORIGINS]} />
        <Select label="Win" value={win} onChange={setWin} options={["All", "STRONG", "MODERATE", "WEAK"]} />
        <span style={S.count}>{rows.length} shown</span>
      </div>

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              {["SKU", "Description", "Origin", "FOB / case", "Landed / case", "Landed / unit", "Win likelihood", ""].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const wc = winColor(i.winLikelihood);
              return (
                <tr key={i.sku} style={S.tr}>
                  <td style={{ ...S.td, fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>{i.sku}</td>
                  <td style={S.td}>
                    <div>{i.description}</div>
                    {i.variation && <div style={S.variation}>{i.variation}</div>}
                  </td>
                  <td style={S.td}>{i.origin || "—"}</td>
                  <td style={S.tdNum}>{fmtUSD(i.fob)}</td>
                  <td style={{ ...S.tdNum, fontWeight: 700 }}>{fmtUSD(i.landed)}</td>
                  <td style={S.tdNum}>{i.landedUnit ? fmtUSD(i.landedUnit, 4) : "—"}</td>
                  <td style={S.td}>
                    <span style={{ ...S.badge, background: wc.bg, color: wc.fg }}>{i.winLikelihood || "—"}</span>
                  </td>
                  <td style={S.td}>
                    <button style={S.calcBtn} onClick={() => setSelected(i)}>Price it →</button>{canEdit && <button style={{ ...S.calcBtn, background: "#37474f", marginLeft: 6 }} onClick={() => setEditing(i)}>Edit</button>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={S.empty}>No SKUs match those filters. Clear search or pick a different category.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <CalculatorDrawer item={selected} onClose={() => setSelected(null)} />}
      {(adding || editing) && (
        <EditDrawer item={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { setAdding(false); setEditing(null); setBump((b) => b + 1); }} />
      )}
      <footer style={S.footer}>
        Confidential — internal pricing. AD/CVD rates are producer-specific; confirm beyondGREEN Paras&apos;s exact India rate and all tariffs with the customs broker before quoting.
      </footer>
    </div>
  );
}

function CalculatorDrawer({ item, onClose }: { item: SkuItem; onClose: () => void }) {
  const [fob, setFob] = useState<number>(item.fob ?? 0);
  const [origin, setOrigin] = useState<Origin>((item.origin as Origin) || "INDIA");
  const [benchmark, setBenchmark] = useState<number>(0);

  const b = computeLanded({
    fob, origin, caseCuFt: item.caseCuFt, dutyCat: item.dutyCat,
    adcvdScope: item.adcvdScope, qtyCase: item.qtyCase,
  });
  const compChina = competitorChinaLanded({
    fob, caseCuFt: item.caseCuFt, dutyCat: item.dutyCat, adcvdScope: item.adcvdScope,
  });
  const edge = compChina ? ((compChina - b.landed) / compChina) * 100 : 0;
  const win = benchmark ? bidToWin(benchmark) : 0;
  const winMargin = benchmark ? marginAtPrice(b.landed, win) : 0;

  return (
    <>
      <div style={S.scrim} onClick={onClose} />
      <aside style={S.drawer}>
        <div style={S.drawerHead}>
          <div>
            <div style={S.drawerSku}>{item.sku}</div>
            <div style={S.drawerDesc}>{item.description}</div>
          </div>
          <button style={S.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={S.metaGrid}>
          <Meta label="HTS / HS" value={item.hts || "—"} />
          <Meta label="Duty category" value={item.dutyCat} />
          <Meta label="AD/CVD scope" value={item.adcvdScope || "none"} />
          <Meta label="Qty / case" value={item.qtyCase?.toLocaleString() || "—"} />
          <Meta label="Case cu ft" value={item.caseCuFt?.toString() || "—"} />
          <Meta label="Cases / pallet" value={item.casesPallet?.toString() || "—"} />
        </div>

        <div style={S.inputRow}>
          <div style={{ flex: 1 }}>
            <label style={S.inLabel}>FOB cost / case ($)</label>
            <input type="number" step="0.01" value={fob} onChange={(e) => setFob(parseFloat(e.target.value) || 0)} style={S.inField} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={S.inLabel}>Origin</label>
            <select value={origin} onChange={(e) => setOrigin(e.target.value as Origin)} style={S.inField}>
              {ORIGINS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div style={S.section}>Landed cost breakdown (per case)</div>
        <Line label="FOB" v={b.fob} />
        <Line label="Origin inland" v={b.originInland} />
        <Line label="Ocean freight" v={b.ocean} />
        <Line label="Drayage + dest" v={b.drayage} />
        <Line label={`Base duty (${b.dutyPct}%)`} v={b.fob * b.dutyPct / 100} />
        <Line label={`AD/CVD (${b.adcvdPct}%)`} v={b.fob * b.adcvdPct / 100} danger={b.adcvdPct > 0} />
        <Line label="Customs fees (MPF+HMF)" v={b.customsFees} />
        <div style={S.totalLine}>
          <span>TOTAL LANDED / case</span><span>{fmtUSD(b.landed)}</span>
        </div>
        <div style={S.unitLine}>
          <span>Landed / unit</span><span>{fmtUSD(b.landedUnit, 4)}</span>
        </div>

        <div style={S.edgeBox}>
          <div style={S.edgeRow}><span>If a competitor sourced this from China:</span><strong>{fmtUSD(compChina)}</strong></div>
          <div style={S.edgeRow}>
            <span>Your cost edge vs China:</span>
            <strong style={{ color: edge > 0 ? "#1B5E20" : "#B71C1C" }}>{edge.toFixed(1)}%</strong>
          </div>
          {edge > 25 && <div style={S.edgeNote}>Strong structural advantage — you can underprice China importers and still hold margin.</div>}
        </div>

        <div style={S.section}>Sell price by gross margin</div>
        <div style={S.marginGrid}>
          {MARGIN_TIERS.map((m) => (
            <div key={m} style={S.marginCell}>
              <div style={S.marginPct}>{m}%</div>
              <div style={S.marginVal}>{fmtUSD(sellAtMargin(b.landed, m))}</div>
            </div>
          ))}
        </div>

        <div style={S.section}>Bid-to-win calculator</div>
        <div style={S.inputRow}>
          <div style={{ flex: 1 }}>
            <label style={S.inLabel}>Competitor price / case ($)</label>
            <input type="number" step="0.01" value={benchmark || ""} onChange={(e) => setBenchmark(parseFloat(e.target.value) || 0)} style={S.inField} placeholder="enter benchmark" />
          </div>
        </div>
        {benchmark > 0 && (
          <div style={S.bidBox}>
            <div style={S.edgeRow}><span>Bid to win (undercut {ENGINE.undercutPct}%):</span><strong>{fmtUSD(win)}</strong></div>
            <div style={S.edgeRow}>
              <span>Your margin at that price:</span>
              <strong style={{ color: winMargin >= 20 ? "#1B5E20" : winMargin >= 0 ? "#7B6000" : "#B71C1C" }}>{winMargin.toFixed(1)}%</strong>
            </div>
            {winMargin < 0 && <div style={{ ...S.edgeNote, color: "#B71C1C" }}>Below cost — do not bid at this level.</div>}
          </div>
        )}
      </aside>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={S.stat}>
      <div style={{ ...S.statVal, color: accent || "#15331F" }}>{value}</div>
      <div style={S.statLabel}>{label}</div>
      <EnterpriseFeatures onConfirmSaved={()=>setBump(b=>b+1)} />
    </div>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label style={S.selWrap}>
      <span style={S.selLabel}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={S.sel}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div style={S.meta}><div style={S.metaLabel}>{label}</div><div style={S.metaVal}>{value}</div></div>;
}
function Line({ label, v, danger }: { label: string; v: number; danger?: boolean }) {
  return <div style={S.line}><span style={{ color: danger ? "#B71C1C" : "#46564b" }}>{label}</span><span>{fmtUSD(v)}</span></div>;
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial", background: "#F3F6F2", minHeight: "100vh", color: "#15331F" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: "#1F4E2C", color: "#fff" },
  brandRow: { display: "flex", alignItems: "center", gap: 12 },
  leaf: { fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#1F4E2C", background: "#C8E6C9", padding: "4px 9px", borderRadius: 7, fontSize: 16 },
  brand: { fontWeight: 700, fontSize: 17, letterSpacing: -0.3 },
  tagline: { fontSize: 12, color: "#bcd6c2", marginTop: 2 },
  logout: { background: "rgba(255,255,255,.12)", color: "#fff", border: "1px solid rgba(255,255,255,.25)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13 },
  statRow: { display: "flex", gap: 12, flexWrap: "wrap", padding: "18px 24px 4px" },
  stat: { background: "#fff", borderRadius: 11, padding: "12px 18px", minWidth: 150, boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
  statVal: { fontSize: 22, fontWeight: 700, letterSpacing: -0.5 },
  statLabel: { fontSize: 11.5, color: "#6b7c70", marginTop: 2 },
  controls: { display: "flex", gap: 12, alignItems: "flex-end", padding: "14px 24px", flexWrap: "wrap" },
  search: { flex: "1 1 280px", padding: "10px 13px", borderRadius: 9, border: "1.5px solid #cdd8d0", fontSize: 14 },
  selWrap: { display: "flex", flexDirection: "column", gap: 4 },
  selLabel: { fontSize: 11, color: "#6b7c70", fontWeight: 600 },
  sel: { padding: "9px 11px", borderRadius: 9, border: "1.5px solid #cdd8d0", fontSize: 14, background: "#fff" },
  count: { fontSize: 12.5, color: "#6b7c70", alignSelf: "center" },
  tableWrap: { margin: "0 24px 20px", background: "#fff", borderRadius: 12, overflow: "auto", boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "11px 14px", background: "#2E7D32", color: "#fff", fontWeight: 600, fontSize: 12, position: "sticky", top: 0, whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #eef2ee" },
  td: { padding: "10px 14px", verticalAlign: "top" },
  tdNum: { padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  variation: { fontSize: 11.5, color: "#7a8a7f", marginTop: 2 },
  badge: { display: "inline-block", padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" },
  calcBtn: { background: "#1F4E2C", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" },
  empty: { padding: 40, textAlign: "center", color: "#7a8a7f" },
  footer: { padding: "8px 24px 28px", fontSize: 11, color: "#90a096", maxWidth: 900 },
  scrim: { position: "fixed", inset: 0, background: "rgba(10,25,16,.45)", zIndex: 40 },
  drawer: { position: "fixed", top: 0, right: 0, height: "100vh", width: 460, maxWidth: "94vw", background: "#fff", boxShadow: "-10px 0 40px rgba(0,0,0,.25)", zIndex: 50, overflowY: "auto", padding: "22px 24px 60px" },
  drawerHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 },
  drawerSku: { fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 16, color: "#1F4E2C" },
  drawerDesc: { fontSize: 13, color: "#46564b", marginTop: 3, lineHeight: 1.4 },
  close: { background: "#eef2ee", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 14, flexShrink: 0 },
  metaGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 },
  meta: { background: "#F3F6F2", borderRadius: 8, padding: "8px 10px" },
  metaLabel: { fontSize: 10.5, color: "#7a8a7f", fontWeight: 600 },
  metaVal: { fontSize: 13, fontWeight: 600, marginTop: 2, wordBreak: "break-word" },
  inputRow: { display: "flex", gap: 12, marginBottom: 6 },
  inLabel: { display: "block", fontSize: 11.5, color: "#46564b", fontWeight: 600, marginBottom: 5 },
  inField: { width: "100%", boxSizing: "border-box", padding: "10px 11px", borderRadius: 9, border: "1.5px solid #cdd8d0", fontSize: 14 },
  section: { marginTop: 20, marginBottom: 10, fontSize: 12, fontWeight: 700, color: "#1F4E2C", textTransform: "uppercase", letterSpacing: 0.4 },
  line: { display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13.5, borderBottom: "1px dashed #e6ece6", fontVariantNumeric: "tabular-nums" },
  totalLine: { display: "flex", justifyContent: "space-between", padding: "11px 0 4px", fontSize: 15, fontWeight: 800, color: "#15331F", borderTop: "2px solid #1F4E2C", marginTop: 4 },
  unitLine: { display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 12.5, color: "#6b7c70" },
  edgeBox: { background: "#EDE7F6", borderRadius: 10, padding: "12px 14px", marginTop: 16 },
  edgeRow: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" },
  edgeNote: { fontSize: 11.5, color: "#1B5E20", marginTop: 6, lineHeight: 1.4 },
  marginGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 },
  marginCell: { background: "#E8EAF6", borderRadius: 8, padding: "9px 6px", textAlign: "center" },
  marginPct: { fontSize: 12, fontWeight: 700, color: "#1A237E" },
  marginVal: { fontSize: 13, fontWeight: 600, marginTop: 3, fontVariantNumeric: "tabular-nums" },
  bidBox: { background: "#E8F5E9", borderRadius: 10, padding: "12px 14px", marginTop: 8 },
};
