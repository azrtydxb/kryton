import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkWikiLink from "remark-wiki-link";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { visit } from "unist-util-visit";
import type { Node } from "unist";
import { cn } from "../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotePreviewReactProps {
  /** Raw markdown content to render. */
  content: string;
  /** Called when the user clicks a [[wiki-link]] or internal link. */
  onLinkClick: (noteName: string) => void;
  /**
   * Flat set of lowercase note names/paths for existence checks.
   * Used to style broken links differently.
   */
  existingNotes?: Set<string>;
  /** Called when the user clicks a broken [[wiki-link]] to create it. */
  onCreateNote?: (name: string) => void;
  /** Current note path — used to scope embed chains. */
  notePath?: string;
  /**
   * Custom code fence renderers keyed by language tag.
   * If a renderer exists for a language, it replaces the default `<code>` block.
   */
  getCodeFenceRenderer?: (
    lang: string,
  ) =>
    | {
        component: React.ComponentType<{
          content: string;
          notePath: string;
          range?: { startLine: number; endLine: number };
          rawRange?: { startLine: number; endLine: number };
          source?: string;
          /**
           * True when the preview is rendered alongside an editor (Edit /
           * Split modes), false in pure Preview mode. Plugin renderers
           * (kanban, excalidraw, …) should hide editable controls when
           * this is false so the user doesn't see Add card / Add column
           * affordances they can't act on without entering edit mode.
           */
          interactive?: boolean;
        }>;
      }
    | undefined;
  /**
   * Whether the preview is interactive. Forwarded to plugin code-fence
   * renderers via the `interactive` prop. Defaults to false (read-only)
   * so pre-existing call sites stay safe.
   */
  interactive?: boolean;
  /**
   * Called by the component to fetch embedded note content.
   * Receives the note name (without extension) and should return the raw markdown.
   */
  onFetchNoteContent?: (name: string) => Promise<string | null>;
  className?: string;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

interface Frontmatter {
  [key: string]: string;
}

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter | null;
  body: string;
} {
  if (!content.startsWith("---")) return { frontmatter: null, body: content };
  const afterOpen = content.indexOf("\n", 3);
  if (afterOpen === -1) return { frontmatter: null, body: content };
  const closeIndex = content.indexOf("\n---", afterOpen);
  if (closeIndex === -1) return { frontmatter: null, body: content };

  const yamlBlock = content.slice(afterOpen + 1, closeIndex);
  const body = content.slice(closeIndex + 4).replace(/^\n/, "");

  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;
  const listAccumulator: string[] = [];

  for (const rawLine of yamlBlock.split("\n")) {
    const line = rawLine.trimEnd();
    const listItem = line.match(/^(\s+)?-\s+(.+)/);
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)/);

    if (listItem && currentKey) {
      const itemText = listItem[2];
      if (itemText !== undefined) {
        listAccumulator.push(itemText.trim());
        frontmatter[currentKey] = listAccumulator.join(", ");
      }
    } else if (kvMatch) {
      if (currentKey && listAccumulator.length) listAccumulator.length = 0;
      const matchedKey = kvMatch[1];
      const matchedVal = kvMatch[2];
      if (matchedKey !== undefined && matchedVal !== undefined) {
        currentKey = matchedKey;
        frontmatter[currentKey] = matchedVal.trim();
      }
    }
  }

  return { frontmatter: Object.keys(frontmatter).length ? frontmatter : null, body };
}

// ─── Sanitize schema ──────────────────────────────────────────────────────────

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => !["script", "iframe", "object", "embed", "form"].includes(tag),
  ),
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), "className", "class", "dataDataviewId", "data-dataview-id"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "class"],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      "className",
      "class",
      "dataWikiTarget",
      "data-wiki-target",
      "dataBroken",
      "data-broken",
    ],
    img: [...(defaultSchema.attributes?.img ?? []), "className", "class", "src", "alt"],
    code: [...(defaultSchema.attributes?.code ?? []), "className", "class"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className", "class"],
  },
};

// ─── Rehype wiki-links plugin ─────────────────────────────────────────────────

