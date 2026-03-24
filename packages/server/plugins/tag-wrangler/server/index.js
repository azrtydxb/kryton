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
function tagRegex(tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`#${escaped}(?![\\w-])`, "g");
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
  api.log.info("Tag Wrangler plugin activated");
  api.routes.register("get", "/tags", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);
      const tagCounts = {};
      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            const matches = note.content.match(/#([\w-]+)/g);
            if (matches) {
              for (const match of matches) {
                const tag = match.slice(1);
                tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
              }
            }
          } catch {
          }
        })
      );
      const tags = Object.entries(tagCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      res.json({ tags });
    } catch (err) {
      api.log.error("Tag Wrangler /tags error", err);
      res.status(500).json({ error: "Failed to list tags" });
    }
  });
  api.routes.register("post", "/rename", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { oldTag, newTag } = req.body;
      if (!oldTag || !newTag) {
        res.status(400).json({ error: "oldTag and newTag are required" });
        return;
      }
      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);
      const regex = tagRegex(oldTag);
      let updatedCount = 0;
      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            if (regex.test(note.content)) {
              regex.lastIndex = 0;
              const updated = note.content.replace(regex, `#${newTag}`);
              await api.notes.update(userId, notePath, updated);
              updatedCount++;
            }
          } catch {
          }
        })
      );
      res.json({ success: true, updatedNotes: updatedCount });
    } catch (err) {
      api.log.error("Tag Wrangler /rename error", err);
      res.status(500).json({ error: "Failed to rename tag" });
    }
  });
  api.routes.register("post", "/merge", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { sourceTag, targetTag } = req.body;
      if (!sourceTag || !targetTag) {
        res.status(400).json({ error: "sourceTag and targetTag are required" });
        return;
      }
      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);
      const regex = tagRegex(sourceTag);
      let updatedCount = 0;
      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            if (regex.test(note.content)) {
              regex.lastIndex = 0;
              const updated = note.content.replace(regex, `#${targetTag}`);
              await api.notes.update(userId, notePath, updated);
              updatedCount++;
            }
          } catch {
          }
        })
      );
      res.json({ success: true, updatedNotes: updatedCount });
    } catch (err) {
      api.log.error("Tag Wrangler /merge error", err);
      res.status(500).json({ error: "Failed to merge tag" });
    }
  });
  api.routes.register("post", "/delete", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { tag } = req.body;
      if (!tag) {
        res.status(400).json({ error: "tag is required" });
        return;
      }
      const entries = await api.notes.list(userId);
      const paths = collectPaths(entries);
      const regex = tagRegex(tag);
      let updatedCount = 0;
      await Promise.all(
        paths.map(async (notePath) => {
          try {
            const note = await api.notes.get(userId, notePath);
            if (regex.test(note.content)) {
              regex.lastIndex = 0;
              const updated = note.content.replace(regex, "").replace(/  +/g, " ").trimEnd();
              await api.notes.update(userId, notePath, updated);
              updatedCount++;
            }
          } catch {
          }
        })
      );
      res.json({ success: true, updatedNotes: updatedCount });
    } catch (err) {
      api.log.error("Tag Wrangler /delete error", err);
      res.status(500).json({ error: "Failed to delete tag" });
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
