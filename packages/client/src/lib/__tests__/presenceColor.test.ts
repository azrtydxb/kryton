import { describe, it, expect } from "vitest";
import { presenceColor, presenceColorRanges } from "../presenceColor";

describe("presenceColor", () => {
  it("is deterministic for the same id + kind", () => {
    expect(presenceColor("user-1", "user")).toBe(presenceColor("user-1", "user"));
    expect(presenceColor("agent-42", "agent")).toBe(presenceColor("agent-42", "agent"));
  });

  it("uses the user palette for kind=user (hue 200-280)", () => {
    const samples = ["alice", "bob", "carol", "dave", "eve", "frank"];
    for (const id of samples) {
      const color = presenceColor(id, "user");
      const m = color.match(/^hsl\((\d+),/);
      expect(m).not.toBeNull();
      const hue = Number(m![1]);
      expect(hue).toBeGreaterThanOrEqual(presenceColorRanges.user.hueStart);
      expect(hue).toBeLessThan(presenceColorRanges.user.hueEnd);
    }
  });

  it("uses the agent palette for kind=agent (hue 10-50)", () => {
    const samples = ["agent-1", "agent-2", "claude", "gpt", "watson"];
    for (const id of samples) {
      const color = presenceColor(id, "agent");
      const m = color.match(/^hsl\((\d+),/);
      expect(m).not.toBeNull();
      const hue = Number(m![1]);
      expect(hue).toBeGreaterThanOrEqual(presenceColorRanges.agent.hueStart);
      expect(hue).toBeLessThan(presenceColorRanges.agent.hueEnd);
    }
  });

  it("never returns a user-palette hue inside the agent palette", () => {
    // Sanity: the ranges don't overlap, so even worst-case hash collisions
    // can't produce a confusable color across kinds.
    expect(presenceColorRanges.user.hueStart).toBeGreaterThan(presenceColorRanges.agent.hueEnd);
  });

  it("returns a syntactically valid hsl() string", () => {
    const color = presenceColor("any-id", "user");
    expect(color).toMatch(/^hsl\(\d+,\s*\d+%,\s*\d+%\)$/);
  });
});
