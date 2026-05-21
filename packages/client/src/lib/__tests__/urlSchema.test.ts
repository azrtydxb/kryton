import { describe, it, expect } from 'vitest';
import {
  parseUrl,
  serializeNav,
  encodeNotePath,
  decodeNotePath,
  navEquals,
  type NavState,
} from '../urlSchema';

describe('encodeNotePath / decodeNotePath', () => {
  it('preserves folder slashes and escapes per-segment', () => {
    expect(encodeNotePath('Projects/Kryton Roadmap')).toBe('Projects/Kryton%20Roadmap');
    expect(encodeNotePath('Welcome.md')).toBe('Welcome.md');
    expect(encodeNotePath('a/b c/d e.md')).toBe('a/b%20c/d%20e.md');
  });

  it('round-trips through decode', () => {
    const cases = [
      'Welcome.md',
      'Projects/Kryton Roadmap.md',
      'Daily/2026-05-19.md',
      'Strange #hash & path.md',
      'Émigré/ünicode.md',
    ];
    for (const c of cases) {
      expect(decodeNotePath(encodeNotePath(c))).toBe(c);
    }
  });

  it('tolerates malformed percent sequences', () => {
    // %ZZ is not a valid escape — we keep the raw segment instead of throwing.
    expect(decodeNotePath('Projects/Bad%ZZ.md')).toBe('Projects/Bad%ZZ.md');
  });
});

describe('parseUrl', () => {
  it('returns default for empty path', () => {
    expect(parseUrl('/', '')).toEqual({ kind: 'default' });
    expect(parseUrl('', '')).toEqual({ kind: 'default' });
  });

  it('parses /view/all and /view/graph', () => {
    expect(parseUrl('/view/all', '')).toEqual({ kind: 'view', view: 'all', tag: null });
    expect(parseUrl('/view/graph', '')).toEqual({ kind: 'view', view: 'graph', tag: null });
  });

  it('parses /view/tags with and without ?tag=', () => {
    expect(parseUrl('/view/tags', '')).toEqual({ kind: 'view', view: 'tags', tag: null });
    expect(parseUrl('/view/tags', '?tag=alpha')).toEqual({
      kind: 'view',
      view: 'tags',
      tag: 'alpha',
    });
    expect(parseUrl('/view/tags', 'tag=alpha')).toEqual({
      kind: 'view',
      view: 'tags',
      tag: 'alpha',
    });
  });

  it('parses /n/<path> with no tabs', () => {
    expect(parseUrl('/n/Welcome.md', '')).toEqual({
      kind: 'note',
      activePath: 'Welcome.md',
      tabs: ['Welcome.md'],
    });
  });

  it('parses /n/<path> with a multi-tab list including the active one', () => {
    expect(
      parseUrl('/n/Projects/Kryton%20Roadmap.md', '?tabs=Welcome.md,Projects/Kryton%20Roadmap.md,Daily.md'),
    ).toEqual({
      kind: 'note',
      activePath: 'Projects/Kryton Roadmap.md',
      tabs: ['Welcome.md', 'Projects/Kryton Roadmap.md', 'Daily.md'],
    });
  });

  it('parses /n/<path> with a tabs list that does NOT include the active one (defensive)', () => {
    const out = parseUrl('/n/Welcome.md', '?tabs=Daily.md,Notes.md');
    expect(out).toEqual({
      kind: 'note',
      activePath: 'Welcome.md',
      tabs: ['Welcome.md', 'Daily.md', 'Notes.md'],
    });
  });

  it('parses /shared/<owner>/<path>', () => {
    expect(parseUrl('/shared/user-abc/Welcome.md', '')).toEqual({
      kind: 'shared',
      ownerUserId: 'user-abc',
      path: 'Welcome.md',
    });
    expect(parseUrl('/shared/user-abc/Folder/With%20Space.md', '')).toEqual({
      kind: 'shared',
      ownerUserId: 'user-abc',
      path: 'Folder/With Space.md',
    });
  });

  it('collapses unknown URLs to default', () => {
    expect(parseUrl('/garbage', '')).toEqual({ kind: 'default' });
    expect(parseUrl('/view/something-unknown', '')).toEqual({ kind: 'default' });
    expect(parseUrl('/n/', '')).toEqual({ kind: 'default' });
    expect(parseUrl('/shared/onlyowner', '')).toEqual({ kind: 'default' });
  });
});

