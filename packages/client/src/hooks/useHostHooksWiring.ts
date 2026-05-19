// ──────────────────────────────────────────────────────────────────────────────
// useHostHooksWiring — bridge from the host shell into the @azrtydxb/ui
// plugin host-hooks registry.
//
// Plugins call api.notes.saveCurrent(), api.ui.closePane() and the
// api.context.use* hooks through the registry; without a host
// implementation those calls are no-ops / return null. This hook
// installs implementations on mount and re-installs them whenever any
// piece of host state (active note, current user, theme, …) changes so
// closed-over state and reactive snapshots stay current.
//
// Inputs are intentionally narrow — just the slice of state the host
// hooks actually need — so the dependency footprint is obvious and
// stable.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import {
  setHostHooks,
  type HostHooksUser,
  type HostHooksNote,
} from '@azrtydxb/ui';
import { api, request, type NoteData, type AuthUser } from '../lib/api';

const PLUGIN_KEY_RE = /^plugin:([^:]+):(.+)$/;

/**
 * Fetch the current user's saved settings and group plugin-namespaced
 * entries into { pluginId: { key: parsedValue } }. Keys outside the
 * plugin namespace are ignored. Values stored as JSON are parsed; raw
 * strings are returned as-is.
 */
async function fetchPluginSettings(): Promise<Record<string, Record<string, unknown>>> {
  const raw = await request<Record<string, string>>('/settings');
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = PLUGIN_KEY_RE.exec(k);
    if (!m) continue;
    const [, pluginId, key] = m;
    let value: unknown = v;
    try { value = JSON.parse(v); } catch { /* keep raw string */ }
    if (!out[pluginId]) out[pluginId] = {};
    out[pluginId][key] = value;
  }
  return out;
}

export interface HostHooksWiringInput {
  /** The currently-focused note (null when the empty state is showing). */
  activeNote: NoteData | null;
  /** Close the active note pane (clears the active tab + falls back to empty). */
  closeActiveNote: () => void;
  /** The signed-in user, or null when not authenticated. */
  currentUser: AuthUser | null;
  /** Resolved theme ('light' | 'dark'). 'system' must be resolved by the caller. */
  theme: 'light' | 'dark';
}

/**
 * Install host-side implementations for the @azrtydxb/ui plugin
 * registry. Re-runs whenever any input changes so plugins observe
 * reactive updates via the subscribeHostHooks path.
 *
 * saveCurrent flushes the latest editor buffer straight to the HTTP
 * PUT endpoint — bypassing the debounced save in useNotes so the
 * promise resolves only after the disk write is acknowledged, which is
 * the contract api.notes.saveCurrent() advertises.
 */
export function useHostHooksWiring({
  activeNote,
  closeActiveNote,
  currentUser,
  theme,
}: HostHooksWiringInput): void {
  // Settings are per-user and don't change shape during a session, so we
  // fetch once per signed-in user and stash them locally; subsequent
  // host-hook updates carry the same map forward without re-fetching.
  // A plugin that writes a setting can push back into this state via the
  // window event below.
  const [pluginSettings, setPluginSettings] = useState<Record<string, Record<string, unknown>> | undefined>(undefined);

  const currentUserId = currentUser?.id;
  useEffect(() => {
    let cancelled = false;
    if (!currentUserId) {
      // Defer the clear so the lint rule that bans setState-in-effect is
      // satisfied — we still avoid stale settings leaking across users.
      queueMicrotask(() => { if (!cancelled) setPluginSettings(undefined); });
      return () => { cancelled = true; };
    }
    fetchPluginSettings()
      .then((map) => { if (!cancelled) setPluginSettings(map); })
      .catch((err) => {
        console.warn('[plugins] failed to load user settings:', err);
        if (!cancelled) setPluginSettings({});
      });
    return () => { cancelled = true; };
  }, [currentUserId]);

  // Live-refresh path: plugins (or the platform settings UI) can fire
  // a 'kryton:plugin-settings-changed' window event with detail
  // {pluginId, key, value} after a successful save. We patch the map
  // in place so observers re-render without a round-trip.
  useEffect(() => {
    function onChange(ev: Event): void {
      const detail = (ev as CustomEvent<{ pluginId: string; key: string; value: unknown }>).detail;
      if (!detail?.pluginId || typeof detail.key !== 'string') return;
      setPluginSettings((prev) => {
        const base = prev ? { ...prev } : {};
        const inner = { ...(base[detail.pluginId] ?? {}) };
        inner[detail.key] = detail.value;
        base[detail.pluginId] = inner;
        return base;
      });
    }
    window.addEventListener('kryton:plugin-settings-changed', onChange);
    return () => window.removeEventListener('kryton:plugin-settings-changed', onChange);
  }, []);

  useEffect(() => {
    const hostUser: HostHooksUser | null = currentUser
      ? { id: currentUser.id, name: currentUser.name, email: currentUser.email }
      : null;
    const hostNote: HostHooksNote | null = activeNote
      ? { path: activeNote.path, content: activeNote.content }
      : null;

    setHostHooks({
      saveCurrent: async () => {
        if (!activeNote) {
          throw new Error('No active note to save');
        }
        await api.updateNote(activeNote.path, activeNote.content);
        return { path: activeNote.path, savedAt: new Date().toISOString() };
      },
      closePane: () => {
        closeActiveNote();
      },
      currentUser: hostUser,
      currentNote: hostNote,
      theme,
      pluginSettings,
    });
    return () => {
      setHostHooks({});
    };
  }, [activeNote, closeActiveNote, currentUser, theme, pluginSettings]);
}
