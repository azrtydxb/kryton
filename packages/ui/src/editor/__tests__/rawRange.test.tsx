/** @vitest-environment jsdom */
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NotePreviewReact } from "../NotePreviewReact";

interface CapturedProps {
  content: string;
  notePath: string;
  range?: { startLine: number; endLine: number };
  rawRange?: { startLine: number; endLine: number };
  source?: string;
}

function captureProps(captured: CapturedProps[]) {
  return function FenceCapture(props: CapturedProps) {
    captured.push(props);
    return <pre data-test-fence={JSON.stringify(props.rawRange ?? null)} />;
  };
}

describe("NotePreviewReact rawRange", () => {
  it("locates fences in raw on-disk content even after frontmatter + wikilink substitution", async () => {
    const captured: CapturedProps[] = [];
    // The frontmatter block + a wikilink embed mean range (parsed-body
    // relative) and rawRange (on-disk relative) MUST differ.
    const content = [
      "---", // 0
      "title: My Note", // 1
      "tags:", // 2
      "  - sample", // 3
      "---", // 4
      "", // 5
      "Hello [[OtherNote]] world.", // 6
      "", // 7
      "```kanban", // 8 ← rawRange.startLine
      "lane: Todo", // 9
      "card: One", // 10
      "```", // 11 ← rawRange.endLine
      "", // 12
      "Trailing line.", // 13
    ].join("\n");

    render(
      <NotePreviewReact
        content={content}
        onLinkClick={() => {}}
        getCodeFenceRenderer={(lang) =>
          lang === "kanban"
            ? { component: captureProps(captured) }
            : undefined
        }
      />,
    );

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    const props = captured[0]!;
    expect(props.rawRange).toEqual({ startLine: 8, endLine: 11 });
    // The parsed-body range should be different — frontmatter (5 lines)
    // was stripped, so the same fence sits earlier in transformedContent.
    expect(props.range).toBeDefined();
    expect(props.range!.startLine).toBeLessThan(props.rawRange!.startLine);
  });

  it("resolves duplicate fences to their declaration-order rawRange occurrence", async () => {
    const captured: CapturedProps[] = [];
    const content = [
      "```foo", // 0
      "same", // 1
      "```", // 2
      "", // 3
      "```foo", // 4
      "same", // 5
      "```", // 6
    ].join("\n");

    render(
      <NotePreviewReact
        content={content}
        onLinkClick={() => {}}
        getCodeFenceRenderer={(lang) =>
          lang === "foo"
            ? { component: captureProps(captured) }
            : undefined
        }
      />,
    );

    await waitFor(() => expect(captured.length).toBe(2));

    expect(captured[0]!.rawRange).toEqual({ startLine: 0, endLine: 2 });
    expect(captured[1]!.rawRange).toEqual({ startLine: 4, endLine: 6 });
  });
});
