import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareList } from "../ShareList";
import { AccessRequestList } from "../AccessRequestList";
import { AccessRequestNotification } from "../AccessRequestNotification";
import { ShareInviteForm } from "../ShareInviteForm";
import type { ShareEntry } from "../ShareList";
import type { AccessRequest } from "../AccessRequestList";

const makeShare = (overrides: Partial<ShareEntry> = {}): ShareEntry => ({
  id: "s1",
  sharedWithUserId: "u1",
  sharedWithEmail: "user@example.com",
  permission: "read",
  ...overrides,
});

const makeRequest = (overrides: Partial<AccessRequest> = {}): AccessRequest => ({
  id: "r1",
  requesterUserId: "u2",
  requesterName: "Alice",
  requesterEmail: "alice@example.com",
  notePath: "notes/foo.md",
  status: "pending",
  createdAt: new Date("2026-01-01").toISOString(),
  ...overrides,
});

describe("ShareList", () => {
  it("renders shares with email and permission badge", () => {
    render(
      <ShareList
        shares={[makeShare()]}
        onTogglePermission={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("shows empty message when no shares", () => {
    render(
      <ShareList
        shares={[]}
        onTogglePermission={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );
    expect(screen.getByText(/not shared with anyone yet/i)).toBeInTheDocument();
  });

  it("calls onRevoke when revoke button clicked", () => {
    const onRevoke = vi.fn();
    render(
      <ShareList
        shares={[makeShare({ id: "s42" })]}
        onTogglePermission={vi.fn()}
        onRevoke={onRevoke}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /revoke access/i }));
    expect(onRevoke).toHaveBeenCalledWith("s42");
  });

  it("calls onTogglePermission when permission badge clicked", () => {
    const onToggle = vi.fn();
    render(
      <ShareList
        shares={[makeShare()]}
        onTogglePermission={onToggle}
        onRevoke={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Read"));
    expect(onToggle).toHaveBeenCalled();
  });
});

describe("AccessRequestList", () => {
  it("renders pending requests", () => {
    render(
      <AccessRequestList
        requests={[makeRequest()]}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("notes/foo.md")).toBeInTheDocument();
  });

  it("shows 'no pending requests' when empty", () => {
    render(
      <AccessRequestList requests={[]} onApprove={vi.fn()} onDeny={vi.fn()} />,
    );
    expect(screen.getByText(/no pending requests/i)).toBeInTheDocument();
  });

  it("shows permission picker on Approve click then calls onApprove on Confirm", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <AccessRequestList
        requests={[makeRequest({ id: "req1" })]}
        onApprove={onApprove}
        onDeny={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() =>
      expect(onApprove).toHaveBeenCalledWith("req1", "read"),
    );
  });

  it("calls onDeny when deny clicked", () => {
    const onDeny = vi.fn();
    render(
      <AccessRequestList
        requests={[makeRequest({ id: "req2" })]}
        onApprove={vi.fn()}
        onDeny={onDeny}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onDeny).toHaveBeenCalledWith("req2");
  });
});

describe("AccessRequestNotification", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(
      <AccessRequestNotification count={0} onClick={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders badge with count and calls onClick", () => {
    const onClick = vi.fn();
    render(<AccessRequestNotification count={3} onClick={onClick} />);
    expect(screen.getByText(/3 access requests/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("ShareInviteForm", () => {
  it("calls onSearchUser when Find is clicked", async () => {
    const onSearchUser = vi.fn().mockResolvedValue({
      id: "u99",
      name: "Bob",
      email: "bob@example.com",
    });
    render(
      <ShareInviteForm
        notePath="notes/test.md"
        onSearchUser={onSearchUser}
        onInvite={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/enter email/i);
    fireEvent.change(input, { target: { value: "bob@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /find/i }));
    await waitFor(() =>
      expect(onSearchUser).toHaveBeenCalledWith("bob@example.com"),
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows error when user not found", async () => {
    const onSearchUser = vi.fn().mockRejectedValue(new Error("not found"));
    render(
      <ShareInviteForm
        notePath="notes/test.md"
        onSearchUser={onSearchUser}
        onInvite={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/enter email/i);
    fireEvent.change(input, { target: { value: "ghost@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /find/i }));
    await waitFor(() =>
      expect(screen.getByText(/user not found/i)).toBeInTheDocument(),
    );
  });
});
