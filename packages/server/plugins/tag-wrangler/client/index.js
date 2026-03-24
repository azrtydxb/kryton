const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useCallback, useRef } = React;
function activate(api) {
  function TagWranglerPanel() {
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionMenu, setActionMenu] = useState(null);
    const [activeOp, setActiveOp] = useState(null);
    const [busy, setBusy] = useState(false);
    const menuRef = useRef(null);
    const fetchTags = useCallback(async () => {
      setLoading(true);
      try {
        const resp = await api.api.fetch("/tags");
        if (resp.ok) {
          const data = await resp.json();
          setTags(data.tags);
        } else {
          api.notify.error("Failed to load tags");
        }
      } catch {
        api.notify.error("Failed to load tags");
      } finally {
        setLoading(false);
      }
    }, []);
    useEffect(() => {
      fetchTags();
    }, [fetchTags]);
    useEffect(() => {
      function handleClick(e) {
        if (menuRef.current && !menuRef.current.contains(e.target)) {
          setActionMenu(null);
        }
      }
      if (actionMenu) {
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
      }
      return void 0;
    }, [actionMenu]);
    function openMenu(tag, e) {
      e.preventDefault();
      e.stopPropagation();
      setActionMenu({ tag, x: e.clientX, y: e.clientY });
    }
    function startRename(tag) {
      setActionMenu(null);
      setActiveOp({ type: "rename", tag, value: tag });
    }
    function startMerge(tag) {
      setActionMenu(null);
      const other = tags.find((t) => t.name !== tag);
      setActiveOp({ type: "merge", tag, targetTag: other?.name ?? "" });
    }
    function startDelete(tag) {
      setActionMenu(null);
      setActiveOp({ type: "delete", tag });
    }
    async function doRename() {
      if (!activeOp || activeOp.type !== "rename") return;
      const { tag, value } = activeOp;
      if (!value || value === tag) {
        setActiveOp(null);
        return;
      }
      setBusy(true);
      try {
        const resp = await api.api.fetch("/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldTag: tag, newTag: value })
        });
        if (resp.ok) {
          const data = await resp.json();
          api.notify.success(`Renamed #${tag} \u2192 #${value} in ${data.updatedNotes} note(s)`);
          setActiveOp(null);
          await fetchTags();
        } else {
          api.notify.error("Rename failed");
        }
      } catch {
        api.notify.error("Rename failed");
      } finally {
        setBusy(false);
      }
    }
    async function doMerge() {
      if (!activeOp || activeOp.type !== "merge") return;
      const { tag, targetTag } = activeOp;
      if (!targetTag) {
        api.notify.error("Please select a target tag");
        return;
      }
      setBusy(true);
      try {
        const resp = await api.api.fetch("/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceTag: tag, targetTag })
        });
        if (resp.ok) {
          const data = await resp.json();
          api.notify.success(`Merged #${tag} into #${targetTag} in ${data.updatedNotes} note(s)`);
          setActiveOp(null);
          await fetchTags();
        } else {
          api.notify.error("Merge failed");
        }
      } catch {
        api.notify.error("Merge failed");
      } finally {
        setBusy(false);
      }
    }
    async function doDelete() {
      if (!activeOp || activeOp.type !== "delete") return;
      const { tag } = activeOp;
      setBusy(true);
      try {
        const resp = await api.api.fetch("/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag })
        });
        if (resp.ok) {
          const data = await resp.json();
          api.notify.success(`Deleted #${tag} from ${data.updatedNotes} note(s)`);
          setActiveOp(null);
          await fetchTags();
        } else {
          api.notify.error("Delete failed");
        }
      } catch {
        api.notify.error("Delete failed");
      } finally {
        setBusy(false);
      }
    }
    if (loading) {
      return h(
        "div",
        { className: "flex items-center justify-center h-full p-4" },
        h(
          "div",
          { className: "flex items-center gap-2 text-sm text-gray-400" },
          h("div", { className: "w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" }),
          "Loading tags..."
        )
      );
    }
    if (tags.length === 0) {
      return h(
        "div",
        { className: "flex flex-col h-full" },
        h(
          "div",
          { className: "flex-1 flex items-center justify-center p-4 text-sm text-gray-400 dark:text-gray-500 text-center" },
          "No tags found. Add #tags to your notes."
        )
      );
    }
    function RenameDialog() {
      if (!activeOp || activeOp.type !== "rename") return null;
      return h(
        "div",
        { className: "px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" },
        h("div", { className: "text-xs text-gray-500 dark:text-gray-400 mb-1" }, `Rename #${activeOp.tag} to:`),
        h(
          "div",
          { className: "flex gap-1" },
          h("input", {
            type: "text",
            value: activeOp.value,
            autoFocus: true,
            disabled: busy,
            className: "flex-1 text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-violet-500",
            onChange: (e) => setActiveOp({ ...activeOp, value: e.target.value }),
            onKeyDown: (e) => {
              if (e.key === "Enter") doRename();
              if (e.key === "Escape") setActiveOp(null);
            }
          }),
          h("button", {
            onClick: doRename,
            disabled: busy,
            className: "px-2 py-1 text-xs rounded bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-50"
          }, "OK"),
          h("button", {
            onClick: () => setActiveOp(null),
            disabled: busy,
            className: "px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          }, "Cancel")
        )
      );
    }
    function MergeDialog() {
      if (!activeOp || activeOp.type !== "merge") return null;
      const otherTags = tags.filter((t) => t.name !== activeOp.tag);
      return h(
        "div",
        { className: "px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" },
        h("div", { className: "text-xs text-gray-500 dark:text-gray-400 mb-1" }, `Merge #${activeOp.tag} into:`),
        h(
          "div",
          { className: "flex gap-1" },
          h(
            "select",
            {
              value: activeOp.targetTag,
              disabled: busy,
              className: "flex-1 text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-violet-500",
              onChange: (e) => setActiveOp({ ...activeOp, targetTag: e.target.value })
            },
            otherTags.length === 0 ? h("option", { value: "" }, "(no other tags)") : otherTags.map((t) => h("option", { key: t.name, value: t.name }, `#${t.name} (${t.count})`))
          ),
          h("button", {
            onClick: doMerge,
            disabled: busy || !activeOp.targetTag,
            className: "px-2 py-1 text-xs rounded bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-50"
          }, "Merge"),
          h("button", {
            onClick: () => setActiveOp(null),
            disabled: busy,
            className: "px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          }, "Cancel")
        )
      );
    }
    function DeleteDialog() {
      if (!activeOp || activeOp.type !== "delete") return null;
      return h(
        "div",
        { className: "px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-red-50 dark:bg-red-900/20" },
        h(
          "div",
          { className: "text-xs text-gray-700 dark:text-gray-300 mb-2" },
          `Remove #${activeOp.tag} from all notes? This cannot be undone.`
        ),
        h(
          "div",
          { className: "flex gap-1" },
          h("button", {
            onClick: doDelete,
            disabled: busy,
            className: "px-2 py-1 text-xs rounded bg-red-500 hover:bg-red-600 text-white disabled:opacity-50"
          }, busy ? "Deleting..." : "Delete"),
          h("button", {
            onClick: () => setActiveOp(null),
            disabled: busy,
            className: "px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          }, "Cancel")
        )
      );
    }
    return h(
      "div",
      { className: "flex flex-col h-full relative" },
      // Active operation dialogs (shown at top)
      h(RenameDialog, null),
      h(MergeDialog, null),
      h(DeleteDialog, null),
      // Tag list
      h(
        "ul",
        { className: "flex-1 overflow-y-auto py-1" },
        tags.map(
          (tag) => h(
            "li",
            { key: tag.name },
            h(
              "div",
              {
                className: "flex items-center justify-between px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 group"
              },
              h(
                "span",
                { className: "text-sm text-gray-800 dark:text-gray-200 truncate flex-1" },
                h("span", { className: "text-violet-500 mr-0.5" }, "#"),
                tag.name
              ),
              h(
                "span",
                { className: "text-xs text-gray-400 dark:text-gray-500 ml-2 shrink-0" },
                tag.count
              ),
              h("button", {
                onClick: (e) => openMenu(tag.name, e),
                className: "ml-2 px-1.5 py-0.5 text-xs rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-opacity shrink-0",
                title: "Tag actions"
              }, "\xB7\xB7\xB7")
            )
          )
        )
      ),
      // Footer
      h(
        "div",
        { className: "px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between" },
        h("span", { className: "text-xs text-gray-400 dark:text-gray-500" }, `${tags.length} tag(s)`),
        h("button", {
          onClick: fetchTags,
          disabled: loading,
          className: "text-xs text-gray-400 dark:text-gray-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
        }, "Refresh")
      ),
      // Context menu (portal-like, absolutely positioned)
      actionMenu && h(
        "div",
        {
          ref: menuRef,
          style: { position: "fixed", top: actionMenu.y, left: actionMenu.x, zIndex: 9999 },
          className: "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg py-1 min-w-32"
        },
        h("button", {
          onClick: () => startRename(actionMenu.tag),
          className: "w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
        }, "Rename..."),
        h("button", {
          onClick: () => startMerge(actionMenu.tag),
          className: "w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
        }, "Merge into..."),
        h("div", { className: "border-t border-gray-200 dark:border-gray-700 my-1" }),
        h("button", {
          onClick: () => startDelete(actionMenu.tag),
          className: "w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        }, "Delete tag")
      )
    );
  }
  api.ui.registerSidebarPanel(TagWranglerPanel, {
    id: "tag-wrangler",
    title: "Tag Wrangler",
    icon: "tag",
    order: 20
  });
}
function deactivate() {
}
export {
  activate,
  deactivate
};
