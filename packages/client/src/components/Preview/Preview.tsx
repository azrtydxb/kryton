import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkWikiLink from 'remark-wiki-link';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { api, FileNode } from '../../lib/api';
import { collectNoteNames } from '../../lib/noteTreeUtils';
import { rehypeWikiLinks } from '../../lib/rehype-wiki-links';
import { DataviewBlock } from './DataviewBlock';

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
}

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i;

export function Preview({ content, onLinkClick, allNotes, onCreateNote, notePath = '', getCodeFenceRenderer }: PreviewProps) {
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

  return (
    <div className="markdown-preview p-6 max-w-3xl mx-auto" onClick={handleClick}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [remarkWikiLink, {
            permalinks: Array.from(existingNotes),
            pageResolver: (name: string) => [name],
            hrefTemplate: (permalink: string) => `/${permalink}`,
            wikiLinkClassName: 'internal',
            newClassName: 'new',
            aliasDivider: '|',
          }],
        ]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
          [rehypeWikiLinks, { existingNotes }],
        ]}
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
