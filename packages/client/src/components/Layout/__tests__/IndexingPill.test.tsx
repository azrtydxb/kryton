import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { IndexingPill } from "../IndexingPill";

function mockFetchOnce(body: { ready: boolean; pendingJobs: number }): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("IndexingPill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders nothing when pendingJobs is 0", async () => {
    mockFetchOnce({ ready: true, pendingJobs: 0 });
    const { container } = render(<IndexingPill />);
    // initial render before fetch resolves: null
    expect(container.firstChild).toBeNull();
    // flush microtasks so the fetch promise resolves
    await vi.runOnlyPendingTimersAsync();
    expect(container.firstChild).toBeNull();
  });

  it("renders 'N indexing' when pendingJobs > 0", async () => {
    vi.useRealTimers();
    mockFetchOnce({ ready: true, pendingJobs: 3 });
    render(<IndexingPill />);
    await waitFor(() => {
      expect(screen.getByText(/3 indexing/)).toBeInTheDocument();
    });
  });

  it("unmount during pending poll does not call setState", async () => {
    // Construct a fetch promise we never resolve, then unmount the component.
    // If the component called setState after unmount React would log a
    // warning. We assert no console.error fires.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolveFetch!: (v: unknown) => void;
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;

    const { unmount } = render(<IndexingPill />);
    unmount();
    // Resolve after unmount — the component should ignore the result.
    resolveFetch({ ok: true, json: async () => ({ ready: true, pendingJobs: 5 }) });
    await vi.runOnlyPendingTimersAsync();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("renders nothing on 401 (signed-out) without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const { container } = render(<IndexingPill />);
    await vi.runOnlyPendingTimersAsync();
    expect(container.firstChild).toBeNull();
  });
});
