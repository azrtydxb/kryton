/**
 * Settings-pane visual primitives — components.
 *
 * Style constants live in ./settings-kit-styles.ts so this file can export
 * components alone (react-refresh/only-export-components).
 *
 * The look mirrors AppearanceSection (the design-guide gold standard):
 *   • Section title:  `// label` mono 10.5px 0.08em uppercase fg-3
 *   • Field label:    mono 11px 0.06em lowercase fg-3
 *   • Sections always flow left — no flex-1 stretching, no centred buttons.
 */
import type { ReactNode } from "react";
import { sectionTitle, fieldLabel } from "./settings-kit-styles";

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
