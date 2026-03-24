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
function activate(api) {
  api.log.info("Word Count plugin activated");
  api.routes.register("get", "/count/:userId/{*notePath}", async (req, res) => {
    try {
      const { userId, notePath } = req.params;
      const note = await api.notes.get(userId, notePath);
      const words = note.content.trim().split(/\s+/).filter(Boolean).length;
      const chars = note.content.length;
      const lines = note.content.split("\n").length;
      res.json({ words, chars, lines });
    } catch {
      res.status(404).json({ error: "Note not found" });
    }
  });
  api.events.on("note:afterSave", (ctx) => {
    api.log.info(`Note saved: ${ctx.path}`);
  });
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
