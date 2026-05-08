/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { normalizeClipboardData } from "../paste";

// jsdom doesn't implement DataTransfer with setData/getData; use a minimal stub.
function mkDataTransfer(entries: Record<string, string>): DataTransfer {
  return {
    getData: (type: string) => entries[type] ?? "",
  } as unknown as DataTransfer;
}

describe("normalizeClipboardData", () => {
  it("prefers text/plain when present", () => {
    const dt = mkDataTransfer({ "text/plain": "raw", "text/html": "<b>raw</b>" });
    expect(normalizeClipboardData(dt)).toBe("raw");
  });

  it("strips HTML tags when only text/html is available", () => {
    const dt = mkDataTransfer({ "text/html": "<p>hello <b>world</b></p>" });
    expect(normalizeClipboardData(dt)).toBe("hello world");
  });

  it("normalises CRLF to LF", () => {
    const dt = mkDataTransfer({ "text/plain": "a\r\nb\r\nc" });
    expect(normalizeClipboardData(dt)).toBe("a\nb\nc");
  });
});
