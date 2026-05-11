/**
 * Note chunker for semantic search.
 *
 * Pure function, no I/O. Splits a note's markdown body into windows
 * suitable for embedding. The chunker is reused by Phase 3's embed
 * worker; keep it dependency-free.
 *
 * Approximate token counting: we split on whitespace. A real tokenizer
 * (sentencepiece / wordpiece) yields a different count, but the
 * embedder enforces its own max-length at embed time so this only
 * affects chunk boundaries.
 */

const CHUNK_TOKENS = 256;
const CHUNK_OVERLAP = 32;
const MAX_CHUNKS = 64;

export interface NoteChunk {
  index: number;
  text: string;
}

interface Paragraph {
  text: string;
  tokens: number;
  atomic: boolean; // true for code fences — never split mid-fence
}

function countTokens(text: string): number {
  // Whitespace tokenization — close enough for window sizing.
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Split body into paragraphs. A "paragraph" is either a normal
 * markdown paragraph (separated by blank lines) or a code fence
 * (which may span multiple blank-line breaks internally — we
 * stitch them back together so the fence stays intact).
 */
function splitParagraphs(body: string): Paragraph[] {
  // Detect fenced code blocks first and protect their internals.
  const out: Paragraph[] = [];
  const lines = body.split("\n");
  let i = 0;
  let buf: string[] = [];

  const flushBuf = (): void => {
    if (buf.length === 0) return;
    const joined = buf.join("\n");
    // Split the buffer into paragraphs on 2+ newlines.
    const paras = joined.split(/\n{2,}/);
    for (const p of paras) {
      const text = p.trim();
      if (text.length === 0) continue;
      out.push({ text, tokens: countTokens(text), atomic: false });
    }
    buf = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim().startsWith("```")) {
      flushBuf();
      const fence: string[] = [line];
      i++;
      while (i < lines.length) {
        const inner = lines[i] ?? "";
        fence.push(inner);
        if (inner.trim().startsWith("```")) {
          i++;
          break;
        }
        i++;
      }
      const text = fence.join("\n");
      out.push({ text, tokens: countTokens(text), atomic: true });
      continue;
    }
    buf.push(line);
    i++;
  }
  flushBuf();
  return out;
}

/**
 * Split an over-sized non-atomic paragraph into smaller pieces on
 * sentence boundaries. If a single "sentence" is still > CHUNK_TOKENS
 * we just emit it as-is — better an oversized chunk than truncation.
 */
function splitOversizedParagraph(p: Paragraph): Paragraph[] {
  if (p.tokens <= CHUNK_TOKENS) return [p];
  const sentences = p.text.split(/(?<=[.!?])\s+/);
  const out: Paragraph[] = [];
  let current = "";
  let currentTokens = 0;
  for (const s of sentences) {
    const sTokens = countTokens(s);
    if (currentTokens + sTokens > CHUNK_TOKENS && current.length > 0) {
      out.push({ text: current.trim(), tokens: currentTokens, atomic: false });
      current = s;
      currentTokens = sTokens;
    } else {
      current = current.length === 0 ? s : `${current} ${s}`;
      currentTokens += sTokens;
    }
  }
  if (current.trim().length > 0) {
    out.push({ text: current.trim(), tokens: currentTokens, atomic: false });
  }
  return out.length > 0 ? out : [p];
}

/**
 * Take the trailing ~CHUNK_OVERLAP tokens of `text` to seed the next
 * window for context continuity.
 */
function tailOverlap(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= CHUNK_OVERLAP) return text.trim();
  return words.slice(words.length - CHUNK_OVERLAP).join(" ");
}

/**
 * Split a markdown body into chunks for embedding.
 *
 * - The note title is prepended to every chunk's text (so the title's
 *   semantic signal propagates through to every chunk's vector).
 * - Code fences (``` ... ```) are kept whole even if they exceed
 *   CHUNK_TOKENS — splitting mid-fence destroys context.
 * - Otherwise, a sliding window over paragraphs aims for ~256 tokens
 *   per chunk with ~32-token overlap between adjacent chunks.
 * - Token count is approximated by whitespace splitting; the embedder
 *   tokenizes properly at embed time.
 * - Every chunk's `text` field starts with `title + "\n\n"` so even
 *   a single-chunk note carries the title forward.
 * - Always returns at least one chunk, even for an empty body.
 * - Caps at MAX_CHUNKS for pathological notes.
 */
export function chunkNote(title: string, body: string): NoteChunk[] {
  const titlePrefix = title.length > 0 ? `${title}\n\n` : "";

  if (body.trim().length === 0) {
    return [{ index: 0, text: title.length > 0 ? title : "" }];
  }

  const rawParagraphs = splitParagraphs(body);
  // Expand any oversized non-atomic paragraphs.
  const paragraphs: Paragraph[] = [];
  for (const p of rawParagraphs) {
    if (p.atomic || p.tokens <= CHUNK_TOKENS) {
      paragraphs.push(p);
    } else {
      paragraphs.push(...splitOversizedParagraph(p));
    }
  }

  const chunks: string[] = [];
  let window = "";
  let windowTokens = 0;

  const flushWindow = (): void => {
    const text = window.trim();
    if (text.length === 0) return;
    chunks.push(text);
    const overlap = tailOverlap(text);
    window = overlap;
    windowTokens = countTokens(overlap);
  };

  for (const p of paragraphs) {
    if (p.atomic && p.tokens > CHUNK_TOKENS) {
      // Oversized code fence — emit as its own chunk regardless.
      flushWindow();
      // Reset window completely (don't carry overlap from a code fence).
      window = "";
      windowTokens = 0;
      chunks.push(p.text);
      continue;
    }

    if (windowTokens > 0 && windowTokens + p.tokens > CHUNK_TOKENS) {
      flushWindow();
    }
    window = window.length === 0 ? p.text : `${window}\n\n${p.text}`;
    windowTokens += p.tokens;
  }
  flushWindow();

  // Drop any window that is only the overlap tail of a prior chunk
  // (happens when flushWindow leaves an overlap that no further
  // paragraph consumes — that overlap is duplicate content).
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]!;
    const prev = chunks[chunks.length - 2]!;
    if (prev.endsWith(last)) {
      chunks.pop();
    }
  }

  const capped = chunks.slice(0, MAX_CHUNKS);
  return capped.map((text, index) => ({
    index,
    text: `${titlePrefix}${text}`,
  }));
}
