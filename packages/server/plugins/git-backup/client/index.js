const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect, useCallback } = React;
function formatRelativeTime(dateStr) {
  if (!dateStr) return "never";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "unknown";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 6e4);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}
function GitStatusBar(api) {
  return function GitStatusBarItem() {
    const [status, setStatus] = useState(null);
    const refresh = useCallback(() => {
      api.api.fetch("/status").then((r) => r.json()).then((data) => setStatus(data)).catch(() => setStatus(null));
    }, []);
    useEffect(() => {
      refresh();
      const handle = setInterval(refresh, 3e4);
      return () => clearInterval(handle);
    }, [refresh]);
    if (!status) {
      return h(
        "div",
        { className: "text-xs text-gray-400 dark:text-gray-500 px-2 flex items-center gap-1" },
        "git: \u2014"
      );
    }
    const label = status.dirty ? `git: unsaved` : `git: ${formatRelativeTime(status.lastCommitDate)}`;
    const dotColor = status.dirty ? "bg-yellow-400" : status.lastCommitDate ? "bg-green-400" : "bg-gray-400";
    return h(
      "div",
      {
        className: "text-xs text-gray-500 dark:text-gray-400 px-2 flex items-center gap-1.5 cursor-default",
        title: status.lastCommitHash ? `Last commit: ${status.lastCommitHash} \u2014 ${status.lastCommitDate ?? ""}` : "No commits yet"
      },
      h("span", { className: `inline-block w-1.5 h-1.5 rounded-full ${dotColor}` }),
      label
    );
  };
}
function GitHistoryPanel(api) {
  return function GitHistory() {
    const [commits, setCommits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pushing, setPushing] = useState(false);
    const loadLog = useCallback(() => {
      setLoading(true);
      api.api.fetch("/log").then((r) => r.json()).then((data) => {
        setCommits(data.commits ?? []);
        setLoading(false);
      }).catch(() => {
        setLoading(false);
      });
    }, []);
    useEffect(() => {
      loadLog();
    }, [loadLog]);
    function handleCommitNow() {
      api.api.fetch("/commit", { method: "POST", headers: { "Content-Type": "application/json" } }).then((r) => r.json()).then((data) => {
        if (data.success) {
          api.notify.success(`Committed: ${data.hash ?? ""}`);
          loadLog();
        } else {
          api.notify.error(data.error ?? "Commit failed");
        }
      }).catch((err) => api.notify.error(err.message));
    }
    function handlePush() {
      setPushing(true);
      api.api.fetch("/push", { method: "POST" }).then((r) => r.json()).then((data) => {
        if (data.success) {
          api.notify.success("Pushed to remote.");
        } else {
          api.notify.error(data.error ?? "Push failed");
        }
        setPushing(false);
      }).catch((err) => {
        api.notify.error(err.message);
        setPushing(false);
      });
    }
    return h(
      "div",
      { className: "flex flex-col h-full" },
      // Toolbar
      h(
        "div",
        { className: "flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700" },
        h(
          "button",
          {
            onClick: handleCommitNow,
            className: "px-3 py-1 text-xs rounded bg-violet-500 hover:bg-violet-600 text-white font-medium transition-colors"
          },
          "Commit Now"
        ),
        h(
          "button",
          {
            onClick: handlePush,
            disabled: pushing,
            className: "px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors disabled:opacity-50"
          },
          pushing ? "Pushing\u2026" : "Push"
        ),
        h(
          "button",
          {
            onClick: loadLog,
            className: "ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors",
            title: "Refresh"
          },
          "\u21BA"
        )
      ),
      // Commit list
      loading ? h(
        "div",
        { className: "flex-1 flex items-center justify-center text-sm text-gray-400" },
        "Loading\u2026"
      ) : commits.length === 0 ? h(
        "div",
        { className: "flex-1 flex items-center justify-center text-sm text-gray-400 p-4 text-center" },
        "No commits yet. Notes will be committed automatically based on your settings."
      ) : h(
        "ul",
        { className: "flex-1 overflow-y-auto py-1" },
        commits.map(
          (commit) => h(
            "li",
            {
              key: commit.hash,
              className: "px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800"
            },
            h(
              "div",
              { className: "flex items-center justify-between gap-2" },
              h(
                "span",
                { className: "font-mono text-xs text-violet-500 dark:text-violet-400 shrink-0" },
                commit.hash
              ),
              h(
                "span",
                { className: "text-xs text-gray-400 dark:text-gray-500 shrink-0" },
                formatRelativeTime(commit.date)
              )
            ),
            h(
              "p",
              { className: "text-sm text-gray-700 dark:text-gray-300 mt-0.5 truncate", title: commit.message },
              commit.message
            )
          )
        )
      )
    );
  };
}
function activate(api) {
  api.ui.registerStatusBarItem(GitStatusBar(api), {
    id: "git-backup-status",
    position: "right",
    order: 10
  });
  api.ui.registerSidebarPanel(GitHistoryPanel(api), {
    id: "git-backup-history",
    title: "Git History",
    icon: "git-branch",
    order: 50
  });
  api.commands.register({
    id: "git-backup.commit",
    name: "Git: Commit Now",
    execute() {
      api.api.fetch("/commit", { method: "POST", headers: { "Content-Type": "application/json" } }).then((r) => r.json()).then((data) => {
        if (data.success) {
          api.notify.success(`Committed: ${data.hash ?? "done"}`);
        } else {
          api.notify.error(data.error ?? "Commit failed");
        }
      }).catch((err) => api.notify.error(err.message));
    }
  });
  api.commands.register({
    id: "git-backup.history",
    name: "Git: View History",
    execute() {
      api.notify.info("Open the Git History panel in the sidebar to view commits.");
    }
  });
}
function deactivate() {
}
export {
  activate,
  deactivate
};
