---
title: Commit conventions
description: Conventional Commits enforced by commitlint and a husky commit-msg hook.
---

## What is enforced

`commitlint.config.js` in the repo root is a one-liner:

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
```

That means commits must follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/) as enforced by `@commitlint/config-conventional`. The `.husky/commit-msg` hook runs `npx --no -- commitlint --edit $1` on every commit, so non-conforming messages are rejected locally.

## Format

```
<type>(<scope>)?: <subject>

<body>

<footer>
```

Rules in effect (from `@commitlint/config-conventional`):

| Rule | Value |
|---|---|
| `type-enum` | One of: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test` |
| `type-case` | lower-case |
| `type-empty` | type is required |
| `subject-empty` | subject is required |
| `subject-full-stop` | subject must not end with `.` |
| `subject-case` | must not be sentence-case, start-case, pascal-case, or upper-case |
| `header-max-length` | 100 chars |
| `body-leading-blank` | blank line between header and body (warning) |
| `body-max-line-length` | 100 chars per line (warning) |
| `footer-leading-blank` | blank line between body and footer (warning) |
| `footer-max-line-length` | 100 chars per line (warning) |

## Good examples

```
feat(tabs): cap simultaneous open tabs at 4 with FIFO eviction
fix(sidebar): correct move up/down boundaries + reorder + graph recenter on resize
docs(README): document npx @azrtydxb/kryton-init as the recommended way to connect agents
```

All three are drawn straight from `git log`.

## Bad examples

```
Added new feature.
```

Fails `type-empty` (no type), `subject-case` (start-case), and `subject-full-stop` (trailing period).

```
FEAT: new plugin slot
```

Fails `type-case` (must be lower-case).

```
fix: This is an extremely long subject line that wanders well past one hundred characters and therefore exceeds the configured header-max-length limit
```

Fails `header-max-length` (over 100 chars).

## Scope (optional but encouraged)

The repo uses scopes liberally — `server`, `client`, `plugins`, `admin`, `ui`, `sidebar`, `kryton-init`, `site`, etc. Pick the package or area touched. `git log --oneline` shows the convention in practice.

## Pre-commit

Alongside the commit-msg check, `.husky/pre-commit` runs `lint-staged`, which executes `eslint --fix` against staged TypeScript files under `packages/client/src/` and `packages/server/src/`.