describe('serializeNav', () => {
  it('serializes each NavState shape', () => {
    expect(serializeNav({ kind: 'default' })).toBe('/');
    expect(serializeNav({ kind: 'view', view: 'all', tag: null })).toBe('/view/all');
    expect(serializeNav({ kind: 'view', view: 'graph', tag: null })).toBe('/view/graph');
    expect(serializeNav({ kind: 'view', view: 'tags', tag: null })).toBe('/view/tags');
    expect(serializeNav({ kind: 'view', view: 'tags', tag: 'alpha' })).toBe(
      '/view/tags?tag=alpha',
    );
    expect(
      serializeNav({ kind: 'note', activePath: 'Welcome.md', tabs: ['Welcome.md'] }),
    ).toBe('/n/Welcome.md');
    expect(
      serializeNav({
        kind: 'note',
        activePath: 'Welcome.md',
        tabs: ['Welcome.md', 'Daily.md'],
      }),
    ).toBe('/n/Welcome.md?tabs=Welcome.md,Daily.md');
    expect(
      serializeNav({
        kind: 'shared',
        ownerUserId: 'user-1',
        path: 'Projects/Kryton Roadmap.md',
      }),
    ).toBe('/shared/user-1/Projects/Kryton%20Roadmap.md');
  });

  it('round-trips parse → serialize → parse', () => {
    const cases: NavState[] = [
      { kind: 'default' },
      { kind: 'view', view: 'all', tag: null },
      { kind: 'view', view: 'graph', tag: null },
      { kind: 'view', view: 'tags', tag: null },
      { kind: 'view', view: 'tags', tag: 'project-x' },
      { kind: 'note', activePath: 'Welcome.md', tabs: ['Welcome.md'] },
      {
        kind: 'note',
        activePath: 'Projects/Kryton Roadmap.md',
        tabs: ['Welcome.md', 'Projects/Kryton Roadmap.md', 'Daily.md'],
      },
      { kind: 'shared', ownerUserId: 'user-abc', path: 'Folder/Note.md' },
    ];
    for (const nav of cases) {
      const url = serializeNav(nav);
      const qIdx = url.indexOf('?');
      const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
      const search = qIdx >= 0 ? url.slice(qIdx) : '';
      expect(parseUrl(pathname, search)).toEqual(nav);
    }
  });
});

describe('navEquals', () => {
  it('compares by serialised form', () => {
    expect(
      navEquals(
        { kind: 'note', activePath: 'a.md', tabs: ['a.md'] },
        { kind: 'note', activePath: 'a.md', tabs: ['a.md'] },
      ),
    ).toBe(true);
    expect(
      navEquals(
        { kind: 'note', activePath: 'a.md', tabs: ['a.md'] },
        { kind: 'note', activePath: 'b.md', tabs: ['b.md'] },
      ),
    ).toBe(false);
  });
});

// ─────────────────────────── canvas routes ───────────────────────────

describe('parseUrl — canvas routes', () => {
  it('parses /canvas/<simple-path>', () => {
    expect(parseUrl('/canvas/Welcome.canvas', '')).toEqual({
      kind: 'canvas',
      id: 'Welcome.canvas',
    });
  });

  it('parses /canvas/<multi-segment-path> with literal slashes', () => {
    expect(parseUrl('/canvas/Boards/Roadmap.canvas', '')).toEqual({
      kind: 'canvas',
      id: 'Boards/Roadmap.canvas',
    });
  });

  it('parses /canvas/<multi-segment-path> with encoded slashes (%2F)', () => {
    expect(parseUrl('/canvas/Boards%2FRoadmap.canvas', '')).toEqual({
      kind: 'canvas',
      id: 'Boards/Roadmap.canvas',
    });
  });

  it('parses /canvas/<path-with-spaces>', () => {
    expect(parseUrl('/canvas/My%20Board.canvas', '')).toEqual({
      kind: 'canvas',
      id: 'My Board.canvas',
    });
  });

  it('collapses /canvas/ (no id) to default', () => {
    expect(parseUrl('/canvas/', '')).toEqual({ kind: 'default' });
    expect(parseUrl('/canvas', '')).toEqual({ kind: 'default' });
  });
});

