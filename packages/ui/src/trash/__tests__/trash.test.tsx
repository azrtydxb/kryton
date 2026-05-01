import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrashList } from "../TrashList";
import { RestoreNoteButton } from "../RestoreNoteButton";
import type { TrashItem } from "../TrashList";

const makeItem = (path: string): TrashItem => ({ path });

describe("TrashList", () => {
  it("renders collapsed by default, showing section header", () => {
    render(
      <TrashList
        items={[makeItem("notes/foo.md")]}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
      />,
    );
    expect(screen.getByText(/trash/i)).toBeInTheDocument();
    expect(screen.queryByText("foo")).not.toBeInTheDocument();
  });

  it("expands on header click and shows items", () => {
    render(
      <TrashList
        items={[makeItem("notes/foo.md")]}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /trash/i }));
    expect(screen.getByText("foo")).toBeInTheDocument();
  });

  it("shows empty message when no items", () => {
    render(
      <TrashList
        items={[]}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /trash/i }));
    expect(screen.getByText(/trash is empty/i)).toBeInTheDocument();
  });

  it("shows item count badge when items present", () => {
    render(
      <TrashList
        items={[makeItem("a.md"), makeItem("b.md")]}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
      />,
    );
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("calls onEmptyTrash after confirmation", () => {
    const onEmptyTrash = vi.fn().mockResolvedValue(undefined);
    render(
      <TrashList
        items={[makeItem("notes/bar.md")]}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={onEmptyTrash}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /trash/i }));
    fireEvent.click(screen.getByText(/empty trash/i));
    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));
    expect(onEmptyTrash).toHaveBeenCalled();
  });
});

describe("RestoreNoteButton", () => {
  it("renders and calls onRestore with path", () => {
    const onRestore = vi.fn();
    render(
      <RestoreNoteButton notePath="notes/test.md" onRestore={onRestore} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /restore test/i }));
    expect(onRestore).toHaveBeenCalledWith("notes/test.md");
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <RestoreNoteButton
        notePath="notes/x.md"
        disabled
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
