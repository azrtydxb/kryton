import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { api, FileNode } from '../../lib/api';

interface PreviewProps {
  content: string;
  onLinkClick: (noteName: string) => void;
  allNotes?: FileNode[];
  onCreateNote?: (name: string) => void;
}

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i;

function collectNoteNames(nodes: FileNode[]): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'file') {
      names.add(node.name.replace(/\.md$/, '').toLowerCase());
      names.add(node.path.replace(/\.md$/, '').toLowerCase());
    }
    if (node.children) {
      for (const name of collectNoteNames(node.children)) {
        names.add(name);
      }
    }
  }
  return names;
}

interface DataviewResult {
  title: string;
  path: string;
  tags: string[];
}

function parseDataviewQuery(query: string): { type: 'list' | 'table'; fromTag?: string; whereField?: string; whereValue?: string; sortField?: string; sortDir?: string } | null {
  const lines = query.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const typeLine = lines[0].toUpperCase();
  const type = typeLine === 'TABLE' ? 'table' : 'list';

  let fromTag: string | undefined;
  let whereField: string | undefined;
  let whereValue: string | undefined;
  let sortField: string | undefined;
  let sortDir: string | undefined;

  for (const line of lines.slice(1)) {
    const fromMatch = line.match(/^FROM\s+#(\S+)/i);
    if (fromMatch) fromTag = fromMatch[1];

    const whereMatch = line.match(/^WHERE\s+(\w+)\s*=\s*"([^"]+)"/i);
    if (whereMatch) {
      whereField = whereMatch[1];
      whereValue = whereMatch[2];
    }

    const sortMatch = line.match(/^SORT\s+(\S+)\s*(ASC|DESC)?/i);
    if (sortMatch) {
      sortField = sortMatch[1];
      sortDir = sortMatch[2]?.toUpperCase() || 'ASC';
    }
  }

  return { type, fromTag, whereField, whereValue, sortField, sortDir };
}

