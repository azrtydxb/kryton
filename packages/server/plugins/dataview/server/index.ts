import type { PluginAPI, SearchResult } from "../../../types/server";

// ---------------------------------------------------------------------------
// Query parser
// ---------------------------------------------------------------------------

type QueryType = "LIST" | "TABLE";
type SortDirection = "ASC" | "DESC";

interface ParsedQuery {
  type: QueryType;
  columns: string[]; // for TABLE queries
  fromTag: string | null;
  whereField: string | null;
  whereOp: string | null;
  whereValue: string | null;
  sortField: string | null;
  sortDir: SortDirection;
}

function parseQuery(raw: string): ParsedQuery {
  const normalized = raw.trim().replace(/\s+/g, " ");

  const result: ParsedQuery = {
    type: "LIST",
    columns: [],
    fromTag: null,
    whereField: null,
    whereOp: null,
    whereValue: null,
    sortField: null,
    sortDir: "ASC",
  };

  // Detect query type: TABLE <columns> or LIST
  const tableMatch = normalized.match(/^TABLE\s+(.*?)(?:\s+FROM|\s+WHERE|\s+SORT|$)/i);
  if (tableMatch) {
    result.type = "TABLE";
    result.columns = tableMatch[1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  } else if (/^LIST\b/i.test(normalized)) {
    result.type = "LIST";
  }

  // FROM #tag
  const fromMatch = normalized.match(/FROM\s+#([\w-]+)/i);
  if (fromMatch) {
    result.fromTag = fromMatch[1];
  }

  // WHERE field op value  (op: =, !=, contains, >, <)
  const whereMatch = normalized.match(
    /WHERE\s+(\w+)\s+(=|!=|contains|>|<)\s+"?([^"]+?)"?(?:\s+SORT|\s*$)/i
  );
  if (whereMatch) {
    result.whereField = whereMatch[1].toLowerCase();
    result.whereOp = whereMatch[2].toLowerCase();
    result.whereValue = whereMatch[3];
  }

  // SORT field [ASC|DESC]
  const sortMatch = normalized.match(/SORT\s+(\w+)(?:\s+(ASC|DESC))?/i);
  if (sortMatch) {
    result.sortField = sortMatch[1].toLowerCase();
    result.sortDir = (sortMatch[2]?.toUpperCase() as SortDirection) || "ASC";
  }

  return result;
}

// ---------------------------------------------------------------------------
// Filter helper
// ---------------------------------------------------------------------------

function matchesWhere(
  note: SearchResult,
  field: string | null,
  op: string | null,
  value: string | null
): boolean {
  if (!field || !op || value === null) return true;

  const noteValue: string =
    field === "title"
      ? note.title
      : field === "path"
      ? note.path
      : note.snippet;

  const normalNote = noteValue.toLowerCase();
  const normalVal = value.toLowerCase();

  switch (op) {
    case "=":
      return normalNote === normalVal;
    case "!=":
      return normalNote !== normalVal;
    case "contains":
      return normalNote.includes(normalVal);
    case ">":
      return noteValue > value;
    case "<":
      return noteValue < value;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Plugin activation
// ---------------------------------------------------------------------------

export function activate(api: PluginAPI): void {
  api.routes.register("get", "/query", async (req: any, res: any) => {
    const rawQuery: string = req.query?.q ?? "";

    if (!rawQuery.trim()) {
      res.status(400).json({ error: "Missing query parameter 'q'" });
      return;
    }

    // Resolve the user from the request (Mnemo attaches req.user)
    const userId: string = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let parsed: ParsedQuery;
    try {
      parsed = parseQuery(rawQuery);
    } catch (err: any) {
      res.status(400).json({ error: `Query parse error: ${err.message}` });
      return;
    }

    try {
      // Build a search term: use the tag if provided, otherwise search everything
      const searchTerm = parsed.fromTag ? `#${parsed.fromTag}` : "";
      let results: SearchResult[] = await api.search.query(userId, searchTerm);

      // Apply WHERE filter
      results = results.filter((note) =>
        matchesWhere(note, parsed.whereField, parsed.whereOp, parsed.whereValue)
      );

      // Apply SORT
      if (parsed.sortField) {
        const field = parsed.sortField as keyof SearchResult;
        results.sort((a, b) => {
          const av = String(a[field] ?? "");
          const bv = String(b[field] ?? "");
          return parsed.sortDir === "ASC"
            ? av.localeCompare(bv)
            : bv.localeCompare(av);
        });
      }

      res.json({
        type: parsed.type,
        columns: parsed.columns,
        results: results.map((r) => ({
          path: r.path,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
        })),
      });
    } catch (err: any) {
      api.log.error("dataview query error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

export function deactivate(): void {
  // No persistent state to clean up
}
