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
const { exec } = require("child_process");
const pathMod = require("path");
function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    exec(`git ${args}`, { cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
function resolveNotesDir(dataDir) {
  return pathMod.resolve(dataDir, "..", "..", "..");
}
function renderCommitMessage(template) {
  return template.replace("{{date}}", (/* @__PURE__ */ new Date()).toISOString());
}
const state = {
  pendingCommit: false,
  intervalHandle: null,
  lastCommitTime: null,
  lastCommitHash: null
};
async function performCommit(notesDir, message, api) {
  try {
    await runGit("add -A", notesDir);
    const statusOut = await runGit("status --porcelain", notesDir);
    if (!statusOut) {
      api.log.info("git-backup: nothing to commit");
      return;
    }
    await runGit(`commit -m "${message.replace(/"/g, '\\"')}"`, notesDir);
    state.lastCommitTime = /* @__PURE__ */ new Date();
    const hash = await runGit("rev-parse --short HEAD", notesDir);
    state.lastCommitHash = hash;
    api.log.info(`git-backup: committed ${hash} \u2014 ${message}`);
    state.pendingCommit = false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    api.log.error(`git-backup: commit failed \u2014 ${msg}`);
  }
}
function activate(api) {
  api.log.info("Git Backup plugin activated");
  const notesDir = resolveNotesDir(api.plugin.dataDir);
  api.events.on("note:afterSave", () => {
    state.pendingCommit = true;
  });
  runGit("log -1 --format=%H %ci", notesDir).then((out) => {
    if (out) {
      const spaceIdx = out.indexOf(" ");
      state.lastCommitHash = spaceIdx > 0 ? out.slice(0, spaceIdx) : out;
      const dateStr = spaceIdx > 0 ? out.slice(spaceIdx + 1).trim() : "";
      state.lastCommitTime = dateStr ? new Date(dateStr) : null;
    }
  }).catch(() => {
  });
  async function maybeAutoCommit() {
    if (!state.pendingCommit) return;
    const rawInterval = await api.settings.get("autoCommitInterval");
    const intervalMinutes = typeof rawInterval === "number" ? rawInterval : 5;
    if (intervalMinutes === 0) return;
    const rawTemplate = await api.settings.get("commitMessage");
    const template = typeof rawTemplate === "string" ? rawTemplate : "auto-backup: {{date}}";
    await performCommit(notesDir, renderCommitMessage(template), api);
  }
  state.intervalHandle = setInterval(() => {
    maybeAutoCommit().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      api.log.error(`git-backup: interval error \u2014 ${msg}`);
    });
  }, 60 * 1e3);
  api.routes.register("get", "/status", async (_req, res) => {
    try {
      const statusOut = await runGit("status --porcelain", notesDir);
      let lastCommitDate = null;
      try {
        lastCommitDate = await runGit("log -1 --format=%ci", notesDir);
      } catch {
      }
      res.json({
        dirty: statusOut.length > 0,
        lastCommitDate: lastCommitDate || null,
        lastCommitHash: state.lastCommitHash,
        pendingCommit: state.pendingCommit
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
  api.routes.register("get", "/log", async (_req, res) => {
    try {
      const logOut = await runGit(
        'log -20 --format={"hash":"%h","message":"%s","date":"%ci"}',
        notesDir
      );
      const entries = logOut.split("\n").filter(Boolean).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
      res.json({ commits: entries });
    } catch {
      res.json({ commits: [] });
    }
  });
  api.routes.register("post", "/commit", async (req, res) => {
    const customMessage = req.body?.message ? String(req.body.message) : renderCommitMessage("manual backup: {{date}}");
    try {
      await performCommit(notesDir, customMessage, api);
      res.json({ success: true, hash: state.lastCommitHash, message: customMessage });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });
  api.routes.register("post", "/push", async (_req, res) => {
    try {
      const out = await runGit("push", notesDir);
      res.json({ success: true, output: out });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });
}
function deactivate() {
  if (state.intervalHandle !== null) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.pendingCommit = false;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