function DataviewBlock({ query, onLinkClick }: { query: string; onLinkClick: (name: string) => void }) {
  const [results, setResults] = useState<DataviewResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseDataviewQuery(query), [query]);

  useEffect(() => {
    if (!parsed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard before async work
      setError('Invalid dataview query');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        let notes: DataviewResult[];

        if (parsed!.fromTag) {
          const tagNotes = await api.getNotesByTag(parsed!.fromTag);
          notes = tagNotes.map(n => ({
            title: n.title,
            path: n.notePath,
            tags: [parsed!.fromTag!],
          }));
        } else {
          const searchResults = await api.search('');
          notes = searchResults.map(r => ({
            title: r.title,
            path: r.path,
            tags: r.tags,
          }));
        }

        // Apply WHERE filter
        if (parsed!.whereField && parsed!.whereValue) {
          const field = parsed!.whereField;
          const value = parsed!.whereValue;
          notes = notes.filter(n => {
            if (field === 'tags' || field === 'tag') {
              return n.tags.some(t => t.toLowerCase() === value.toLowerCase());
            }
            if (field === 'title') {
              return n.title.toLowerCase().includes(value.toLowerCase());
            }
            return true;
          });
        }

        // Apply SORT
        if (parsed!.sortField) {
          const dir = parsed!.sortDir === 'DESC' ? -1 : 1;
          notes.sort((a, b) => {
            return a.title.localeCompare(b.title) * dir;
          });
        }

        if (!cancelled) {
          setResults(notes);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to execute query');
          setLoading(false);
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [parsed]);

  if (error) {
    return <div className="text-red-500 text-sm p-2 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>;
  }

  if (loading) {
    return <div className="text-gray-400 text-sm p-2">Running query...</div>;
  }

  if (results.length === 0) {
    return <div className="text-gray-400 text-sm p-2">No results</div>;
  }

  if (parsed?.type === 'table') {
    return (
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr>
            <th className="border px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 font-semibold text-sm">Note</th>
            <th className="border px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 font-semibold text-sm">Path</th>
            <th className="border px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 font-semibold text-sm">Tags</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.path}>
              <td className="border px-3 py-2 text-sm">
                <button onClick={() => onLinkClick(r.title)} className="text-blue-500 hover:underline">{r.title}</button>
              </td>
              <td className="border px-3 py-2 text-sm text-gray-500">{r.path}</td>
              <td className="border px-3 py-2 text-sm text-gray-500">{r.tags.map(t => `#${t}`).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <ul className="list-disc pl-6 mb-4">
      {results.map(r => (
        <li key={r.path} className="mb-1">
          <button onClick={() => onLinkClick(r.title)} className="text-blue-500 hover:underline text-sm">{r.title}</button>
          <span className="text-xs text-gray-400 ml-2">{r.path}</span>
        </li>
      ))}
    </ul>
  );
}

export function Preview({ content, onLinkClick, allNotes, onCreateNote }: PreviewProps) {
  const [embeddedNotes, setEmbeddedNotes] = useState<Record<string, string>>({});

  const existingNotes = useMemo(() => {
    if (!allNotes) return new Set<string>();
    return collectNoteNames(allNotes);
  }, [allNotes]);

  // Find all note embeds (not images) in content
  const noteEmbeds = Array.from(content.matchAll(/!\[\[([^\]]+)\]\]/g))
    .map((m) => m[1])
    .filter((name) => !IMAGE_EXTENSIONS.test(name));

  // Fetch embedded note content
  useEffect(() => {
    let cancelled = false;
    const toFetch = noteEmbeds.filter((name) => !(name in embeddedNotes));
    if (toFetch.length === 0) return;

    Promise.all(
      toFetch.map(async (name) => {
        try {
          const note = await api.getNote(name.endsWith('.md') ? name : `${name}.md`);
          return { name, content: note.content };
        } catch {
          return { name, content: null };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setEmbeddedNotes((prev) => {
        const next = { ...prev };
        for (const r of results) {
          next[r.name] = r.content ?? `*Note "${r.name}" not found*`;
        }
        return next;
      });
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteEmbeds.join(',')]);

  // Extract dataview blocks before markdown transformation
  const dataviewBlocks: { id: string; query: string }[] = [];
  let processedContent = content;

  const dataviewRegex = /```dataview\n([\s\S]*?)```/g;
  let dvMatch;
  while ((dvMatch = dataviewRegex.exec(content)) !== null) {
    const id = `dataview-${dataviewBlocks.length}`;
    dataviewBlocks.push({ id, query: dvMatch[1].trim() });
    processedContent = processedContent.replace(dvMatch[0], `<div data-dataview-id="${id}"></div>`);
  }

  // Transform content: handle embeds and wiki-links
  const transformedContent = processedContent
    // Image embeds: ![[image.png]] → <img>
    .replace(
      /!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp))\]\]/gi,
      (_match, fileName: string) =>
        `<div class="embed-image"><img src="/api/files/${encodeURIComponent(fileName)}" alt="${fileName}" /></div>`
    )
    // Note embeds: ![[Note Name]] → embedded content
    .replace(
      /!\[\[([^\]]+)\]\]/g,
      (_match, noteName: string) => {
        if (IMAGE_EXTENSIONS.test(noteName)) return _match;
        const noteContent = embeddedNotes[noteName];
        if (noteContent === undefined) {
          return `<div class="embed-note embed-loading"><div class="embed-note-header">${noteName}</div><p class="embed-note-loading-text">Loading...</p></div>`;
        }
        const strippedContent = noteContent.replace(/^#\s+.+\n?/, '');
        return `<div class="embed-note"><div class="embed-note-header"><a class="wiki-link" data-wiki-target="${noteName}" href="#">${noteName}</a></div>\n\n${strippedContent}\n\n</div>`;
      }
    )
    // Regular wiki-links: [[Note]] → clickable link with broken detection
    .replace(
      /\[\[([^\]]+)\]\]/g,
      (_, linkText: string) => {
        const isBroken = allNotes && !existingNotes.has(linkText.toLowerCase());
        const classes = isBroken ? 'wiki-link wiki-link-broken' : 'wiki-link';
        const title = isBroken ? `Note "${linkText}" not found — click to create` : linkText;
        return `<a class="${classes}" data-wiki-target="${linkText}" data-broken="${isBroken ? 'true' : 'false'}" href="#" title="${title}">${linkText}</a>`;
      }
    );

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const wikiTarget = target.closest<HTMLElement>('[data-wiki-target]');
    if (wikiTarget) {
      e.preventDefault();
      const noteName = wikiTarget.getAttribute('data-wiki-target');
      const isBroken = wikiTarget.getAttribute('data-broken') === 'true';
      if (noteName) {
        if (isBroken && onCreateNote) {
          onCreateNote(noteName);
        } else {
          onLinkClick(noteName);
        }
      }
    }
  }, [onLinkClick, onCreateNote]);

  // Heading counter for generating sequential IDs (resets each render)
  const headingCounterRef = useRef(0);
  headingCounterRef.current = 0;

  const headingComponents = useMemo(() => {
    const makeHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => {
      return ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
        headingCounterRef.current++;
        return <Tag id={`heading-${headingCounterRef.current}`} {...props}>{children}</Tag>;
      };
    };
    return {
      h1: makeHeading('h1'),
      h2: makeHeading('h2'),
      h3: makeHeading('h3'),
      h4: makeHeading('h4'),
      h5: makeHeading('h5'),
      h6: makeHeading('h6'),
    };
  }, []);

  return (
    <div className="markdown-preview p-6 max-w-3xl mx-auto" onClick={handleClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={headingComponents}
      >
        {transformedContent}
      </ReactMarkdown>
      {/* Render dataview blocks */}
      {dataviewBlocks.map(block => (
        <DataviewBlock key={block.id} query={block.query} onLinkClick={onLinkClick} />
      ))}
    </div>
  );
}
