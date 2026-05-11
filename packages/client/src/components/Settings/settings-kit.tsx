/**
 * Settings-pane visual primitives — extracted so every section inside
 * Account Settings reads with the same vibe as the AppearanceSection
 * (which the user explicitly named as the design-guide gold standard).
 *
 * The look mirrors AppearanceSection lines 11-56:
 *   • Section title:  `// label` mono 10.5px 0.08em uppercase fg-3
 *   • Field label:    mono 11px 0.06em lowercase fg-3
 *   • Pill button:    6/12 padding, radius 5, 1px line border,
 *                     accent-soft bg + accent text when active
 *   • Input:          bg-2, line border, fg text, focus ring via accent-soft
 *   • Primary CTA:    accent bg + #fff text, 8/16 padding, radius 5
 *   • Ghost / danger: dashed line-strong border, transparent bg
 *
 * Sections always flow left — no flex-1 stretching, no centred buttons.
 */
import type { CSSProperties, ReactNode } from "react";

export const sectionTitle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--fg-3)",
  marginBottom: 10,
};

export const fieldLabel: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--fg-3)",
  textTransform: "lowercase",
  letterSpacing: "0.06em",
};

export const helpText: CSSProperties = {
  fontSize: 12,
  color: "var(--fg-3)",
  marginBottom: 12,
  lineHeight: 1.5,
};

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  background: "var(--bg-2)",
  border: "1px solid var(--line)",
  borderRadius: 5,
  color: "var(--fg)",
  outline: "none",
};

export const primaryBtn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 5,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  transition: "background 120ms, opacity 120ms",
};

export const ghostBtn: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 5,
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--fg-2)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  transition: "background 120ms, color 120ms",
};

export const dangerBtn: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 5,
  border: "1px dashed color-mix(in oklch, var(--accent-danger) 50%, transparent)",
  background: "transparent",
  color: "var(--accent-danger)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
};

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionTitle}>{`// ${title}`}</div>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
      {children}
    </div>
  );
}
