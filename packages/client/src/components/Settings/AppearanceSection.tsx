/**
 * Appearance pane — surfaces the design-system tweaks (theme, accent,
 * font pair, density, layout, graph position) inside Account Settings.
 *
 * The handoff README says the floating "Tweaks" panel from the prototype
 * does NOT ship; the same options live here instead.
 */
import type { CSSProperties, ReactNode } from "react";
import { usePrefs, type Accent, type Density, type EditorLayout, type FontPair, type GraphPosition, type Theme } from "../../stores/prefsStore";

const sectionTitle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--fg-3)",
  marginBottom: 10,
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--fg-3)",
  textTransform: "lowercase",
  letterSpacing: "0.06em",
};

interface OptionPillProps<T> {
  value: T;
  current: T;
  onChange: (v: T) => void;
  label: string;
}

function OptionPill<T extends string>({ value, current, onChange, label }: OptionPillProps<T>) {
  const active = value === current;
  return (
    <button
      onClick={() => onChange(value)}
      className="mono"
      style={{
        padding: "6px 12px",
        borderRadius: 5,
        border: "1px solid var(--line)",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--fg-2)",
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        transition: "background 120ms, color 120ms",
      }}
    >
      {label}
    </button>
  );
}

const ACCENT_SWATCHES: Record<Accent, string> = {
  violet: "#a78bfa",
  cyan: "#5cc7d6",
  green: "#5fce99",
  amber: "#e0a557",
  rose: "#e36d7e",
};

function AccentRow({ value, onChange }: { value: Accent; onChange: (v: Accent) => void }) {
  const accents: Accent[] = ["violet", "cyan", "green", "amber", "rose"];
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {accents.map((a) => (
        <button
          key={a}
          onClick={() => onChange(a)}
          aria-label={`Accent ${a}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `2px solid ${value === a ? "var(--fg-1)" : "transparent"}`,
            background: ACCENT_SWATCHES[a],
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}

function Field({ children, label }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

const FONT_LABELS: Record<FontPair, string> = {
  "jetbrains-inter": "JetBrains + Inter",
  "ibm-inter": "IBM Plex + Inter",
  "jetbrains-serif": "JetBrains + Serif",
  "mono-only": "Mono only",
};

export function AppearanceSection() {
  const { theme, accent, fontPair, density, layout, graphPosition, setPref, reset } = usePrefs();

  return (
    <div style={{ color: "var(--fg-1)" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={sectionTitle}>// appearance</div>
        <Field label="theme">
          {(["dark", "light"] as Theme[]).map((v) => (
            <OptionPill<Theme>
              key={v}
              value={v}
              current={theme}
              onChange={(x) => setPref("theme", x)}
              label={v}
            />
          ))}
        </Field>
        <Field label="accent">
          <AccentRow value={accent} onChange={(v) => setPref("accent", v)} />
        </Field>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={sectionTitle}>// typography</div>
        <Field label="fonts">
          {(Object.keys(FONT_LABELS) as FontPair[]).map((v) => (
            <OptionPill<FontPair>
              key={v}
              value={v}
              current={fontPair}
              onChange={(x) => setPref("fontPair", x)}
              label={FONT_LABELS[v]}
            />
          ))}
        </Field>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={sectionTitle}>// layout</div>
        <Field label="editor mode">
          {(["edit", "split", "preview"] as EditorLayout[]).map((v) => (
            <OptionPill<EditorLayout>
              key={v}
              value={v}
              current={layout}
              onChange={(x) => setPref("layout", x)}
              label={v}
            />
          ))}
        </Field>
        <Field label="density">
          {(["compact", "cozy", "comfy"] as Density[]).map((v) => (
            <OptionPill<Density>
              key={v}
              value={v}
              current={density}
              onChange={(x) => setPref("density", x)}
              label={v}
            />
          ))}
        </Field>
        <Field label="graph rail">
          {(["right", "hidden"] as GraphPosition[]).map((v) => (
            <OptionPill<GraphPosition>
              key={v}
              value={v}
              current={graphPosition}
              onChange={(x) => setPref("graphPosition", x)}
              label={v === "right" ? "side" : "hidden"}
            />
          ))}
        </Field>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 8 }}>
        <button
          onClick={reset}
          className="mono"
          style={{
            padding: "6px 12px",
            borderRadius: 5,
            border: "1px dashed var(--line-strong)",
            background: "transparent",
            color: "var(--fg-3)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          reset to defaults
        </button>
      </div>
    </div>
  );
}
