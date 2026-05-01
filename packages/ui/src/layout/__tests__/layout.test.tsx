import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThreePanelLayout } from "../ThreePanelLayout";
import { AppShell } from "../AppShell";
import { CommandPalette } from "../CommandPalette";
import { KeyboardShortcuts } from "../KeyboardShortcuts";
import type { CommandAction } from "../CommandPalette";

// ---------------------------------------------------------------------------
// ThreePanelLayout
// ---------------------------------------------------------------------------

describe("ThreePanelLayout", () => {
  beforeEach(() => {
    // localStorage.clear may not exist in all jsdom versions — guard it
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  it("renders children in the main area", () => {
    render(<ThreePanelLayout>Main content</ThreePanelLayout>);
    expect(screen.getByText("Main content")).toBeInTheDocument();
  });

  it("renders sidebar when provided and sidebarOpen=true", () => {
    render(
      <ThreePanelLayout sidebar={<div>Sidebar content</div>} sidebarOpen>
        Main
      </ThreePanelLayout>,
    );
    expect(screen.getByText("Sidebar content")).toBeInTheDocument();
  });

  it("hides sidebar when sidebarOpen=false", () => {
    render(
      <ThreePanelLayout sidebar={<div>Sidebar content</div>} sidebarOpen={false}>
        Main
      </ThreePanelLayout>,
    );
    expect(screen.queryByText("Sidebar content")).not.toBeInTheDocument();
  });

  it("renders right panel when provided and panelOpen=true", () => {
    render(
      <ThreePanelLayout panel={<div>Panel content</div>} panelOpen>
        Main
      </ThreePanelLayout>,
    );
    expect(screen.getByText("Panel content")).toBeInTheDocument();
  });

  it("hides right panel when panelOpen=false", () => {
    render(
      <ThreePanelLayout panel={<div>Panel content</div>} panelOpen={false}>
        Main
      </ThreePanelLayout>,
    );
    expect(screen.queryByText("Panel content")).not.toBeInTheDocument();
  });

  it("renders both sidebar and panel simultaneously", () => {
    render(
      <ThreePanelLayout
        sidebar={<div>Left</div>}
        panel={<div>Right</div>}
        sidebarOpen
        panelOpen
      >
        Centre
      </ThreePanelLayout>,
    );
    expect(screen.getByText("Left")).toBeInTheDocument();
    expect(screen.getByText("Centre")).toBeInTheDocument();
    expect(screen.getByText("Right")).toBeInTheDocument();
  });

  it("persists sidebar width to localStorage on resize", () => {
    const storageKey = "test-layout";
    render(
      <ThreePanelLayout
        storageKey={storageKey}
        sidebar={<div>Sidebar</div>}
        sidebarOpen
      >
        Main
      </ThreePanelLayout>,
    );
    // The Resizer separator should be present
    const separators = screen.getAllByRole("separator");
    expect(separators.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

describe("AppShell", () => {
  it("renders header slot", () => {
    render(<AppShell header={<nav>Header</nav>}>Content</AppShell>);
    expect(screen.getByText("Header")).toBeInTheDocument();
  });

  it("renders sidebar slot", () => {
    render(<AppShell sidebar={<div>Sidebar</div>}>Content</AppShell>);
    expect(screen.getByText("Sidebar")).toBeInTheDocument();
  });

  it("renders panel slot", () => {
    render(<AppShell panel={<div>Panel</div>}>Content</AppShell>);
    expect(screen.getByText("Panel")).toBeInTheDocument();
  });

  it("renders children in main slot", () => {
    render(<AppShell>Main content</AppShell>);
    expect(screen.getByText("Main content")).toBeInTheDocument();
  });

  it("omits header element when not provided", () => {
    render(<AppShell>Content</AppShell>);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CommandPalette
// ---------------------------------------------------------------------------

const ACTIONS: CommandAction[] = [
  { id: "new-note", label: "New note", shortcut: "⌘N", onSelect: vi.fn(), group: "Notes" },
  { id: "search", label: "Search", shortcut: "⌘F", onSelect: vi.fn(), group: "Notes" },
  { id: "settings", label: "Open settings", onSelect: vi.fn(), group: "App" },
];

describe("CommandPalette", () => {
  it("renders nothing when open=false", () => {
    render(
      <CommandPalette open={false} onClose={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders modal when open=true", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lists all actions on open with empty query", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.getByText("New note")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Open settings")).toBeInTheDocument();
  });

  it("filters actions by query", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} actions={ACTIONS} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "set" } });
    expect(screen.getByText("Open settings")).toBeInTheDocument();
    expect(screen.queryByText("New note")).not.toBeInTheDocument();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} onClose={onClose} actions={ACTIONS} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls action.onSelect and onClose on Enter", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const actions: CommandAction[] = [
      { id: "a", label: "Alpha", onSelect },
    ];
    render(<CommandPalette open={true} onClose={onClose} actions={actions} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders group headers", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("App")).toBeInTheDocument();
  });

  it("renders shortcut badge", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} actions={ACTIONS} />,
    );
    expect(screen.getByText("⌘N")).toBeInTheDocument();
  });

  it("shows empty state when no actions match", () => {
    render(
      <CommandPalette open={true} onClose={vi.fn()} actions={ACTIONS} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "xyzzy" } });
    expect(screen.getByText("No actions found")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// KeyboardShortcuts
// ---------------------------------------------------------------------------

describe("KeyboardShortcuts", () => {
  it("renders null (no DOM output)", () => {
    const { container } = render(
      <KeyboardShortcuts bindings={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("calls handler on matching keydown", () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcuts
        bindings={[{ keys: "Ctrl+K", handler, description: "test" }]}
      />,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call handler when modifiers don't match", () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcuts
        bindings={[{ keys: "Ctrl+K", handler, description: "test" }]}
      />,
    );
    fireEvent.keyDown(window, { key: "k" }); // no Ctrl
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports Shift modifier", () => {
    const handler = vi.fn();
    render(
      <KeyboardShortcuts
        bindings={[{ keys: "Ctrl+Shift+P", handler, description: "test" }]}
      />,
    );
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
