import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkWikiLink from 'remark-wiki-link';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { api, FileNode } from '../../lib/api';
import { collectNoteNames } from '../../lib/noteTreeUtils';
import { rehypeWikiLinks } from '../../lib/rehype-wiki-links';
import { parseFrontmatter } from '../../lib/frontmatter';
import { DataviewBlock } from './DataviewBlock';
import { FrontmatterBlock } from './FrontmatterBlock';

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => !['script', 'iframe', 'object', 'embed', 'form'].includes(tag),
  ),
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), 'className', 'class'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'class'],
    a: [...(defaultSchema.attributes?.a ?? []), 'className', 'class', 'dataWikiTarget', 'data-wiki-target'],
    img: [...(defaultSchema.attributes?.img ?? []), 'className', 'class', 'src', 'alt'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className', 'class'],
    pre: [...(defaultSchema.attributes?.pre ?? []), 'className', 'class'],
  },
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface PreviewProps {
  content: string;
  onLinkClick: (noteName: string) => void;
  allNotes?: FileNode[];
  onCreateNote?: (name: string) => void;
  notePath?: string;
  getCodeFenceRenderer?: (language: string) => { component: React.ComponentType<{ content: string; notePath: string }> } | undefined;
  /** Current embed depth — used internally to prevent infinite recursion */
  embedDepth?: number;
  /** Set of note paths in the current embed chain — used to detect circular embeds */
  embedChain?: Set<string>;
}

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i;
const MAX_EMBED_DEPTH = 3;

export function Preview({ content, onLinkClick, allNotes, onCreateNote, notePath = '', getCodeFenceRenderer, embedDepth = 0, embedChain }: PreviewProps) {
  const [embeddedNotes, setEmbeddedNotes] = useState<Record<string, string>>({});

  const existingNotes = useMemo(() => {
    if (!allNotes) return new Set<string>();
    return collectNoteNames(allNotes);
  }, [allNotes]);

  // Build the current embed chain (for circular reference detection)
  const currentChain = useMemo(() => {
    const chain = new Set(embedChain);
    if (notePath) chain.add(notePath);
    return chain;
  }, [embedChain, notePath]);

  // Find all note embeds (not images) in content — skip if at max depth
  const noteEmbeds = embedDepth >= MAX_EMBED_DEPTH
    ? []
    : Array.from(content.matchAll(/!\[\[([^\]]+)\]\]/g))
        .map((m) => m[1])
        .filter((name) => !IMAGE_EXTENSIONS.test(name))
        .filter((name) => !currentChain.has(name) && !currentChain.has(name + '.md'));

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

  // Parse frontmatter — use the body (content without frontmatter) for rendering
  const { frontmatter, body: contentBody } = parseFrontmatter(content);

  // Extract dataview blocks before markdown transformation
  const dataviewBlocks: { id: string; query: string }[] = [];
  let processedContent = contentBody;

  const dataviewRegex = /```dataview\n([\s\S]*?)```/g;
  let dvMatch;
  while ((dvMatch = dataviewRegex.exec(contentBody)) !== null) {
    const id = `dataview-${dataviewBlocks.length}`;
    dataviewBlocks.push({ id, query: dvMatch[1].trim() });
    processedContent = processedContent.replace(dvMatch[0], `<div data-dataview-id="${id}"></div>`);
  }

  // Transform content: handle embeds (remark-wiki-link handles [[...]] links)
  const transformedContent = processedContent
    // Image embeds: ![[image.png]] → <img>
    .replace(
      /!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp))\]\]/gi,
      (_match, fileName: string) =>
        `<div class="embed-image"><img src="/api/files/${encodeURIComponent(fileName)}" alt="${escapeHtml(fileName)}" /></div>`
    )
    // Note embeds: ![[Note Name]] → embedded content
    .replace(
      /!\[\[([^\]]+)\]\]/g,
      (_match, noteName: string) => {
        if (IMAGE_EXTENSIONS.test(noteName)) return _match;
        // Depth or circular reference limit reached
        if (embedDepth >= MAX_EMBED_DEPTH) {
          return `<div class="embed-note embed-limited"><div class="embed-note-header"><a class="wiki-link" data-wiki-target="${escapeHtml(noteName)}" href="#">${escapeHtml(noteName)}</a></div><p><em>Embed depth limit reached</em></p></div>`;
        }
        if (currentChain.has(noteName) || currentChain.has(noteName + '.md')) {
          return `<div class="embed-note embed-circular"><div class="embed-note-header"><a class="wiki-link" data-wiki-target="${escapeHtml(noteName)}" href="#">${escapeHtml(noteName)}</a></div><p><em>Circular embed detected</em></p></div>`;
        }
        const noteContent = embeddedNotes[noteName];
        if (noteContent === undefined) {
          return `<div class="embed-note embed-loading"><div class="embed-note-header">${escapeHtml(noteName)}</div><p class="embed-note-loading-text">Loading...</p></div>`;
        }
        const strippedContent = noteContent.replace(/^#\s+.+\n?/, '');
        return `<div class="embed-note"><div class="embed-note-header"><a class="wiki-link" data-wiki-target="${escapeHtml(noteName)}" href="#">${escapeHtml(noteName)}</a></div>\n\n${strippedContent}\n\n</div>`;
      }
    );

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Check for wiki-links first (have data-wiki-target attribute)
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
      return;
    }

    // Intercept any other <a> clicks to prevent browser navigation
    const anchor = target.closest<HTMLAnchorElement>('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;

      // Allow external links to open normally
      if (/^https?:\/\//i.test(href)) return;

      // Treat as internal note link — strip leading slash
      e.preventDefault();
      const noteName = decodeURIComponent(href.replace(/^\//, ''));
      if (noteName) {
        onLinkClick(noteName);
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

  const codeComponent = useMemo(() => {
    return function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
      const match = className?.match(/language-(\w+)/);
      const language = match?.[1];

      if (language && getCodeFenceRenderer) {
        const renderer = getCodeFenceRenderer(language);
        if (renderer) {
          const pluginContent = String(children).replace(/\n$/, '');
          const RendererComponent = renderer.component;
          return <RendererComponent content={pluginContent} notePath={notePath} />;
        }
      }

      return <code className={className} {...props}>{children}</code>;
    };
  }, [getCodeFenceRenderer, notePath]);

  const remarkPlugins = useMemo(() => [
    remarkGfm,
    [remarkWikiLink, {
      permalinks: Array.from(existingNotes),
      pageResolver: (name: string) => [name],
      hrefTemplate: (permalink: string) => `/${permalink}`,
      wikiLinkClassName: 'internal',
      newClassName: 'new',
      aliasDivider: '|',
    }],
  ] as Parameters<typeof ReactMarkdown>[0]['remarkPlugins'], [existingNotes]);

  const rehypePlugins = useMemo(() => [
    rehypeRaw,
    [rehypeSanitize, sanitizeSchema],
    [rehypeWikiLinks, { existingNotes }],
  ] as Parameters<typeof ReactMarkdown>[0]['rehypePlugins'], [existingNotes]);

  return (
    <div className="markdown-preview p-6 max-w-3xl mx-auto" onClick={handleClick}>
      {frontmatter && <FrontmatterBlock frontmatter={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{ ...headingComponents, code: codeComponent }}
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
