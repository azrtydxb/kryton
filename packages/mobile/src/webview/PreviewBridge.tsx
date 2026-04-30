import React, { useCallback } from "react";
import { Linking, StyleSheet } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { useRouter } from "expo-router";
import { getDatabase } from "../db";

interface PreviewBridgeProps {
  content: string;
  darkMode: boolean;
}

/**
 * Resolve a wiki-link target (e.g. "Welcome", "Projects/Kryton Roadmap") to an
 * actual note path in the local SQLite database. Uses the same fuzzy matching
 * as the graph view and web client: tries exact match, with/without .md suffix,
 * and suffix matching for nested paths. Case-insensitive.
 */
function resolveNoteLink(target: string): string | null {
  const db = getDatabase();
  const allPaths = db
    .getAllSync<{ path: string }>(
      "SELECT path FROM notes WHERE _status != 'deleted'"
    )
    .map((r) => r.path);

  const targetMd = target.endsWith(".md") ? target : `${target}.md`;
  const targetLower = target.toLowerCase();
  const targetMdLower = targetMd.toLowerCase();

  for (const p of allPaths) {
    const pLower = p.toLowerCase();
    if (
      pLower === targetMdLower ||
      pLower === targetLower ||
      pLower.endsWith(`/${targetMdLower}`) ||
      pLower.endsWith(`/${targetLower}`)
    ) {
      return p;
    }
  }
  return null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(md: string): string {
  let html = escapeHtml(md);

  // Headings
  html = html.replace(/^#{6}\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#{5}\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#{4}\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^#{3}\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^#{2}\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#{1}\s+(.+)$/gm, "<h1>$1</h1>");

  // Horizontal rules
  html = html.replace(/^---+$/gm, "<hr>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Fenced code blocks
  html = html.replace(
    /```[\w]*\n([\s\S]*?)```/g,
    "<pre><code>$1</code></pre>"
  );

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/^[\-\*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");

  // Wiki-links: [[target|label]] or [[target]]
  html = html.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, target, label) => {
      const display = label || target;
      return `<a href="#" class="wikilink" data-target="${escapeHtml(target)}">${escapeHtml(display)}</a>`;
    }
  );

  // Standard links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>'
  );

  // Paragraphs: wrap consecutive non-empty, non-block lines
  const lines = html.split("\n");
  const result: string[] = [];
  let inParagraph = false;
  const blockTags = /^<(h[1-6]|ul|ol|li|pre|blockquote|hr)/;

  for (const line of lines) {
    if (line.trim() === "") {
      if (inParagraph) {
        result.push("</p>");
        inParagraph = false;
      }
      continue;
    }
    if (blockTags.test(line.trim())) {
      if (inParagraph) {
        result.push("</p>");
        inParagraph = false;
      }
      result.push(line);
    } else {
      if (!inParagraph) {
        result.push("<p>");
        inParagraph = true;
      }
      result.push(line);
    }
  }
  if (inParagraph) result.push("</p>");

  return result.join("\n");
}

function buildPreviewHTML(content: string, darkMode: boolean): string {
  const bg = darkMode ? "#0d1117" : "#ffffff";
  const fg = darkMode ? "#e2e8f0" : "#1a1a1a";
  const fgSecondary = darkMode ? "#94a3b8" : "#6b7280";
  const codeBg = darkMode ? "#1a1f2e" : "#f3f4f6";
  const codeFg = darkMode ? "#e2e8f0" : "#1f2937";
  const borderColor = darkMode ? "#374151" : "#e5e7eb";
  const linkColor = "#7c3aed";

  const body = markdownToHtml(content);

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: ${bg};
    color: ${fg};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 15px;
    line-height: 1.7;
  }
  .content {
    padding: 16px;
    max-width: 100%;
  }
  h1, h2, h3, h4, h5, h6 {
    color: ${fg};
    margin: 1.2em 0 0.5em;
    line-height: 1.3;
    font-weight: 600;
  }
  h1 { font-size: 1.8em; border-bottom: 1px solid ${borderColor}; padding-bottom: 0.3em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid ${borderColor}; padding-bottom: 0.2em; }
  h3 { font-size: 1.2em; }
  p { margin: 0.6em 0; }
  a {
    color: ${linkColor};
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }
  a.wikilink {
    color: ${linkColor};
    background: rgba(124, 58, 237, 0.1);
    border-radius: 3px;
    padding: 0 2px;
  }
  code {
    background: ${codeBg};
    color: ${codeFg};
    padding: 0.1em 0.4em;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }
  pre {
    background: ${codeBg};
    color: ${codeFg};
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 1em 0;
    border: 1px solid ${borderColor};
  }
  pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: 0.88em;
  }
  blockquote {
    border-left: 3px solid ${linkColor};
    margin: 0.8em 0;
    padding: 0.4em 1em;
    color: ${fgSecondary};
    background: rgba(124, 58, 237, 0.05);
    border-radius: 0 6px 6px 0;
  }
  ul, ol {
    margin: 0.6em 0;
    padding-left: 1.5em;
  }
  li { margin: 0.25em 0; }
  hr {
    border: none;
    border-top: 1px solid ${borderColor};
    margin: 1.5em 0;
  }
  strong { font-weight: 600; }
  em { font-style: italic; }
</style>
</head>
<body>
<div class="content">${body}</div>
<script>
  // Intercept ALL link clicks — wiki-links, markdown links, and any other anchors
  document.addEventListener('click', function(e) {
    var link = e.target.closest ? e.target.closest('a') : null;
    if (!link) return;
    e.preventDefault();

    // Wiki-links have data-target
    var wikiTarget = link.getAttribute('data-target');
    if (wikiTarget) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'wikilink',
          target: wikiTarget
        }));
      }
      return;
    }

    // Regular links — check if external URL or internal note reference
    var href = link.getAttribute('href');
    if (!href || href === '#') return;

    if (/^https?:\/\//i.test(href)) {
      // External URL — open in system browser
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'external-link',
          url: href
        }));
      }
    } else {
      // Treat as internal note link
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'wikilink',
          target: href.replace(/^\\//, '')
        }));
      }
    }
  });
</script>
</body>
</html>`;
}

export default function PreviewBridge({ content, darkMode }: PreviewBridgeProps) {
  const router = useRouter();

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "wikilink" && data.target) {
          const resolved = resolveNoteLink(data.target);
          if (resolved) {
            const encoded = encodeURIComponent(resolved);
            router.push(`/(app)/(tabs)/note/${encoded}` as never);
          }
        } else if (data.type === "external-link" && data.url) {
          if (/^https?:\/\//i.test(data.url)) {
            Linking.openURL(data.url);
          }
        }
      } catch {
        // ignore
      }
    },
    [router]
  );

  // Block the WebView from navigating away from the inline HTML
  const handleNavRequest = useCallback((event: ShouldStartLoadRequest) => {
    // Allow the initial HTML load, block everything else
    if (event.url === "about:blank" || event.url.startsWith("data:")) {
      return true;
    }
    return false;
  }, []);

  return (
    <WebView
      source={{ html: buildPreviewHTML(content, darkMode) }}
      style={styles.webview}
      onMessage={handleMessage}
      onShouldStartLoadWithRequest={handleNavRequest}
      javaScriptEnabled={true}
      scrollEnabled={true}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
});
