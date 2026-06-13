"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function BrokerLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/broker-portal";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/broker-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push(from);
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Incorrect password.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.brandRow}>
          <span style={styles.leaf}>‹/›</span>
          <span style={styles.brand}>beyondGREEN</span>
        </div>
        <h1 style={styles.h1}>Broker &amp; Sales Portal</h1>
        <p style={styles.sub}>Internal pricing tool. Enter your access password to continue.</p>
        <form onSubmit={submit}>
          <label style={styles.label} htmlFor="pw">Access password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            autoFocus
            autoComplete="current-password"
          />
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
            {loading ? "Checking…" : "Enter portal"}
          </button>
        </form>
        <p style={styles.foot}>Confidential — distributor &amp; high-volume pricing. Do not share outside the sales team.</p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#0E2A18", fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" },
  card: { width: 380, maxWidth: "92vw", background: "#fff", borderRadius: 14, padding: "36px 32px", boxShadow: "0 20px 60px rgba(0,0,0,.35)" },
  brandRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 22 },
  leaf: { fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#2E7D32", fontSize: 18, background: "#E8F5E9", padding: "2px 8px", borderRadius: 6 },
  brand: { fontWeight: 700, color: "#1F4E2C", fontSize: 18, letterSpacing: -0.3 },
  h1: { fontSize: 22, color: "#15331F", margin: "0 0 6px", letterSpacing: -0.4 },
  sub: { fontSize: 13.5, color: "#5b6b60", margin: "0 0 22px", lineHeight: 1.5 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#3a4a40", marginBottom: 6 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 9, border: "1.5px solid #cdd8d0", fontSize: 15, outlineColor: "#2E7D32" },
  error: { marginTop: 10, color: "#b71c1c", fontSize: 13, background: "#ffebee", padding: "8px 10px", borderRadius: 8 },
  btn: { marginTop: 16, width: "100%", padding: "12px", borderRadius: 9, border: "none", background: "#1F4E2C", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  foot: { marginTop: 22, fontSize: 11, color: "#90a096", lineHeight: 1.5 },
};