function rehypeWikiLinks(options: { existingNotes: Set<string> }) {
  const { existingNotes } = options;
  return (tree: Node) => {
    visit(tree, "element", (node: Record<string, unknown>) => {
      const props = node.properties as Record<string, unknown> | undefined;
      if (!props) return;
      const tagName = node.tagName as string;
      const classNames = props.className as string[] | undefined;
      if (tagName !== "a" || !classNames?.includes("internal")) return;

      const href = (props.href as string) || "";
      const noteName = decodeURIComponent(href.replace(/^\//, ""));
      const isBroken = !existingNotes.has(noteName.toLowerCase());

      props["data-wiki-target"] = noteName;
      props["data-broken"] = isBroken ? "true" : "false";
      props.href = "#";
      props.className = isBroken
        ? ["wiki-link", "wiki-link-broken"]
        : ["wiki-link"];
      if (isBroken) props.title = `Create note: ${noteName}`;
    });
  };
}

// ─── FrontmatterBlock ─────────────────────────────────────────────────────────

const COLLAPSED_LIMIT = 3;

function FrontmatterBlock({ frontmatter }: { frontmatter: Frontmatter }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(frontmatter);
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_LIMIT);
  const hasMore = entries.length > COLLAPSED_LIMIT;

  return (
    <div className="border-t border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 py-2 px-3 mb-4 text-xs text-gray-500 dark:text-gray-400">
      <dl className="flex flex-col gap-1">
        {visible.map(([key, value]) => (
          <div key={key} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium text-gray-600 dark:text-gray-300 shrink-0">
              {key}:
            </dt>
            <dd className="m-0">
              {key === "tags" ? (
                <span className="flex flex-wrap gap-1">
                  {value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((tag) => (
                      <span
                        key={tag}
                        className="inline-block px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                </span>
              ) : (
                <span>{value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-violet-500 hover:text-violet-600 dark:hover:text-violet-400"
        >
          {expanded
            ? "Show less"
            : `Show ${entries.length - COLLAPSED_LIMIT} more`}
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface NotePreviewReactRef {
  scrollToHeading: (index: number) => void;
}

/**
 * NotePreviewReact — React-rendered Markdown preview.
 *
 * Supports:
 * - [[wiki-links]] with broken-link detection
 * - ![[embedded notes]] with depth limit and circular detection
 * - ![[image.png]] embeds
 * - YAML frontmatter display
 * - Plugin-provided code fence renderers
 *
 * This is the React variant, parallel to the iframe-based `NotePreview`.
 */
export const NotePreviewReact = React.forwardRef<
  NotePreviewReactRef,
  NotePreviewReactProps
>(function NotePreviewReact(
  {
    content,
    onLinkClick,
    existingNotes = new Set(),
    onCreateNote,
    notePath = "",
    getCodeFenceRenderer,
    onFetchNoteContent,
    className,
    interactive = false,
  },
  ref,
) {
  const [embeddedNotes, setEmbeddedNotes] = useState<
    Record<string, string>
  >({});
  const containerRef = useRef<HTMLDivElement>(null);

  React.useImperativeHandle(ref, () => ({
    scrollToHeading: (index: number) => {
      const el = containerRef.current?.querySelectorAll(
        "[id^='heading-']",
      )[index];
      el?.scrollIntoView({ behavior: "smooth" });
    },
  }));

  const currentChain = useMemo(() => {
    const chain = new Set<string>();
    if (notePath) chain.add(notePath);
    return chain;
  }, [notePath]);

  // Extract note embeds that need fetching
  const noteEmbeds = useMemo(() => {
    if (!onFetchNoteContent) return [];
    return Array.from(content.matchAll(/!\[\[([^\]]+)\]\]/g))
      .map((m) => m[1])
      .filter((name): name is string => name !== undefined)
      .filter((name) => !IMAGE_EXTENSIONS.test(name))
      .filter(
        (name) =>
          !currentChain.has(name) && !currentChain.has(name + ".md"),
      );
  }, [content, currentChain, onFetchNoteContent]);

  useEffect(() => {
    if (!onFetchNoteContent || noteEmbeds.length === 0) return;
    let cancelled = false;
    const toFetch = noteEmbeds.filter((name) => !(name in embeddedNotes));
    if (toFetch.length === 0) return;

    Promise.all(
      toFetch.map(async (name) => {
        try {
          const c = await onFetchNoteContent(name);
          return { name, content: c };
        } catch {
          return { name, content: null };
        }
      }),
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

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteEmbeds.join(","), onFetchNoteContent]);

  const { frontmatter, body: contentBody } = useMemo(
    () => parseFrontmatter(content),
    [content],
  );

  // Index every fenced code block in the raw on-disk content. Plugins
  // round-tripping a fence (e.g. kanban save) need raw-file line numbers
  // so they can call api.notes.replaceFenceAtRange without re-deriving
  // offsets from a substituted body. The index is keyed by (language,
  // body) → ordered list of raw {startLine, endLine}; the codeComponent
  // claims the k-th match for the k-th lookup of the same key, where k
  // is reset on every render via a per-render cursor map.
  const rawFenceIndex = useMemo(() => {
    const lines = content.split("\n");
    type Entry = { startLine: number; endLine: number };
    const byKey = new Map<string, Entry[]>();
    let i = 0;
    while (i < lines.length) {
      const m = lines[i]?.match(/^([ \t]{0,3})(`{3,}|~{3,})\s*([^\s`~]*)/);
      if (!m) {
        i++;
        continue;
      }
      const indent = m[1] ?? "";
      const ticks = m[2] ?? "";
      const lang = m[3] ?? "";
      const startLine = i;
      let end = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] ?? "";
        // Closing fence: same kind, same-or-greater length, same indent
        // tolerance per CommonMark (we tolerate the same indent prefix).
        const closeRe = new RegExp(
          `^[ \\t]{0,3}${ticks[0] === "`" ? "`" : "~"}{${ticks.length},}\\s*$`,
        );
        if (closeRe.test(line)) {
          end = j;
          break;
        }
      }
      if (end === -1) {
        // Unterminated fence — stop scanning.
        break;
      }
      const body = lines.slice(startLine + 1, end).join("\n");
      const key = `${lang}::${body}`;
      const list = byKey.get(key);
      const entry: Entry = { startLine, endLine: end };
      if (list) list.push(entry);
      else byKey.set(key, [entry]);
      void indent;
      i = end + 1;
    }
    return byKey;
  }, [content]);


  const transformedContent = useMemo(() => {
    return contentBody
      .replace(
        /!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp))\]\]/gi,
        (_match, fileName: string) =>
          `<div class="embed-image"><img src="/api/files/${encodeURIComponent(fileName)}" alt="${escapeHtml(fileName)}" /></div>`,
      )
      .replace(/!\[\[([^\]]+)\]\]/g, (_match, noteName: string) => {
        if (IMAGE_EXTENSIONS.test(noteName)) return _match;
        if (currentChain.has(noteName) || currentChain.has(noteName + ".md")) {
          return `<div class="embed-note embed-circular"><p><em>Circular embed: ${escapeHtml(noteName)}</em></p></div>`;
        }
        const noteContent = embeddedNotes[noteName];
        if (noteContent === undefined) {
          return `<div class="embed-note embed-loading"><p>Loading ${escapeHtml(noteName)}…</p></div>`;
        }
        const strippedContent = noteContent.replace(/^#\s+.+\n?/, "");
        return `<div class="embed-note"><div class="embed-note-header"><a class="wiki-link" data-wiki-target="${escapeHtml(noteName)}" href="#">${escapeHtml(noteName)}</a></div>\n\n${strippedContent}\n\n</div>`;
      });
  }, [contentBody, currentChain, embeddedNotes]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;

      const wikiTarget = target.closest<HTMLElement>("[data-wiki-target]");
      if (wikiTarget) {
        e.preventDefault();
        const noteName = wikiTarget.getAttribute("data-wiki-target");
        const isBroken = wikiTarget.getAttribute("data-broken") === "true";
        if (noteName) {
          if (isBroken && onCreateNote) {
            onCreateNote(noteName);
          } else {
            onLinkClick(noteName);
          }
        }
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>("a");
      if (anchor) {
        const href = anchor.getAttribute("href");
        if (!href || href === "#") return;
        if (/^https?:\/\//i.test(href)) return;
        e.preventDefault();
        const noteName = decodeURIComponent(href.replace(/^\//, ""));
        if (noteName) onLinkClick(noteName);
      }
    },
    [onLinkClick, onCreateNote],
  );

  // Heading IDs are positional: `heading-1`, `heading-2`, … in
  // document order. The counter is reset to zero at the top of every
  // render so the numbering is stable for a given markdown structure;
  // typing somewhere that doesn't add or remove a heading leaves all
  // existing in-note anchor links pointing at the right element. We
  // intentionally do NOT include any content-derived value (length,
  // hash) in the id — that would invalidate every anchor on every
  // keystroke. Components must be re-created per render (no useMemo)
  // because the counter is closed over by the heading factories.
  const headingCounter = { value: 0 };
  const makeHeading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    function HeadingComponent({
      children,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement>) {
      headingCounter.value++;
      return (
        <Tag id={`heading-${headingCounter.value}`} {...props}>
          {children}
        </Tag>
      );
    };
  const headingComponents = {
    h1: makeHeading("h1"),
    h2: makeHeading("h2"),
    h3: makeHeading("h3"),
    h4: makeHeading("h4"),
    h5: makeHeading("h5"),
    h6: makeHeading("h6"),
  };

  // Per-render cursor for resolving identical raw fences to their
  // i-th occurrence in declaration order. Re-created every render so
  // ReactMarkdown's top-down walk always starts from index 0. We
  // intentionally do NOT useMemo the codeComponent factory because the
  // closure must capture a fresh cursor map on every render — same-
  // content re-renders would otherwise carry stale counts.
  const fenceCursor = new Map<string, number>();
  const codeComponent = (() => {
    return function CodeBlock({
      className: cls,
      children,
      node,
      ...props
    }: React.HTMLAttributes<HTMLElement> & {
      node?: {
        position?: {
          start: { line: number };
          end: { line: number };
        };
      };
    }) {
      const match = cls?.match(/language-(\w+)/);
      const language = match?.[1];

      if (language && getCodeFenceRenderer) {
        const renderer = getCodeFenceRenderer(language);
        if (renderer) {
          const pluginContent = String(children).replace(/\n$/, "");
          const RendererComponent = renderer.component;

          // hast positions are 1-based, inclusive. The plugin API exposes
          // 0-based, inclusive ranges. Compute both range + raw source
          // when position data is available.
          let range: { startLine: number; endLine: number } | undefined;
          let source: string | undefined;
          const pos = node?.position;
          if (pos) {
            const startLine = pos.start.line - 1;
            const endLine = pos.end.line - 1;
            range = { startLine, endLine };
            const noteLines = transformedContent.split("\n");
            source = noteLines.slice(startLine, endLine + 1).join("\n");
          }

          // Resolve the raw-file range by matching (language, body) in
          // the on-disk content. Round-trip plugins (kanban, excalidraw,
          // mermaid…) need this to call api.notes.replaceFenceAtRange
          // without re-deriving offsets after frontmatter stripping +
          // wikilink-embed substitution. Identical fences resolve to the
          // i-th occurrence in declaration order via a per-render cursor.
          let rawRange:
            | { startLine: number; endLine: number }
            | undefined;
          const key = `${language}::${pluginContent}`;
          const candidates = rawFenceIndex.get(key);
          if (candidates && candidates.length > 0) {
            const consumed = fenceCursor.get(key) ?? 0;
            const pick = candidates[consumed];
            if (pick) {
              rawRange = pick;
              fenceCursor.set(key, consumed + 1);
            }
          }

          return (
            <RendererComponent
              content={pluginContent}
              notePath={notePath}
              range={range}
              rawRange={rawRange}
              source={source}
              interactive={interactive}
            />
          );
        }
      }

      return (
        <code className={cls} {...props}>
          {children}
        </code>
      );
    };
  })();

  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      [
        remarkWikiLink,
        {
          permalinks: Array.from(existingNotes),
          pageResolver: (name: string) => [name],
          hrefTemplate: (permalink: string) => `/${permalink}`,
          wikiLinkClassName: "internal",
          newClassName: "new",
          aliasDivider: "|",
        },
      ],
    ] as Parameters<typeof ReactMarkdown>[0]["remarkPlugins"],
    [existingNotes],
  );

  const rehypePlugins = useMemo(
    () => [
      rehypeRaw,
      [rehypeSanitize, SANITIZE_SCHEMA],
      [rehypeWikiLinks, { existingNotes }],
    ] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"],
    [existingNotes],
  );

  return (
    <div
      ref={containerRef}
      className={cn("markdown-preview p-6 max-w-3xl mx-auto", className)}
      onClick={handleClick}
    >
      {frontmatter && <FrontmatterBlock frontmatter={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{ ...headingComponents, code: codeComponent }}
      >
        {transformedContent}
      </ReactMarkdown>
    </div>
  );
});

NotePreviewReact.displayName = "NotePreviewReact";
