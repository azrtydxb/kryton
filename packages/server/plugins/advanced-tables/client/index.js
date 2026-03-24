const { React } = window.__mnemoPluginDeps;
const { createElement: h } = React;
function parseTable(text) {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return null;
  return lines.map((line) => {
    const trimmed = line.trim().replace(/^\||\|$/g, "");
    return trimmed.split("|").map((cell) => cell.trim());
  });
}
function isSeparatorRow(row) {
  return row.every((cell) => /^:?-+:?$/.test(cell.trim()) || cell.trim() === "");
}
function formatTable(rows) {
  if (rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((row) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push("");
    return padded;
  });
  const colWidths = Array(colCount).fill(3);
  for (const row of normalized) {
    if (isSeparatorRow(row)) continue;
    row.forEach((cell, i) => {
      if (cell.length > colWidths[i]) colWidths[i] = cell.length;
    });
  }
  return normalized.map((row) => {
    const cells = row.map((cell, i) => {
      if (isSeparatorRow(row)) {
        const c = cell.trim();
        const leftColon = c.startsWith(":");
        const rightColon = c.endsWith(":");
        const dashes = "-".repeat(colWidths[i] - (leftColon ? 1 : 0) - (rightColon ? 1 : 0));
        return (leftColon ? ":" : "") + dashes + (rightColon ? ":" : "");
      }
      return cell.padEnd(colWidths[i]);
    });
    return "| " + cells.join(" | ") + " |";
  }).join("\n");
}
function formatTableAtCursor(content, cursorPos) {
  const lines = content.split("\n");
  let charCount = 0;
  let cursorLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= cursorPos) {
      cursorLine = i;
      break;
    }
    charCount += lines[i].length + 1;
  }
  if (cursorLine === -1) cursorLine = lines.length - 1;
  if (!lines[cursorLine]?.trim().startsWith("|")) return null;
  let tableStart = cursorLine;
  while (tableStart > 0 && lines[tableStart - 1]?.trim().startsWith("|")) {
    tableStart--;
  }
  let tableEnd = cursorLine;
  while (tableEnd < lines.length - 1 && lines[tableEnd + 1]?.trim().startsWith("|")) {
    tableEnd++;
  }
  const tableLines = lines.slice(tableStart, tableEnd + 1);
  const tableText = tableLines.join("\n");
  const parsed = parseTable(tableText);
  if (!parsed) return null;
  const formatted = formatTable(parsed);
  const beforeTable = lines.slice(0, tableStart).join("\n");
  const beforeLen = tableStart === 0 ? 0 : beforeTable.length + 1;
  const newLines = [
    ...lines.slice(0, tableStart),
    ...formatted.split("\n"),
    ...lines.slice(tableEnd + 1)
  ];
  const newContent = newLines.join("\n");
  const cursorInTable = cursorPos - beforeLen;
  const newCursorPos = Math.min(beforeLen + cursorInTable, beforeLen + formatted.length);
  return { newContent, cursorOffset: newCursorPos - cursorPos };
}
function activate(api) {
  api.commands.register({
    id: "advanced-tables.format",
    name: "Format Table",
    shortcut: "Ctrl+Shift+T",
    execute() {
      const note = api.context.useCurrentNote();
      if (!note) {
        api.notify.info("No note is currently open.");
        return;
      }
      const cmEl = document.querySelector(".cm-editor");
      const view = cmEl?.cmView?.view;
      const cursorPos = view?.state?.selection?.main?.head ?? note.content.length / 2;
      const result = formatTableAtCursor(note.content, cursorPos);
      if (!result) {
        api.notify.info("No Markdown table found at cursor.");
        return;
      }
      if (view) {
        const { newContent } = result;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent },
          selection: { anchor: Math.max(0, cursorPos + result.cursorOffset) }
        });
      } else {
        api.notify.info("Table formatting requires the editor to be focused.");
      }
      api.notify.success("Table formatted.");
    }
  });
  function FormatTableButton() {
    return h(
      "button",
      {
        onClick() {
          const note = api.context.useCurrentNote();
          if (!note) return;
          const cmEl = document.querySelector(".cm-editor");
          const view = cmEl?.cmView?.view;
          const cursorPos = view?.state?.selection?.main?.head ?? note.content.length / 2;
          const result = formatTableAtCursor(note.content, cursorPos);
          if (!result) {
            api.notify.info("No Markdown table found at cursor.");
            return;
          }
          if (view) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: result.newContent },
              selection: { anchor: Math.max(0, cursorPos + result.cursorOffset) }
            });
            api.notify.success("Table formatted.");
          } else {
            api.notify.info("Table formatting requires the editor to be focused.");
          }
        },
        title: "Format Table (Ctrl+Shift+T)",
        className: "px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors font-mono"
      },
      "TBL"
    );
  }
  api.ui.registerEditorToolbarButton(FormatTableButton, {
    id: "advanced-tables-format",
    order: 50
  });
}
function deactivate() {
}
export {
  activate,
  deactivate
};
