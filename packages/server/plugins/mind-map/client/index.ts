import type { ClientPluginAPI } from "../../../types/client";

const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useRef } = React;

// Markmap library handles loaded via CDN
let markmapLib: { Transformer: any; Markmap: any } | null = null;
let markmapLoading = false;
let markmapCallbacks: Array<(lib: { Transformer: any; Markmap: any }) => void> = [];

async function loadMarkmap(): Promise<{ Transformer: any; Markmap: any }> {
  if (markmapLib) return markmapLib;

  if (markmapLoading) {
    return new Promise((resolve) => {
      markmapCallbacks.push(resolve);
    });
  }

  markmapLoading = true;

  try {
    // @ts-ignore — CDN import resolved at runtime, not by TypeScript
    const libMod = await import("https://cdn.jsdelivr.net/npm/markmap-lib@0.17/dist/browser/index.js");
    // @ts-ignore — CDN import resolved at runtime, not by TypeScript
    const viewMod = await import("https://cdn.jsdelivr.net/npm/markmap-view@0.17/dist/browser/index.js");

    markmapLib = {
      Transformer: libMod.Transformer,
      Markmap: viewMod.Markmap,
    };

    markmapCallbacks.forEach((cb) => cb(markmapLib!));
    markmapCallbacks = [];
    return markmapLib;
  } catch (err) {
    markmapLoading = false;
    throw err;
  }
}

function MindMapRenderer({ content }: { content: string; notePath: string }): any {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setLoading(true);
      setError(null);

      try {
        const { Transformer, Markmap } = await loadMarkmap();

        if (cancelled || !svgRef.current) return;

        // Destroy previous instance if any
        if (mmRef.current) {
          try { mmRef.current.destroy(); } catch (_) {}
          mmRef.current = null;
        }

        // Clear SVG contents before re-rendering
        while (svgRef.current.firstChild) {
          svgRef.current.removeChild(svgRef.current.firstChild);
        }

        const transformer = new Transformer();
        const { root } = transformer.transform(content);

        mmRef.current = Markmap.create(svgRef.current, {
          autoFit: true,
          zoom: true,
          pan: true,
        }, root);

        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to render mind map");
          setLoading(false);
        }
      }
    }

    render();

    return () => {
      cancelled = true;
      if (mmRef.current) {
        try { mmRef.current.destroy(); } catch (_) {}
        mmRef.current = null;
      }
    };
  }, [content]);

  if (error) {
    return h(
      "div",
      {
        className:
          "p-4 border border-red-300 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-900/20",
      },
      h(
        "div",
        { className: "text-sm font-medium text-red-600 dark:text-red-400 mb-2" },
        "Mind map error"
      ),
      h(
        "pre",
        {
          className:
            "text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap font-mono",
        },
        error
      ),
      h(
        "details",
        { className: "mt-2" },
        h(
          "summary",
          { className: "text-xs text-gray-500 cursor-pointer" },
          "Show source"
        ),
        h(
          "pre",
          {
            className:
              "mt-1 text-xs text-gray-500 whitespace-pre-wrap font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded",
          },
          content
        )
      )
    );
  }

  return h(
    "div",
    {
      className:
        "relative border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 overflow-hidden",
      style: { minHeight: "320px" },
    },
    loading &&
      h(
        "div",
        {
          className:
            "absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10",
        },
        h(
          "div",
          { className: "text-sm text-gray-400 flex items-center gap-2" },
          h("div", {
            className:
              "w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin",
          }),
          "Loading mind map..."
        )
      ),
    h("svg", {
      ref: svgRef,
      className: "w-full",
      style: { height: "400px", display: "block" },
    })
  );
}

export function activate(api: ClientPluginAPI): void {
  api.markdown.registerCodeFenceRenderer("mindmap", MindMapRenderer);
}

export function deactivate(): void {
  // Cleanup handled by the plugin system
}
