import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Breadcrumbs } from "../Breadcrumbs";
import { NoteHeader } from "../NoteHeader";
import { FrontmatterEditor } from "../FrontmatterEditor";
import { NoteMetadata } from "../NoteMetadata";
import { FavoritesSection } from "../FavoritesSection";
import type { NoteData } from "../../data/types";

describe("Breadcrumbs", () => {
  it("renders all path segments", () => {
    render(<Breadcrumbs path="Projects/Kryton/Tasks.md" onFolderClick={() => {}} />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Kryton")).toBeInTheDocument();
    expect(screen.getByText("Tasks.md")).toBeInTheDocument();
  });

  it("calls onFolderClick with folder path for non-last segments", () => {
    const onFolderClick = vi.fn();
    render(<Breadcrumbs path="A/B/C.md" onFolderClick={onFolderClick} />);
    fireEvent.click(screen.getByText("A"));
    expect(onFolderClick).toHaveBeenCalledWith("A");
    fireEvent.click(screen.getByText("B"));
    expect(onFolderClick).toHaveBeenCalledWith("A/B");
  });
});

describe("NoteHeader", () => {
  it("renders breadcrumbs and optional actions", () => {
    render(
      <NoteHeader
        path="Folder/Note.md"
        onFolderClick={() => {}}
        actions={<button type="button">Share</button>}
      />,
    );
    expect(screen.getByText("Folder")).toBeInTheDocument();
    expect(screen.getByText("Note.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });
});

describe("FrontmatterEditor", () => {
  it("renders existing keys and values", () => {
    const fm = { title: "Hello", author: "Alice" };
    render(<FrontmatterEditor frontmatter={fm} onChange={() => {}} />);
    expect(screen.getByDisplayValue("title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
  });

  it("calls onChange when a value is edited", () => {
    const onChange = vi.fn();
    render(<FrontmatterEditor frontmatter={{ title: "Old" }} onChange={onChange} />);
    const input = screen.getByDisplayValue("Old");
    fireEvent.change(input, { target: { value: "New" } });
    expect(onChange).toHaveBeenCalledWith({ title: "New" });
  });

  it("can add a new field", () => {
    const onChange = vi.fn();
    render(<FrontmatterEditor frontmatter={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("New key"), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText("New value"), { target: { value: "draft" } });
    fireEvent.click(screen.getByLabelText("Add frontmatter field"));
    expect(onChange).toHaveBeenCalledWith({ status: "draft" });
  });
});

describe("NoteMetadata", () => {
  it("renders path and modified date", () => {
    const note: NoteData = {
      id: "n1",
      path: "notes/hello.md",
      title: "Hello",
      tags: '["foo"]',
      modifiedAt: 1700000000000,
      version: 1,
    };
    render(<NoteMetadata note={note} formatDate={() => "Jan 1"} />);
    expect(screen.getByText("notes/hello.md")).toBeInTheDocument();
    expect(screen.getByText("Jan 1")).toBeInTheDocument();
    expect(screen.getByText("foo")).toBeInTheDocument();
  });
});

describe("FavoritesSection", () => {
  it("renders starred paths", () => {
    const paths = new Set(["notes/a.md", "notes/b.md"]);
    render(<FavoritesSection starredPaths={paths} onSelect={() => {}} onToggleStar={() => {}} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("calls onSelect when a favorite is clicked", () => {
    const onSelect = vi.fn();
    const paths = new Set(["notes/hello.md"]);
    render(<FavoritesSection starredPaths={paths} onSelect={onSelect} onToggleStar={() => {}} />);
    fireEvent.click(screen.getByText("hello"));
    expect(onSelect).toHaveBeenCalledWith("notes/hello.md");
  });

  it("collapses and expands", () => {
    const paths = new Set(["notes/x.md"]);
    render(<FavoritesSection starredPaths={paths} onSelect={() => {}} onToggleStar={() => {}} />);
    expect(screen.getByText("x")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /favorites/i }));
    expect(screen.queryByText("x")).not.toBeInTheDocument();
  });
});
