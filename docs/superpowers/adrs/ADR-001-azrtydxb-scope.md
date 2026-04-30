# ADR-001: npm Scope Rename from `@kryton` to `@azrtydxb`

**Date:** 2026-04-30
**Status:** Accepted
**Sub-project:** Core Publishing (spec 5 of 5)

## Context

When the decision was made to publish `core` and `core-react` as npm packages from the kryton monorepo, a scope name was required. GitHub Packages enforces that the npm scope must exactly match the GitHub organisation or user account that owns the repository. The kryton monorepo lives under the `azrtydxb` GitHub account, so only `@azrtydxb/*` packages can be published to `npm.pkg.github.com` from that repo without extra registry configuration.

A `@kryton` scope would require either a separate GitHub organisation named `kryton` (not the same as the current account) or publishing to a different registry (npm.org or a self-hosted registry), both of which add operational overhead and cost without meaningful benefit at this stage.

## Decision

All published packages use the `@azrtydxb` scope:

- `@azrtydxb/core` — platform-agnostic offline-first data layer
- `@azrtydxb/core-react` — React hooks wrapper around core

Registry: `npm.pkg.github.com`. Access is private (tied to GitHub repository read permissions). The scope name is final — changing it later is a breaking change for all consumers and requires a re-publish under the new name.

The package source paths (`packages/core/`, `packages/core-react/`) and internal monorepo references continue to use the short name `core` / `core-react` for brevity.

## Consequences

**Gains:**
- Zero extra registry infrastructure; GitHub Packages is already in use for container images.
- Access control inherits existing repository permissions — no separate token management for read access.
- Claiming `@azrtydxb/core` on `npm.pkg.github.com` is a one-time manual publish; CI owns all subsequent releases.

**Costs:**
- Consumers must configure `.npmrc` with `@azrtydxb:registry=https://npm.pkg.github.com` and a valid `GITHUB_TOKEN` or PAT (see ADR-006).
- If the package is ever made public on npm.org, the scope name (`@azrtydxb`) must remain — or a breaking rename is required.
- The scope is tied to the GitHub account name; a future org rename would require package migration.

## References

- `docs/superpowers/specs/2026-04-30-core-publishing-design.md`
- ADR-006: PAT publish token
