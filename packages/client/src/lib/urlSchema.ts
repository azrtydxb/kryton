/**
 * URL grammar for shareable / bookmarkable navigation state.
 *
 *   /                                       → default landing
 *   /n/<encoded-path>                       → single note open + active
 *   /n/<active>?tabs=p1,p2,p3               → multi-tab, comma-separated
 *   /view/all                               → all-notes browser
 *   /view/graph                             → graph view
 *   /view/tags?tag=<tagname>                → tags view, preselected tag
 *   /shared/<ownerUserId>/<encoded-path>    → shared note
 *
 * Path encoding rule: each folder segment is `encodeURIComponent`-encoded,
 * but the folder slashes that separate them stay literal slashes, so a
 * tree path like `Projects/Kryton Roadmap` becomes `Projects/Kryton%20Roadmap`
 * in the URL.
 *
 * The parser is forgiving — any unrecognised URL collapses to the default
 * nav state rather than throwing. This way a stale or hand-edited URL on
 * boot just lands on the empty view instead of crashing the app.
 */
import type { MainView } from '../stores/uiStore';

/** Shape of the navigation slice that lives in the URL. */
export type NavState =
  | { kind: 'default' }
  | { kind: 'view'; view: Exclude<MainView, 'note'>; tag: string | null }
  | { kind: 'note'; activePath: string; tabs: string[] }
  | { kind: 'shared'; ownerUserId: string; path: string }
  | { kind: 'canvas'; id: string }
  | { kind: 'plugin'; name: string; notePath: string | null };

/** Encode a notes-tree path for use inside the URL. Slash separators
 *  stay literal; each segment is `encodeURIComponent`d so spaces,
 *  unicode, and reserved characters round-trip cleanly. */
export function encodeNotePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Inverse of `encodeNotePath`. */
export function decodeNotePath(encoded: string): string {
  return encoded
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // Malformed percent-sequence — keep the raw segment so the
        // caller can decide whether the resulting path is openable.
        return segment;
      }
    })
    .join('/');
}

function splitTabs(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => decodeNotePath(part.trim()))
    .filter((p) => p.length > 0);
}

function joinTabs(tabs: string[]): string {
  return tabs.map((t) => encodeNotePath(t)).join(',');
}

/** Parse the current location (pathname + search) into a NavState.
 *  Anything unrecognised becomes `{ kind: 'default' }`. */
export function parseUrl(pathname: string, search: string): NavState {
  // Normalise: strip leading/trailing slashes from the path portion only.
  const cleanedPath = pathname.replace(/^\/+|\/+$/g, '');
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  if (cleanedPath.length === 0) {
    return { kind: 'default' };
  }

  // /view/<mode>
  if (cleanedPath.startsWith('view/')) {
    const rest = cleanedPath.slice('view/'.length);
    if (rest === 'all' || rest === 'graph') {
      return { kind: 'view', view: rest, tag: null };
    }
    if (rest === 'tags') {
      const tag = params.get('tag');
      return { kind: 'view', view: 'tags', tag: tag && tag.length > 0 ? tag : null };
    }
    return { kind: 'default' };
  }

  // /shared/<ownerUserId>/<encoded-path>
  if (cleanedPath.startsWith('shared/')) {
    const rest = cleanedPath.slice('shared/'.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) return { kind: 'default' };
    const ownerUserId = decodeURIComponent(rest.slice(0, slash));
    const encodedPath = rest.slice(slash + 1);
    const path = decodeNotePath(encodedPath);
    return { kind: 'shared', ownerUserId, path };
  }

  // /n/<active>?tabs=...
  if (cleanedPath.startsWith('n/')) {
    const encodedPath = cleanedPath.slice('n/'.length);
    if (encodedPath.length === 0) return { kind: 'default' };
    const activePath = decodeNotePath(encodedPath);
    const tabs = splitTabs(params.get('tabs'));
    // The `tabs` list always includes the active path so callers can
    // treat it as the canonical open-tab set.
    const tabSet = tabs.includes(activePath) ? tabs : [activePath, ...tabs];
    return { kind: 'note', activePath, tabs: tabSet };
  }

  // /canvas/<encoded-id>
  // Mirrors the /n/ encoding: folder slashes stay literal, segments are
  // encodeURIComponent'd. The id may also arrive with %2F-encoded slashes
  // (e.g. from a mobile host that fully-encodes the path); both forms are
  // accepted by simply percent-decoding the whole rest segment.
  if (cleanedPath.startsWith('canvas/')) {
    const rest = cleanedPath.slice('canvas/'.length);
    if (rest.length === 0) return { kind: 'default' };
    // Decode segment by segment to handle literal slash separators, then
    // also handle %2F (fully-encoded slashes) via a global decode pass.
    const id = decodeNotePath(rest);
    return { kind: 'canvas', id };
  }

  // /plugin/<name>?note=<encoded-path>
  if (cleanedPath.startsWith('plugin/')) {
    const name = cleanedPath.slice('plugin/'.length);
    if (name.length === 0) return { kind: 'default' };
    const rawNote = params.get('note');
    const notePath = rawNote && rawNote.length > 0 ? decodeURIComponent(rawNote) : null;
    return { kind: 'plugin', name, notePath };
  }

  return { kind: 'default' };
}

/** Serialise a NavState into a `pathname + search` string suitable for
 *  `history.pushState` / `history.replaceState`. */
export function serializeNav(state: NavState): string {
  switch (state.kind) {
    case 'default':
      return '/';
    case 'view': {
      if (state.view === 'tags' && state.tag) {
        return `/view/tags?tag=${encodeURIComponent(state.tag)}`;
      }
      return `/view/${state.view}`;
    }
    case 'shared': {
      const owner = encodeURIComponent(state.ownerUserId);
      return `/shared/${owner}/${encodeNotePath(state.path)}`;
    }
    case 'note': {
      const active = encodeNotePath(state.activePath);
      // Only include `?tabs=` when there's more than one tab open or
      // when the single tab differs from the active path — otherwise
      // the URL stays clean.
      const others = state.tabs.filter((t) => t !== state.activePath);
      if (others.length === 0 && state.tabs.length <= 1) {
        return `/n/${active}`;
      }
      // Preserve full tab order including the active tab so the parser
      // can reconstruct exactly what the user saw.
      return `/n/${active}?tabs=${joinTabs(state.tabs)}`;
    }
    case 'canvas': {
      // Mirror /n/ encoding: per-segment encodeURIComponent, literal slashes.
      return `/canvas/${encodeNotePath(state.id)}`;
    }
    case 'plugin': {
      // The note query param uses a full encodeURIComponent so slashes in
      // the path become %2F — this keeps the note path unambiguous as a
      // single query-string value.
      if (state.notePath) {
        return `/plugin/${state.name}?note=${encodeURIComponent(state.notePath)}`;
      }
      return `/plugin/${state.name}`;
    }
  }
}

/** True when two NavStates serialise to the same URL — used by the
 *  sync hook to skip redundant `pushState` calls. */
export function navEquals(a: NavState, b: NavState): boolean {
  return serializeNav(a) === serializeNav(b);
}
