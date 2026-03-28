# CI Hardening, Branch Protection & Developer Workflow

**Date**: 2026-03-28
**Status**: Approved

## Problem

The CI pipeline has gaps (single-arch Docker, server lint allows warnings), there are no git hooks or commit conventions, no branch protection, and releases are manual. This makes it unsafe to enable automerge and leaves quality enforcement entirely to CI.

## Design

### 1. CI Hardening

- Add `--max-warnings 0` to server lint script to match client strictness.
- Keep existing `ci.yml` workflow for master pushes and PRs: single-arch Docker build for fast feedback.
- The existing `ci.yml` Docker job continues to build single-arch on every master push.

### 2. Git Hooks & Commit Conventions

**Tools:** Husky (git hooks), lint-staged (fast pre-commit), commitlint (conventional commits).

**Pre-commit hook:** Runs lint-staged on staged `*.ts` and `*.tsx` files only — `eslint --fix`. ~2 seconds, non-blocking.

**Commit-msg hook:** Validates conventional commit format. Required prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `style:`, `perf:`. Scopes optional (e.g. `feat(mobile):`). Rejects non-conforming messages.

**Install:** Husky auto-installs via `prepare` script in root `package.json` on `npm install`.

### 3. Branch Protection on `master`

- Require pull request (no direct pushes).
- Minimum 0 approvals (solo developer — can merge own PRs).
- Require `build` status check to pass before merge.
- Require branch to be up-to-date with master.
- Squash merge only (no merge commits, no rebase).
- No force pushes, no branch deletion.

**Automerge:** GitHub's built-in auto-merge. After creating a PR, run `gh pr merge --auto --squash` to auto-merge when CI passes.

**Developer workflow:**
1. Create feature branch, commit with conventional commits.
2. Push branch, open PR.
3. CI runs (lint, typecheck, test, build).
4. Enable auto-merge → squash merges when green.
5. On version tags → multi-arch Docker + auto release.

### 4. Release Workflow (`release.yml`)

**Trigger:** Push of a `v*` tag.

**Steps:**
1. Run full CI (lint, typecheck, test, build).
2. Build multi-arch Docker image (`linux/amd64` + `linux/arm64`) and push to GHCR with version tag + `latest`.
3. Auto-generate release notes from commits since last tag using `git-cliff`, grouped by conventional commit type:
   - `feat:` → **New Features**
   - `fix:` → **Bug Fixes**
   - `perf:` → **Performance**
   - `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `style:` → **Other Changes**
4. Create GitHub release with generated notes automatically.

**Config:** `cliff.toml` in repo root for changelog template.

**Manual step:** Only tagging: `git tag vX.Y.Z && git push origin vX.Y.Z`. Everything else is automated.

## Changes Summary

| Area | Change |
|------|--------|
| Server `package.json` | Add `--max-warnings 0` to lint script |
| Root `package.json` | Add `prepare` script, husky, lint-staged, commitlint devDeps |
| `.husky/pre-commit` | lint-staged |
| `.husky/commit-msg` | commitlint |
| `commitlint.config.js` | Conventional commit rules |
| `.lintstagedrc` | ESLint on staged TS/TSX files |
| `.github/workflows/release.yml` | New: multi-arch Docker + auto release notes on `v*` tags |
| `cliff.toml` | git-cliff changelog config |
| GitHub repo settings | Branch protection rules on master |

## Not Changing

- Existing `ci.yml` workflow (stays as-is, single-arch Docker on master push)
- Test framework or coverage thresholds (separate concern)
- Mobile package lint/test setup (no tests exist yet)
