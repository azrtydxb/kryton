const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect } = React;
function parseQueryType(raw) {
  const normalized = raw.trim().replace(/\s+/g, " ");
  const tableMatch = normalized.match(/^TABLE\s+(.*?)(?:\s+FROM|\s+WHERE|\s+SORT|$)/i);
  if (tableMatch) {
    const columns = tableMatch[1].split(",").map((c) => c.trim()).filter(Boolean);
    return { type: "TABLE", columns, raw: normalized };
  }
  return { type: "LIST", columns: [], raw: normalized };
}
function Spinner() {
  return h(
    "div",
    { className: "flex items-center justify-center p-8" },
    h(
      "div",
      { className: "text-sm text-gray-400 flex items-center gap-2" },
      h("div", {
        className: "w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"
      }),
      "Running query..."
    )
  );
}
function ErrorBox({ message }) {
  return h(
    "div",
    {
      className: "p-4 border border-red-300 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-900/20"
    },
    h(
      "div",
      { className: "text-sm font-medium text-red-600 dark:text-red-400 mb-1" },
      "Dataview error"
    ),
    h(
      "div",
      { className: "text-xs text-red-500 dark:text-red-400 font-mono" },
      message
    )
  );
}
function ListResults({ results }) {
  if (results.length === 0) {
    return h(
      "div",
      { className: "text-sm text-gray-400 dark:text-gray-500 italic p-2" },
      "No results found."
    );
  }
  return h(
    "ul",
    { className: "space-y-1 p-2" },
    ...results.map(
      (note) => h(
        "li",
        { key: note.path, className: "flex items-start gap-2" },
        h(
          "span",
          { className: "text-violet-500 mt-0.5 select-none" },
          "\u2022"
        ),
        h(
          "span",
          {
            className: "text-sm text-gray-800 dark:text-gray-200 font-medium leading-tight"
          },
          note.title || note.path
        )
      )
    )
  );
}
function TableResults({
  columns,
  results
}) {
  const cols = columns.length > 0 ? columns : ["title", "snippet"];
  if (results.length === 0) {
    return h(
      "div",
      { className: "text-sm text-gray-400 dark:text-gray-500 italic p-2" },
      "No results found."
    );
  }
  return h(
    "div",
    { className: "overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700" },
    h(
      "table",
      { className: "w-full text-sm" },
      h(
        "thead",
        {
          className: "bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
        },
        h(
          "tr",
          null,
          ...cols.map(
            (col) => h(
              "th",
              {
                key: col,
                className: "px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
              },
              col
            )
          )
        )
      ),
      h(
        "tbody",
        { className: "divide-y divide-gray-100 dark:divide-gray-800" },
        ...results.map(
          (note, i) => h(
            "tr",
            {
              key: note.path,
              className: i % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/50 dark:bg-gray-800/50"
            },
            ...cols.map(
              (col) => h(
                "td",
                {
                  key: col,
                  className: "px-4 py-2 text-gray-700 dark:text-gray-300 align-top"
                },
                col === "title" ? h(
                  "span",
                  { className: "font-medium text-violet-600 dark:text-violet-400" },
                  note.title || note.path
                ) : col === "path" ? h(
                  "span",
                  { className: "font-mono text-xs text-gray-500" },
                  note.path
                ) : col === "snippet" ? h(
                  "span",
                  { className: "text-xs text-gray-500 line-clamp-2" },
                  note.snippet
                ) : String(note[col] ?? "")
              )
            )
          )
        )
      )
    )
  );
}
function DataviewRenderer({ content }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const apiRef = DataviewRenderer.__api;
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const encoded = encodeURIComponent(content.trim());
        const resp = await apiRef.api.fetch(`/query?q=${encoded}`);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: resp.statusText }));
          throw new Error(body?.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [content]);
  const parsed = parseQueryType(content);
  return h(
    "div",
    {
      className: "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden"
    },
    // Header bar
    h(
      "div",
      {
        className: "flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
      },
      h(
        "span",
        { className: "text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide" },
        "Dataview"
      ),
      h(
        "span",
        {
          className: "ml-auto text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-mono"
        },
        parsed.type
      )
    ),
    // Body
    loading ? h(Spinner, null) : error ? h(ErrorBox, { message: error }) : data ? data.type === "TABLE" ? h(TableResults, { columns: data.columns, results: data.results }) : h(ListResults, { results: data.results }) : null
  );
}
function activate(api) {
  DataviewRenderer.__api = api;
  api.markdown.registerCodeFenceRenderer("dataview", DataviewRenderer);
}
function deactivate() {
}
export {
  activate,
  deactivate
};
