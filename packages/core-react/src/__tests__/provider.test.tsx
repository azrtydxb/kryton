// packages/core-react/src/__tests__/provider.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KrytonProvider, useKryton } from "../provider";

const fakeCore = { notes: { findById: () => undefined } } as any;

function Probe() {
  const c = useKryton();
  return <span>{c ? "have-core" : "no-core"}</span>;
}

describe("KrytonProvider", () => {
  it("provides core to children", () => {
    render(
      <KrytonProvider core={fakeCore}>
        <Probe />
      </KrytonProvider>,
    );
    expect(screen.getByText("have-core")).toBeTruthy();
  });

  it("useKryton throws outside provider", () => {
    expect(() => render(<Probe />)).toThrow();
  });
});
