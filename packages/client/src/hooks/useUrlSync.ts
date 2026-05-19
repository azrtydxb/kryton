import { useEffect, useLayoutEffect, useRef } from 'react';
import { useUIStore, type MainView } from '../stores/uiStore';
import { useToastStore } from '../stores/toastStore';
import {
  parseUrl,
  serializeNav,
  navEquals,
  type NavState,
} from '../lib/urlSchema';

/** Callbacks the hook needs from the surrounding app to materialise a
 *  parsed URL back into editor state. Kept as plain function refs so the
 *  hook stays decoupled from the concrete useNotes / useAppCallbacks shape
 *  and is trivial to test. */
export interface UrlSyncCallbacks {
  /** Open a regular note by path. Should fetch it and make it active. */
  openNote: (path: string) => Promise<void> | void;
  /** Open a note shared by another user. */
  openSharedNote: (ownerUserId: string, path: string) => Promise<void> | void;
  /** Clear the active note so the empty / view state renders. */
  closeActiveNote: () => void;
  /** Verify that a path still exists in the user's tree; the hook drops
   *  any URL-listed tab whose path is missing (deleted-while-away). */
  noteExists: (path: string) => boolean;
}

/** Snapshot of the navigation-relevant pieces of UI state. */
interface NavSnapshot {
  view: MainView;
  openTabs: string[];
  activePath: string | null;
  /** For shared notes the active note's `tabId` carries the
   *  `shared:<ownerUserId>:<path>` prefix; we surface it separately so the
   *  URL writer can emit `/shared/...` instead of `/n/...`. */
  activeTabId: string | null;
  pendingTag: string | null;
}

function navStateFromSnapshot(snap: NavSnapshot): NavState {
  // Shared notes have a synthetic tabId of the form
  // `shared:<ownerUserId>:<onDiskPath>`. They take precedence over the
  // plain `view`/`note` paths because they have their own URL grammar.
  if (snap.activeTabId && snap.activeTabId.startsWith('shared:')) {
    const rest = snap.activeTabId.slice('shared:'.length);
    const sep = rest.indexOf(':');
    if (sep > 0) {
      return {
        kind: 'shared',
        ownerUserId: rest.slice(0, sep),
        path: rest.slice(sep + 1),
      };
    }
  }

  switch (snap.view) {
    case 'all':
      return { kind: 'view', view: 'all', tag: null };
    case 'graph':
      return { kind: 'view', view: 'graph', tag: null };
    case 'tags':
      return { kind: 'view', view: 'tags', tag: snap.pendingTag };
    case 'note': {
      if (!snap.activePath) {
        // In note view with nothing open — surface the default URL so a
        // refresh from this state lands cleanly on the empty view.
        return { kind: 'default' };
      }
      const tabs = snap.openTabs.length > 0 ? snap.openTabs : [snap.activePath];
      return { kind: 'note', activePath: snap.activePath, tabs };
    }
  }
}

/** Decide whether a transition should `pushState` (creates a history entry,
 *  back button returns to the previous nav) or `replaceState` (keeps the
 *  current history slot, used when only the open-tab list changes). */
function shouldPushHistory(prev: NavState, next: NavState): boolean {
  // Pure tab-list changes within the same active note → replace.
  if (prev.kind === 'note' && next.kind === 'note' && prev.activePath === next.activePath) {
    return false;
  }
  // Tag selection inside the same tags view → replace (changing the chip
  // shouldn't pollute history with a stack of tag URLs).
  if (
    prev.kind === 'view' &&
    next.kind === 'view' &&
    prev.view === 'tags' &&
    next.view === 'tags'
  ) {
    return false;
  }
  return true;
}

/** Public hook: wire the URL <-> uiStore + active note bidirectionally.
 *
 *  - On mount, parses `window.location` and dispatches via `callbacks` so
 *    the app reconstructs the user's last view and tab strip.
 *  - Subscribes to uiStore + active-note changes, writing the URL whenever
 *    the derived NavState diverges from the current URL.
 *  - Installs a `popstate` listener so browser back/forward re-parse the
 *    URL and run the same restore path. */
