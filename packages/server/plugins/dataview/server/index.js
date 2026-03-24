"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(index_exports);
function parseQuery(raw) {
  const normalized = raw.trim().replace(/\s+/g, " ");
  const result = {
    type: "LIST",
    columns: [],
    fromTag: null,
    whereField: null,
    whereOp: null,
    whereValue: null,
    sortField: null,
    sortDir: "ASC"
  };
  const tableMatch = normalized.match(/^TABLE\s+(.*?)(?:\s+FROM|\s+WHERE|\s+SORT|$)/i);
  if (tableMatch) {
    result.type = "TABLE";
    result.columns = tableMatch[1].split(",").map((c) => c.trim()).filter(Boolean);
  } else if (/^LIST\b/i.test(normalized)) {
    result.type = "LIST";
  }
  const fromMatch = normalized.match(/FROM\s+#([\w-]+)/i);
  if (fromMatch) {
    result.fromTag = fromMatch[1];
  }
  const whereMatch = normalized.match(
    /WHERE\s+(\w+)\s+(=|!=|contains|>|<)\s+"?([^"]+?)"?(?:\s+SORT|\s*$)/i
  );
  if (whereMatch) {
    result.whereField = whereMatch[1].toLowerCase();
    result.whereOp = whereMatch[2].toLowerCase();
    result.whereValue = whereMatch[3];
  }
  const sortMatch = normalized.match(/SORT\s+(\w+)(?:\s+(ASC|DESC))?/i);
  if (sortMatch) {
    result.sortField = sortMatch[1].toLowerCase();
    result.sortDir = sortMatch[2]?.toUpperCase() || "ASC";
  }
  return result;
}
function matchesWhere(note, field, op, value) {
  if (!field || !op || value === null) return true;
  const noteValue = field === "title" ? note.title : field === "path" ? note.path : note.snippet;
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
function activate(api) {
  api.routes.register("get", "/query", async (req, res) => {
    const rawQuery = req.query?.q ?? "";
    if (!rawQuery.trim()) {
      res.status(400).json({ error: "Missing query parameter 'q'" });
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let parsed;
    try {
      parsed = parseQuery(rawQuery);
    } catch (err) {
      res.status(400).json({ error: `Query parse error: ${err.message}` });
      return;
    }
    try {
      const searchTerm = parsed.fromTag ? `#${parsed.fromTag}` : "";
      let results = await api.search.query(userId, searchTerm);
      results = results.filter(
        (note) => matchesWhere(note, parsed.whereField, parsed.whereOp, parsed.whereValue)
      );
      if (parsed.sortField) {
        const field = parsed.sortField;
        results.sort((a, b) => {
          const av = String(a[field] ?? "");
          const bv = String(b[field] ?? "");
          return parsed.sortDir === "ASC" ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      res.json({
        type: parsed.type,
        columns: parsed.columns,
        results: results.map((r) => ({
          path: r.path,
          title: r.title,
          snippet: r.snippet,
          score: r.score
        }))
      });
    } catch (err) {
      api.log.error("dataview query error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
