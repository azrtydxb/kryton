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
function pad2(n) {
  return String(n).padStart(2, "0");
}
function applyDateFormat(date, format) {
  return format.replace("YYYY", String(date.getFullYear())).replace("MM", pad2(date.getMonth() + 1)).replace("DD", pad2(date.getDate())).replace("HH", pad2(date.getHours())).replace("mm", pad2(date.getMinutes())).replace("ss", pad2(date.getSeconds()));
}
function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
function processTemplate(template, variables = {}) {
  const now = /* @__PURE__ */ new Date();
  let result = template.replace(/\{\{date:([^}]+)\}\}/g, (_match, fmt) => {
    return applyDateFormat(now, fmt.trim());
  });
  result = result.replace(/\{\{date\}\}/g, applyDateFormat(now, "YYYY-MM-DD"));
  result = result.replace(/\{\{time\}\}/g, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
  result = result.replace(/\{\{now\}\}/g, now.toISOString());
  result = result.replace(/\{\{random\}\}/g, randomId());
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : _match;
  });
  return result;
}
function collectPaths(entries) {
  const paths = [];
  for (const entry of entries) {
    if (entry.type === "file") {
      paths.push(entry.path);
    } else if (entry.children) {
      paths.push(...collectPaths(entry.children));
    }
  }
  return paths;
}
function activate(api) {
  api.log.info("Templater plugin activated");
  api.routes.register("post", "/process", async (req, res) => {
    try {
      const { template, variables } = req.body;
      if (typeof template !== "string") {
        res.status(400).json({ error: "template (string) is required" });
        return;
      }
      const processed = processTemplate(template, variables ?? {});
      res.json({ content: processed });
    } catch (err) {
      api.log.error("Templater /process error", err);
      res.status(500).json({ error: "Failed to process template" });
    }
  });
  api.routes.register("get", "/templates", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      let entries = [];
      try {
        entries = await api.notes.list(userId, "Templates");
      } catch {
        res.json({ templates: [] });
        return;
      }
      const paths = collectPaths(entries);
      const templates = paths.filter((p) => p.endsWith(".md")).map((p) => {
        const parts = p.split("/");
        const filename = parts[parts.length - 1] ?? p;
        const name = filename.replace(/\.md$/i, "");
        return { name, path: p };
      });
      res.json({ templates });
    } catch (err) {
      api.log.error("Templater /templates error", err);
      res.status(500).json({ error: "Failed to list templates" });
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
