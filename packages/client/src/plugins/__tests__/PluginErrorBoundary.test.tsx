import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PluginErrorBoundary } from "../PluginErrorBoundary";

const ThrowingComponent = () => {
  throw new Error("Component crash");
};

describe("PluginErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <div>Hello</div>
      </PluginErrorBoundary>
    );
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("renders fallback on error", () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <ThrowingComponent />
      </PluginErrorBoundary>
    );
    expect(screen.getByText(/Test Plugin encountered an error/)).toBeDefined();
    spy.mockRestore();
  });

  it("provides a retry button that resets the error", () => {
    let shouldThrow = true;
    const MaybeThrow = () => {
      if (shouldThrow) throw new Error("crash");
      return <div>Recovered</div>;
    };

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <MaybeThrow />
      </PluginErrorBoundary>
    );

    expect(screen.getByText(/encountered an error/)).toBeDefined();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Retry"));

    // After retry, re-render with no-throw component
    rerender(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <MaybeThrow />
      </PluginErrorBoundary>
    );

    expect(screen.getByText("Recovered")).toBeDefined();
    spy.mockRestore();
  });
});