describe('serializeNav — canvas routes', () => {
  it('serializes canvas state to /canvas/<encoded-path>', () => {
    expect(serializeNav({ kind: 'canvas', id: 'Welcome.canvas' })).toBe(
      '/canvas/Welcome.canvas',
    );
  });

  it('serializes canvas state with multi-segment id (literal slashes)', () => {
    expect(serializeNav({ kind: 'canvas', id: 'Boards/Roadmap.canvas' })).toBe(
      '/canvas/Boards/Roadmap.canvas',
    );
  });

  it('serializes canvas state with spaces in id', () => {
    expect(serializeNav({ kind: 'canvas', id: 'My Board.canvas' })).toBe(
      '/canvas/My%20Board.canvas',
    );
  });

  it('round-trips canvas → serialize → parse', () => {
    const cases: NavState[] = [
      { kind: 'canvas', id: 'Welcome.canvas' },
      { kind: 'canvas', id: 'Boards/Roadmap.canvas' },
      { kind: 'canvas', id: 'My Boards/Team Roadmap.canvas' },
    ];
    for (const nav of cases) {
      const url = serializeNav(nav);
      const qIdx = url.indexOf('?');
      const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
      const search = qIdx >= 0 ? url.slice(qIdx) : '';
      expect(parseUrl(pathname, search)).toEqual(nav);
    }
  });
});

// ─────────────────────────── plugin routes ───────────────────────────

describe('parseUrl — plugin routes', () => {
  it('parses /plugin/<name> with no note query', () => {
    expect(parseUrl('/plugin/kanban', '')).toEqual({
      kind: 'plugin',
      name: 'kanban',
      notePath: null,
    });
  });

  it('parses /plugin/<name>?note=<path>', () => {
    expect(parseUrl('/plugin/kanban', '?note=Library/Cards.md')).toEqual({
      kind: 'plugin',
      name: 'kanban',
      notePath: 'Library/Cards.md',
    });
  });

  it('decodes the note query parameter', () => {
    expect(parseUrl('/plugin/kanban', '?note=My%20Notes/Cards.md')).toEqual({
      kind: 'plugin',
      name: 'kanban',
      notePath: 'My Notes/Cards.md',
    });
  });

  it('collapses /plugin/ (no name) to default', () => {
    expect(parseUrl('/plugin/', '')).toEqual({ kind: 'default' });
    expect(parseUrl('/plugin', '')).toEqual({ kind: 'default' });
  });
});

describe('serializeNav — plugin routes', () => {
  it('serializes plugin state with no notePath', () => {
    expect(serializeNav({ kind: 'plugin', name: 'kanban', notePath: null })).toBe(
      '/plugin/kanban',
    );
  });

  it('serializes plugin state with notePath', () => {
    expect(
      serializeNav({ kind: 'plugin', name: 'kanban', notePath: 'Library/Cards.md' }),
    ).toBe('/plugin/kanban?note=Library%2FCards.md');
  });

  it('round-trips plugin → serialize → parse', () => {
    const cases: NavState[] = [
      { kind: 'plugin', name: 'kanban', notePath: null },
      { kind: 'plugin', name: 'kanban', notePath: 'Library/Cards.md' },
      { kind: 'plugin', name: 'my-plugin', notePath: 'Folder/My Note.md' },
    ];
    for (const nav of cases) {
      const url = serializeNav(nav);
      const qIdx = url.indexOf('?');
      const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
      const search = qIdx >= 0 ? url.slice(qIdx) : '';
      expect(parseUrl(pathname, search)).toEqual(nav);
    }
  });
});

// ─────────────── regression: existing routes still parse correctly ────────────

describe('parseUrl — regression: existing routes', () => {
  it('still parses / as default', () => {
    expect(parseUrl('/', '')).toEqual({ kind: 'default' });
  });

  it('still parses /n/X.md as note', () => {
    expect(parseUrl('/n/X.md', '')).toEqual({
      kind: 'note',
      activePath: 'X.md',
      tabs: ['X.md'],
    });
  });

  it('still parses /view/graph as view', () => {
    expect(parseUrl('/view/graph', '')).toEqual({ kind: 'view', view: 'graph', tag: null });
  });

  it('still parses /view/all as view', () => {
    expect(parseUrl('/view/all', '')).toEqual({ kind: 'view', view: 'all', tag: null });
  });

  it('still parses /view/tags with tag', () => {
    expect(parseUrl('/view/tags', '?tag=work')).toEqual({
      kind: 'view',
      view: 'tags',
      tag: 'work',
    });
  });
});
