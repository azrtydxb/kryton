import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchInput } from "../SearchInput";
import { SearchResults, type SearchResultItem } from "../SearchResults";
import { BacklinksPanel } from "../BacklinksPanel";

const makeResult = (overrides: Partial<SearchResultItem> = {}): SearchResultItem => ({
  path: "notes/result.md",
  title: "Result Note",
  snippet: "Some content here",
  tags: [],
  ...overrides,
});

// ─── SearchInput ────────────────────────────────────────────────────────────

describe("SearchInput", () => {
  it("renders with placeholder", () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Find…" />);
    expect(screen.getByPlaceholderText("Find…")).toBeInTheDocument();
  });

  it("calls onChange with input value", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("shows clear button when value is non-empty", () => {
    render(<SearchInput value="some query" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /clear search/i })).toBeInTheDocument();
  });

  it("does not show clear button when value is empty", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /clear search/i })).not.toBeInTheDocument();
  });

  it("clear button calls onChange with empty string", () => {
    const onChange = vi.fn();
    render(<SearchInput value="hello" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

// ─── SearchResults ───────────────────────────────────────────────────────────

describe("SearchResults", () => {
  it("renders result titles", () => {
    const results = [
      makeResult({ path: "a.md", title: "Alpha" }),
      makeResult({ path: "b.md", title: "Beta" }),
    ];
    render(<SearchResults results={results} onSelect={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<SearchResults results={[]} loading onSelect={() => {}} />);
    expect(screen.getByText(/searching/i)).toBeInTheDocument();
  });

  it("shows no-results message when query is non-empty", () => {
    render(<SearchResults results={[]} query="xyz" onSelect={() => {}} />);
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it("calls onSelect when a result is clicked", () => {
    const onSelect = vi.fn();
    const results = [makeResult({ path: "note.md", title: "My Note" })];
    render(<SearchResults results={results} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("My Note"));
    expect(onSelect).toHaveBeenCalledWith(results[0]);
  });

  it("renders tags for a result", () => {
    const results = [makeResult({ tags: ["react", "ts"] })];
    render(<SearchResults results={results} onSelect={() => {}} />);
    expect(screen.getByText("#react")).toBeInTheDocument();
    expect(screen.getByText("#ts")).toBeInTheDocument();
  });
});

// ─── BacklinksPanel ──────────────────────────────────────────────────────────

describe("BacklinksPanel", () => {
  it("renders collapsed by default", () => {
    const backlinks = [{ path: "a.md", title: "Alpha" }];
    render(<BacklinksPanel backlinks={backlinks} onNoteSelect={() => {}} />);
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("expands when header is clicked", () => {
    const backlinks = [{ path: "a.md", title: "Alpha" }];
    render(<BacklinksPanel backlinks={backlinks} onNoteSelect={() => {}} />);
    fireEvent.click(screen.getByText(/backlinks/i));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("shows count badge when there are backlinks", () => {
    const backlinks = [
      { path: "a.md", title: "Alpha" },
      { path: "b.md", title: "Beta" },
    ];
    render(<BacklinksPanel backlinks={backlinks} onNoteSelect={() => {}} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows no-backlinks message when empty and expanded", () => {
    render(
      <BacklinksPanel backlinks={[]} onNoteSelect={() => {}} defaultExpanded />,
    );
    expect(screen.getByText(/no backlinks/i)).toBeInTheDocument();
  });

  it("calls onNoteSelect when a backlink is clicked", () => {
    const onNoteSelect = vi.fn();
    const backlinks = [{ path: "a.md", title: "Alpha" }];
    render(
      <BacklinksPanel
        backlinks={backlinks}
        onNoteSelect={onNoteSelect}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByText("Alpha"));
    expect(onNoteSelect).toHaveBeenCalledWith("a.md");
  });

  it("shows loading state when expanded", () => {
    render(
      <BacklinksPanel
        backlinks={[]}
        loading
        onNoteSelect={() => {}}
        defaultExpanded
      />,
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
