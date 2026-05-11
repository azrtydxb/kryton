/**
 * Settings-pane visual primitives — style constants only.
 *
 * Split from settings-kit.tsx so that file can export components alone
 * (react-refresh/only-export-components requires that). The look mirrors
 * AppearanceSection — see settings-kit.tsx header for the design notes.
 */
import type { CSSProperties } from "react";

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
