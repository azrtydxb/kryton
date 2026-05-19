import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PresenceStrip } from "../PresenceStrip";

afterEach(() => cleanup());

describe("PresenceStrip", () => {
  it("renders nothing when entries is empty", () => {
    const { container } = render(<PresenceStrip entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one avatar per entry with initial", () => {
    render(
      <PresenceStrip
        entries={[
          { id: "u1", name: "Pascal", color: "hsl(220,60%,50%)", kind: "user" },
          { id: "u2", name: "Wangchuk", color: "hsl(260,60%,50%)", kind: "user" },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("P");
    expect(items[1]!.textContent).toBe("W");
  });

  it("renders an AI badge on agent entries and adds (AI) to the tooltip", () => {
    render(
      <PresenceStrip
        entries={[
          { id: "a1", name: "Claude", color: "hsl(20,70%,50%)", kind: "agent" },
        ]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("title")).toBe("Claude (AI)");
    expect(item.getAttribute("data-presence-kind")).toBe("agent");
    expect(item.querySelector("[data-presence-ai-badge]")).not.toBeNull();
  });

  it("does not render an AI badge for user entries", () => {
    render(
      <PresenceStrip
        entries={[
          { id: "u1", name: "Pascal", color: "hsl(220,60%,50%)", kind: "user" },
        ]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("title")).toBe("Pascal");
    expect(item.querySelector("[data-presence-ai-badge]")).toBeNull();
  });

  it("falls back to a placeholder initial for blank names", () => {
    render(
      <PresenceStrip
        entries={[{ id: "x", name: "  ", color: "hsl(220,60%,50%)", kind: "user" }]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item.textContent).toBe("?");
  });
});
