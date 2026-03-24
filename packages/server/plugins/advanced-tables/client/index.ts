import type { ClientPluginAPI } from '../../../types/client';

const { React } = window.__mnemoPluginDeps;
const { createElement: h } = React;

// ---------------------------------------------------------------------------
// Table formatting logic
// ---------------------------------------------------------------------------

/**
 * Parse a Markdown table block into rows of raw cell strings.
 * Returns null if the text doesn't look like a Markdown table.
 */
function parseTable(text: string): string[][] | null {
  const lines = text.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return null;
  return lines.map((line) => {
    // Trim leading/trailing pipes then split on |
    const trimmed = line.trim().replace(/^\||\|$/g, '');
    return trimmed.split('|').map((cell) => cell.trim());
  });
}

/** Return true if a row is a separator row (e.g. | --- | :---: | ---: |) */
function isSeparatorRow(row: string[]): boolean {
  return row.every((cell) => /^:?-+:?$/.test(cell.trim()) || cell.trim() === '');
}

/**
 * Format a parsed table so all columns are padded to equal widths.
 * The separator row dashes are padded to match the column width.
 */
function formatTable(rows: string[][]): string {
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));

  // Ensure every row has the same number of columns
  const normalized = rows.map((row) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    return padded;
  });

  // Compute max width per column (ignore separator rows for width calculation)
  const colWidths: number[] = Array(colCount).fill(3); // minimum 3 for "---"
  for (const row of normalized) {
    if (isSeparatorRow(row)) continue;
    row.forEach((cell, i) => {
      if (cell.length > colWidths[i]) colWidths[i] = cell.length;
    });
  }

  return normalized
    .map((row) => {
      const cells = row.map((cell, i) => {
        if (isSeparatorRow(row)) {
          // Preserve alignment markers
          const c = cell.trim();
          const leftColon = c.startsWith(':');
          const rightColon = c.endsWith(':');
          const dashes = '-'.repeat(colWidths[i] - (leftColon ? 1 : 0) - (rightColon ? 1 : 0));
          return (leftColon ? ':' : '') + dashes + (rightColon ? ':' : '');
        }
        return cell.padEnd(colWidths[i]);
      });
      return '| ' + cells.join(' | ') + ' |';
    })
    .join('\n');
}

/**
 * Given the full note content and cursor position, find the Markdown table
 * block the cursor is within (if any), format it, and return the updated
 * content along with the new cursor position offset.
 *
 * Returns null if the cursor is not inside a table.
 */
function formatTableAtCursor(
  content: string,
  cursorPos: number,
): { newContent: string; cursorOffset: number } | null {
  const lines = content.split('\n');

  // Find which line the cursor is on
  let charCount = 0;
  let cursorLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= cursorPos) {
      cursorLine = i;
      break;
    }
    charCount += lines[i].length + 1; // +1 for the \n
  }

  if (cursorLine === -1) cursorLine = lines.length - 1;

  // Check that the cursor line is inside a table
  if (!lines[cursorLine]?.trim().startsWith('|')) return null;

  // Find the start and end of the table block
  let tableStart = cursorLine;
  while (tableStart > 0 && lines[tableStart - 1]?.trim().startsWith('|')) {
    tableStart--;
  }
  let tableEnd = cursorLine;
  while (tableEnd < lines.length - 1 && lines[tableEnd + 1]?.trim().startsWith('|')) {
    tableEnd++;
  }

  const tableLines = lines.slice(tableStart, tableEnd + 1);
  const tableText = tableLines.join('\n');

  const parsed = parseTable(tableText);
  if (!parsed) return null;

  const formatted = formatTable(parsed);

  // Calculate character offset before the table block
  const beforeTable = lines.slice(0, tableStart).join('\n');
  const beforeLen = tableStart === 0 ? 0 : beforeTable.length + 1;

  const newLines = [
    ...lines.slice(0, tableStart),
    ...formatted.split('\n'),
    ...lines.slice(tableEnd + 1),
  ];

  const newContent = newLines.join('\n');

  // Adjust cursor: keep it at the same relative position within the table,
  // clamped to the end of the formatted block.
  const cursorInTable = cursorPos - beforeLen;
  const newCursorPos = Math.min(beforeLen + cursorInTable, beforeLen + formatted.length);

  return { newContent, cursorOffset: newCursorPos - cursorPos };
}

// ---------------------------------------------------------------------------
// Plugin activation
// ---------------------------------------------------------------------------

export function activate(api: ClientPluginAPI): void {
  // Command: Format Table — formats the Markdown table at the cursor position.
  api.commands.register({
    id: 'advanced-tables.format',
    name: 'Format Table',
    shortcut: 'Ctrl+Shift+T',
    execute() {
      const note = api.context.useCurrentNote();
      if (!note) {
        api.notify.info('No note is currently open.');
        return;
      }

      // Try to get the CodeMirror editor view for cursor position
      const cmEl = document.querySelector('.cm-editor') as any;
      const view = cmEl?.cmView?.view;
      const cursorPos: number =
        view?.state?.selection?.main?.head ?? note.content.length / 2;

      const result = formatTableAtCursor(note.content, cursorPos);
      if (!result) {
        api.notify.info('No Markdown table found at cursor.');
        return;
      }

      // Write back via the editor DOM — dispatch a CodeMirror transaction if possible
      if (view) {
        const { newContent } = result;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent },
          selection: { anchor: Math.max(0, cursorPos + result.cursorOffset) },
        });
      } else {
        // Fallback: notify — no direct DOM write path without the editor view
        api.notify.info('Table formatting requires the editor to be focused.');
      }

      api.notify.success('Table formatted.');
    },
  });

  // Toolbar button: "Format Table"
  function FormatTableButton(): any {
    return h(
      'button',
      {
        onClick() {
          const note = api.context.useCurrentNote();
          if (!note) return;
          const cmEl = document.querySelector('.cm-editor') as any;
          const view = cmEl?.cmView?.view;
          const cursorPos: number =
            view?.state?.selection?.main?.head ?? note.content.length / 2;
          const result = formatTableAtCursor(note.content, cursorPos);
          if (!result) {
            api.notify.info('No Markdown table found at cursor.');
            return;
          }
          if (view) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: result.newContent },
              selection: { anchor: Math.max(0, cursorPos + result.cursorOffset) },
            });
            api.notify.success('Table formatted.');
          } else {
            api.notify.info('Table formatting requires the editor to be focused.');
          }
        },
        title: 'Format Table (Ctrl+Shift+T)',
        className:
          'px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700 ' +
          'text-gray-600 dark:text-gray-300 transition-colors font-mono',
      },
      'TBL',
    );
  }

  api.ui.registerEditorToolbarButton(FormatTableButton, {
    id: 'advanced-tables-format',
    order: 50,
  });
}

export function deactivate(): void {
  // No persistent resources to clean up
}
