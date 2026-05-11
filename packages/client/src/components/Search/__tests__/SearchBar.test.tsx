import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SearchBar } from "../SearchBar";

type FetchInput = string | URL | Request;

interface FetchHandler {
  match: (url: string) => boolean;
  respond: () => unknown;
}

function installFetch(handlers: FetchHandler[]): void {
  global.fetch = vi.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const h of handlers) {
      if (h.match(url)) {
        return new Response(JSON.stringify(h.respond()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: "not handled" }), { status: 404 });
  }) as unknown as typeof fetch;
}

describe("SearchBar — semantic mode toggle", () => {
  beforeEach(() => {
    // Default: readiness endpoint always responds "off" with no jobs so the
    // poll loop is harmless for tests that don't care about it.
    installFetch([
      {
        match: (u) => u.includes("/api/search/semantic/ready"),
        respond: () => ({
          ready: true,
          provider: "pgvector-local",
          model: "test",
          dimensions: 384,
          pendingJobs: 0,
        }),
      },
      { match: () => true, respond: () => [] },
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in lexical mode and switches to semantic on click", () => {
    render(<SearchBar onSelect={() => {}} />);
    const lexical = screen.getByTestId("search-mode-lexical");
    const semantic = screen.getByTestId("search-mode-semantic");
    expect(lexical.dataset.active).toBe("true");
    expect(semantic.dataset.active).toBe("false");

    fireEvent.click(semantic);
    expect(semantic.dataset.active).toBe("true");
    expect(lexical.dataset.active).toBe("false");
  });

  it("shows a warming-up indicator when semantic ready=false", async () => {
    installFetch([
      {
        match: (u) => u.includes("/api/search/semantic/ready"),
        respond: () => ({
          ready: false,
          provider: "pgvector-local",
          dimensions: 384,
          pendingJobs: 0,
        }),
      },
      { match: () => true, respond: () => [] },
    ]);
    render(<SearchBar onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("search-mode-semantic"));

    // Type a query so the dropdown opens.
    const input = screen.getByPlaceholderText(/Search notes/i);
    fireEvent.change(input, { target: { value: "hello" } });

    await waitFor(
      () => {
        expect(screen.getByTestId("search-warming-up")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("shows the 'N notes still indexing' hint when ready with pendingJobs > 0", async () => {
    installFetch([
      {
        match: (u) => u.includes("/api/search/semantic/ready"),
        respond: () => ({
          ready: true,
          provider: "pgvector-local",
          model: "test",
          dimensions: 384,
          pendingJobs: 3,
        }),
      },
      { match: () => true, respond: () => [] },
    ]);
    render(<SearchBar onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("search-mode-semantic"));

    await waitFor(
      () => {
        const hint = screen.getByTestId("search-indexing-hint");
        expect(hint.textContent).toMatch(/3 notes still indexing/);
      },
      { timeout: 2000 },
    );
  });

  it("renders score badges on hit rows when results include scores", async () => {
    installFetch([
      {
        match: (u) => u.includes("/api/search/semantic/ready"),
        respond: () => ({
          ready: true,
          provider: "pgvector-local",
          model: "test",
          dimensions: 384,
          pendingJobs: 0,
        }),
      },
      {
        match: (u) => u.includes("/api/search?") && u.includes("mode=semantic"),
        respond: () => [
          { path: "alpha.md", title: "Alpha", snippet: "hello world", tags: [], score: 0.82 },
          { path: "beta.md", title: "Beta", snippet: "another", tags: [], score: 0.51 },
        ],
      },
      { match: () => true, respond: () => [] },
    ]);
    render(<SearchBar onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("search-mode-semantic"));

    // Wait for the readiness poll to land so the gate opens for semantic queries.
    await waitFor(
      () => {
        expect(screen.queryByTestId("search-warming-up")).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    const input = screen.getByPlaceholderText(/Search notes/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "hello" } });
    });

    await waitFor(
      () => {
        const badges = screen.getAllByTestId("result-score");
        expect(badges).toHaveLength(2);
        expect(badges[0].textContent).toMatch(/score 0\.82/);
        expect(badges[1].textContent).toMatch(/score 0\.51/);
      },
      { timeout: 3000 },
    );
  });
});
