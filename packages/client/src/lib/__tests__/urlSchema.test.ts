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
