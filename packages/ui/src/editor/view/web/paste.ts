// packages/ui/src/editor/view/web/paste.ts
export function normalizeClipboardData(dt: DataTransfer): string {
  const plain = dt.getData("text/plain");
  if (plain) return plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const html = dt.getData("text/html");
  if (html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent ?? "").replace(/\r\n/g, "\n");
  }
  return "";
}