export function useUrlSync(activeTabId: string | null, callbacks: UrlSyncCallbacks): void {
  const setView = useUIStore((s) => s.setView);
  const openTab = useUIStore((s) => s.openTab);
  const pendingTagRef = useRef<string | null>(null);

  // Snapshot refs so the popstate handler always sees the freshest
  // callbacks without re-binding the listener on every render. Refs are
  // mutated in a layout effect — never during render — so React's
  // refs-during-render lint stays happy.
  const callbacksRef = useRef(callbacks);
  const activeTabIdRef = useRef(activeTabId);
  const applyRef = useRef<(nav: NavState) => void>(() => {});

  useLayoutEffect(() => {
    callbacksRef.current = callbacks;
    activeTabIdRef.current = activeTabId;
  }, [callbacks, activeTabId]);

  // ── 1. Apply a parsed URL to the stores. Shared between mount + popstate.
  // Reassigned every render via a layout effect for the same reason.
  const applyImpl = (nav: NavState) => {
    const ui = useUIStore.getState();
    const cb = callbacksRef.current;

    switch (nav.kind) {
      case 'default': {
        ui.setView('note');
        cb.closeActiveNote();
        return;
      }
      case 'view': {
        ui.setView(nav.view);
        if (nav.view === 'tags') {
          pendingTagRef.current = nav.tag;
          // Surface the pending tag on the window so App.tsx's pendingTag
          // useState can pick it up. App.tsx wires a small adapter to
          // consume this — see the patch spec in the report.
          window.dispatchEvent(
            new CustomEvent('kryton:url-tag', { detail: { tag: nav.tag } }),
          );
        }
        return;
      }
      case 'shared': {
        ui.setView('note');
        void cb.openSharedNote(nav.ownerUserId, nav.path);
        ui.openTab(`shared:${nav.ownerUserId}:${nav.path}`);
        return;
      }
      case 'note': {
        ui.setView('note');
        // Drop tabs whose path is no longer in the tree. If the active
        // tab is gone we fall through to whichever tab survives, or to
        // the empty state if none remain.
        const existing = nav.tabs.filter((p) => cb.noteExists(p));
        const missing = nav.tabs.filter((p) => !cb.noteExists(p));
        if (missing.length > 0) {
          const toast = useToastStore.getState().addToast;
          for (const p of missing) {
            toast('info', `Note "${p}" is no longer available`);
          }
        }

        // Rebuild the openTabs store list in URL order so the tab strip
        // matches what the user shared/bookmarked. We can't reuse
        // `openTab` for re-ordering, so set directly via the store.
        useUIStore.setState({ openTabs: existing });

        const activeToOpen: string | null = existing.includes(nav.activePath)
          ? nav.activePath
          : (existing[0] ?? null);

        if (activeToOpen) {
          void cb.openNote(activeToOpen);
        } else {
          cb.closeActiveNote();
        }
        return;
      }
    }
  };

  // Install the latest `applyImpl` into the ref on every render so the
  // mount-only popstate listener (next effect) always calls into the
  // closure with fresh callbacks. Writing through a layout effect keeps
  // the assignment out of render, which the react-hooks lint requires.
  useLayoutEffect(() => {
    applyRef.current = applyImpl;
  });

  // ── 2. Mount: parse the initial URL and apply it once.
  useEffect(() => {
    const initial = parseUrl(window.location.pathname, window.location.search);
    applyRef.current(initial);

    const onPopState = () => {
      const nav = parseUrl(window.location.pathname, window.location.search);
      applyRef.current(nav);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // Intentionally only run once: this effect owns the bootstrap +
    // popstate lifecycle for the app session. All reads go through
    // refs so the effect doesn't need fresh closures on re-render.
  }, []);

  // ── 3. Whenever the navigation-relevant store fields change, derive
  // the canonical NavState and write the URL if it diverged from what's
  // already in the address bar.
  useEffect(() => {
    const writeUrl = () => {
      const ui = useUIStore.getState();
      const snap: NavSnapshot = {
        view: ui.view,
        openTabs: ui.openTabs,
        // The active path is whatever the open-tab list points at —
        // the consumer (App.tsx) keeps openTabs in sync with the
        // active note via existing handleNoteSelect / handleTabClose.
        activePath: deriveActivePathFromTabs(ui.openTabs, activeTabIdRef.current),
        activeTabId: activeTabIdRef.current,
        pendingTag: pendingTagRef.current,
      };

      const next = navStateFromSnapshot(snap);
      const currentUrl = window.location.pathname + window.location.search;
      const prev = parseUrl(window.location.pathname, window.location.search);
      const nextUrl = serializeNav(next);
      if (currentUrl === nextUrl) return;
      if (navEquals(prev, next)) return;

      if (shouldPushHistory(prev, next)) {
        window.history.pushState(null, '', nextUrl);
      } else {
        window.history.replaceState(null, '', nextUrl);
      }
    };

    // Write once for the current state (covers the case where the
    // initial URL was `/` but the user already had stored open tabs).
    writeUrl();

    const unsub = useUIStore.subscribe(writeUrl);
    return () => unsub();
  }, [activeTabId]);

  // Re-export helpers so consumers can pre-seed via the same hook if
  // they want — kept narrow so React doesn't see them as deps.
  void setView;
  void openTab;
}

/** Resolve the active note path from the open-tabs list + the optional
 *  shared-note tabId. Plain note tabs are their own path; shared tabs
 *  use the `shared:<ownerUserId>:<path>` prefix so we strip the prefix
 *  to surface the on-disk path. */
function deriveActivePathFromTabs(
  tabs: string[],
  activeTabId: string | null,
): string | null {
  if (!activeTabId) return tabs[tabs.length - 1] ?? null;
  if (activeTabId.startsWith('shared:')) {
    // Shared notes have a separate URL grammar — the caller doesn't
    // populate `activePath` from this for shared cases.
    const rest = activeTabId.slice('shared:'.length);
    const sep = rest.indexOf(':');
    return sep > 0 ? rest.slice(sep + 1) : null;
  }
  return activeTabId;
}
