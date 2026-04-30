// packages/core-react/src/__tests__/use-yjs-doc.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { KrytonProvider } from "../provider";
import { useYjsDoc } from "../hooks";

describe("useYjsDoc", () => {
  it("opens and closes doc on mount/unmount", async () => {
    const fakeDoc = {
      getText: () => ({ toString: () => "hi" }),
    };
    const open = vi.fn(async (_id: string) => fakeDoc);
    const close = vi.fn(async () => {});
    const core = {
      bus: { on: () => () => {} },
      yjs: { openDocument: open, closeDocument: close },
    } as any;

    function Probe() {
      useYjsDoc("d1");
      return null;
    }

    const r = render(
      <KrytonProvider core={core}>
        <Probe />
      </KrytonProvider>,
    );

    await act(async () => {});
    expect(open).toHaveBeenCalledWith("d1");

    r.unmount();
    await act(async () => {});
    expect(close).toHaveBeenCalledWith("d1");
  });

  it("returns null before doc resolves", () => {
    let resolveDoc!: (doc: any) => void;
    const open = vi.fn(
      () =>
        new Promise<any>((resolve) => {
          resolveDoc = resolve;
        }),
    );
    const core = {
      bus: { on: () => () => {} },
      yjs: { openDocument: open, closeDocument: vi.fn() },
    } as any;

    let capturedDoc: any = "not-set";
    function Probe() {
      capturedDoc = useYjsDoc("d1");
      return null;
    }

    render(
      <KrytonProvider core={core}>
        <Probe />
      </KrytonProvider>,
    );

    expect(capturedDoc).toBeNull();
  });
});
