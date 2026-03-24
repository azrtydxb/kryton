const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useRef, useCallback } = React;
let mermaidInstance = null;
let mermaidLoading = false;
let mermaidLoadCallbacks = [];
async function loadMermaid() {
  if (mermaidInstance) return mermaidInstance;
  if (mermaidLoading) {
    return new Promise((resolve) => {
      mermaidLoadCallbacks.push(resolve);
    });
  }
  mermaidLoading = true;
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mermaidInstance = mod.default;
    mermaidInstance.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default"
    });
    mermaidLoadCallbacks.forEach((cb) => cb(mermaidInstance));
    mermaidLoadCallbacks = [];
    return mermaidInstance;
  } catch (err) {
    mermaidLoading = false;
    throw err;
  }
}
let renderCounter = 0;
function MermaidRenderer({ content, notePath }) {
  const [svg, setSvg] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const render = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const mermaid = await loadMermaid();
      renderCounter++;
      const id = `mermaid-${renderCounter}-${Date.now()}`;
      const { svg: renderedSvg } = await mermaid.render(id, content);
      setSvg(renderedSvg);
    } catch (err) {
      setError(err?.message || "Failed to render diagram");
      setSvg(null);
    } finally {
      setLoading(false);
    }
  }, [content]);
  useEffect(() => {
    render();
  }, [render]);
  if (loading) {
    return h(
      "div",
      {
        className: "flex items-center justify-center p-8 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-surface-900"
      },
      h(
        "div",
        { className: "text-sm text-gray-400 flex items-center gap-2" },
        h("div", {
          className: "w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"
        }),
        "Rendering diagram..."
      )
    );
  }
  if (error) {
    return h(
      "div",
      {
        className: "p-4 border border-red-300 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-900/20"
      },
      h(
        "div",
        { className: "text-sm font-medium text-red-600 dark:text-red-400 mb-2" },
        "Mermaid diagram error"
      ),
      h(
        "pre",
        {
          className: "text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap font-mono"
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
            className: "mt-1 text-xs text-gray-500 whitespace-pre-wrap font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded"
          },
          content
        )
      )
    );
  }
  return h("div", {
    ref: containerRef,
    className: "mermaid-diagram flex justify-center p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto",
    dangerouslySetInnerHTML: { __html: svg }
  });
}
function activate(api) {
  api.markdown.registerCodeFenceRenderer("mermaid", MermaidRenderer);
}
function deactivate() {
}
export {
  activate,
  deactivate
};
