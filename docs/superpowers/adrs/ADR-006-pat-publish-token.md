# ADR-006: `NPM_PUBLISH_TOKEN` PAT Secret for Cross-Repo Package Publishing

**Date:** 2026-04-30
**Status:** Accepted
**Sub-project:** Core Publishing (spec 5 of 5)

## Context

Publishing `@azrtydxb/core` and `@azrtydxb/core-react` from the `azrtydxb/kryton` CI workflow to GitHub Packages requires a token with `packages: write` permission. The natural first choice is `GITHUB_TOKEN`, the automatic token that GitHub Actions injects into every workflow run.

`GITHUB_TOKEN` works for publishing packages to the *same repository* that owns the workflow. However, consumers of the published packages live in a *different repository* (`azrtydxb/kryton-mobile`) and need to install from GitHub Packages. GitHub Packages installation requires a token with `read:packages` scope on the *consumer* side — and `GITHUB_TOKEN` is scoped to a single repository and cannot be used cross-repo.

If the publish-side token were `GITHUB_TOKEN`, the CI would succeed, but every developer and every CI pipeline in `kryton-mobile` would still need a PAT anyway. A PAT is unavoidable on the consumer side; standardising on a PAT for publish too keeps the token model consistent and reduces conceptual surface area.

## Decision

A Personal Access Token (PAT) with `write:packages` (and `read:packages`) scope is created under the `azrtydxb` account and stored as `NPM_PUBLISH_TOKEN` in the `azrtydxb/kryton` repository secrets.

The publish workflow uses `NPM_PUBLISH_TOKEN` in the `.npmrc` written during the publish step:

```
//npm.pkg.github.com/:_authToken=${NPM_PUBLISH_TOKEN}
@azrtydxb:registry=https://npm.pkg.github.com
```

Consumer repositories (and local developer environments) configure a separate PAT with `read:packages` scope as `GITHUB_TOKEN` (or a named secret) in their own `.npmrc`.

## Consequences

**Gains:**
- A single token type (`classic PAT`, scoped to packages) is used on both publish and install sides — fewer mental models.
- The PAT can be scoped to `write:packages` only, limiting blast radius if compromised compared to a broad organisation token.
- Works correctly for cross-repository package consumption without any GitHub Actions `permissions:` workaround.

**Costs:**
- PATs are tied to a specific GitHub user account; if that account is removed or the PAT expires, CI publish breaks silently until the secret is rotated.
- PATs must be rotated manually (or on expiry); `GITHUB_TOKEN` rotates automatically. A calendar reminder or a "token expiry check" CI job is recommended.
- Developers cloning `kryton-mobile` for the first time must create and configure their own `read:packages` PAT — documented in `kryton-mobile/README.md`.

## References

- `docs/superpowers/specs/2026-04-30-core-publishing-design.md` (Token management section)
- ADR-001: `@azrtydxb` scope (registry choice drives the token requirement)
