/**
 * User preferences store — backs the design-system tweaks
 * (theme, accent, fontPair, density, layout, graphPosition).
 *
 * Persisted to localStorage. The store applies its own DOM side-effects
 * via `applyPrefs(prefs)` — call once on app boot and again whenever
 * a pref changes.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Theme = "dark" | "light";
export type Accent = "violet" | "cyan" | "green" | "amber" | "rose";
export type FontPair = "jetbrains-inter" | "ibm-inter" | "jetbrains-serif" | "mono-only";
export type Density = "compact" | "cozy" | "comfy";
export type EditorLayout = "edit" | "split" | "preview";
export type GraphPosition = "right" | "hidden";

export interface Prefs {
  theme: Theme;
  accent: Accent;
  fontPair: FontPair;
  density: Density;
  layout: EditorLayout;
  graphPosition: GraphPosition;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  accent: "violet",
  fontPair: "jetbrains-inter",
  density: "compact",
  layout: "split",
  graphPosition: "right",
};

const FONT_PAIRS: Record<FontPair, { mono: string; sans: string; display: string }> = {
  "jetbrains-inter": {
    mono: "'JetBrains Mono', ui-monospace, monospace",
    sans: "'Inter', ui-sans-serif, system-ui, sans-serif",
    display: "'JetBrains Mono', ui-monospace, monospace",
  },
  "ibm-inter": {
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    sans: "'Inter', ui-sans-serif, system-ui, sans-serif",
    display: "'IBM Plex Mono', ui-monospace, monospace",
  },
  "jetbrains-serif": {
    mono: "'JetBrains Mono', ui-monospace, monospace",
    sans: "'Inter', ui-sans-serif, system-ui, sans-serif",
    display: "'Instrument Serif', Georgia, serif",
  },
  "mono-only": {
    mono: "'JetBrains Mono', ui-monospace, monospace",
    sans: "'JetBrains Mono', ui-monospace, monospace",
    display: "'JetBrains Mono', ui-monospace, monospace",
  },
};

export function applyPrefs(prefs: Prefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.dataset.accent = prefs.accent;
  root.dataset.density = prefs.density;
  if (prefs.theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  const fp = FONT_PAIRS[prefs.fontPair] ?? FONT_PAIRS["jetbrains-inter"];
  root.style.setProperty("--font-mono", fp.mono);
  root.style.setProperty("--font-sans", fp.sans);
  root.style.setProperty("--font-display", fp.display);
}

interface PrefsState extends Prefs {
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  reset(): void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      setPref: (key, value) =>
        set((state) => {
          const next = { ...state, [key]: value };
          applyPrefs(next);
          return next;
        }),
      reset: () => {
        applyPrefs(DEFAULT_PREFS);
        set(DEFAULT_PREFS);
      },
    }),
    {
      name: "kryton-prefs",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) applyPrefs(state);
      },
    },
  ),
);
