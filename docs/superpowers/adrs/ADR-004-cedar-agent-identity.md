# ADR-004: Cedar Policies for First-Class Agent Identity

**Date:** 2026-04-30
**Status:** Accepted
**Sub-project:** Server Sync v2 (spec 2 of 5)

## Context

Kryton's MCP server gives AI agents read/write access to a user's knowledge base. Initially, agents authenticated with the same session-scoped API keys used by humans. This created two problems:

1. **No granular permission boundary.** An agent key had full read-write access to the user's entire note tree — the same as a logged-in browser. There was no way to say "this agent may only read notes tagged `shared-with-ai`" or "this agent may not delete anything."

2. **No auditable agent identity.** Audit logs showed "user X modified note Y" even when the actual writer was an AI agent acting on X's behalf. Distinguishing human from agent action in logs required out-of-band convention.

Three alternatives were considered for scoping agent permissions:

- **Session-scoped keys with no extra policy** — current state; no granularity.
- **RBAC roles** (e.g., `agent-readonly`, `agent-readwrite`) — predefined roles are inflexible; a "can read all except folder Z" rule requires a new role.
- **Cedar policy language** — attribute-based, expressive, evaluates arbitrary entity/action/resource triples, has a WASM build for server-side evaluation.

## Decision

Agents are first-class database entities (`Agent` model). Each agent carries:

- A short-lived token family (minted via `/api/agents/:id/tokens`, revocable individually).
- An optional Cedar policy document (`Agent.policyText`) stored as Cedar source text.
- A deterministic Cedar principal: `Agent::<agentId>`.

Every authenticated request resolves a principal (user or agent). For agent principals, the server evaluates the Cedar policy against `(principal, action, resource)` before executing the handler. A missing policy defaults to deny-all, forcing explicit allowance.

Cedar evaluation uses `@cedar-policy/cedar-wasm` running in-process. The policy schema covers `Action` (read, write, delete) and `Resource` (Note, Folder, Tag) with optional attribute filters (path prefix, tag membership).

## Consequences

**Gains:**
- Fine-grained, per-agent permission boundaries expressible in natural Cedar syntax.
- Agent actions are attributed to `Agent::<id>` in audit logs, not the owning user.
- Policy changes take effect immediately (no token rotation required).
- Cedar's formal semantics mean "deny-by-default unless explicitly permitted" is structurally enforced.

**Costs:**
- Cedar WASM bundle adds ~1 MB to server startup; measured and accepted (startup measured in milliseconds, not seconds).
- Policy authoring is manual Cedar source text in v1 — no UI; operators write policies by hand.
- Cedar evaluation adds one in-process policy check per authenticated request; benchmarked at sub-millisecond for typical policy sizes.

## References

- `docs/superpowers/specs/2026-04-30-server-sync-v2-design.md` (Cedar schema and entity types, §Agent identity)
- ADR-003: Yjs for content (WebSocket auth uses the same agent token)
