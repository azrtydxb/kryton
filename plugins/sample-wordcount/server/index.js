exports.activate = function (api) {
  api.log.info("Word Count plugin activated");

  // Register a custom route to get word count for a note
  api.routes.register("get", "/count/:userId/:notePath(*)", async (req, res) => {
    try {
      const { userId, notePath } = req.params;
      const note = await api.notes.get(userId, notePath);
      const words = note.content.trim().split(/\s+/).filter(Boolean).length;
      const chars = note.content.length;
      const lines = note.content.split("\n").length;
      res.json({ words, chars, lines });
    } catch (err) {
      res.status(404).json({ error: "Note not found" });
    }
  });

  // Listen for note saves
  api.events.on("note:afterSave", (ctx) => {
    api.log.info(`Note saved: ${ctx.path}`);
  });
};

exports.deactivate = function () {
  // Nothing to clean up — PluginManager handles route/event removal
};
