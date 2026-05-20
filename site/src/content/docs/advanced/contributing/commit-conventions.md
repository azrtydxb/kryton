---
title: Commit conventions
description: Conventional Commits, enforced by commitlint in CI. The format, the types, and good vs bad examples.
---

Kryton enforces [Conventional Commits](https://www.conventionalcommits.org/) via [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint). The CI gate rejects commits whose subject line doesn't match the format.

## Config

```js title="commitlint.config.js"
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
```

No customisation — the default ruleset.

## Format

```
<type>(<scope>)?: <subject>

<body?>

<footer?>
```

- **type** — required. One of the types below.
- **scope** — optional. The area of the codebase the change touches (`server`, `client`, `kanban`, `helm`, `operator`, …).
- **subject** — required. Imperative present-tense, ≤ 100 chars, no period at the end, lowercase first letter.
- **body** — optional. Why this change, not what (the diff says what). Wrap at 72 chars.
- **footer** — optional. `BREAKING CHANGE: …`, `Closes #123`, `Refs #456`.

## Types

| Type | When |
|---|---|
| `feat` | A new feature visible to users. |
| `fix` | A bug fix visible to users. |
| `docs` | Documentation only. |
| `style` | Whitespace, formatting, missing semicolons — no logic change. |
| `refactor` | Code change that neither fixes a bug nor adds a feature. |
| `perf` | A performance improvement. |
| `test` | Adding or updating tests. |
| `build` | Build system, dependencies, package metadata. |
| `ci` | GitHub Actions workflows, CI plumbing. |
| `chore` | Other maintenance that doesn't fit above (housekeeping, version bumps). |
| `revert` | Reverts a previous commit; the body should reference it. |

## Good examples

```
feat(kanban): drag cards between columns

Drag with the mouse or the keyboard (Space to pick up, arrows to move,
Enter to drop). Round-trips via api.notes.update.

Closes #412
```

```
fix(server): preserve session cookie across OAuth callback
```

```
docs(plugins): document the `interactive` flag on fence renderers
```

```
refactor(client): extract useD3Graph from the 275-line Graph effect
```

```
feat(helm)!: rename env.config.SECRET to env.secret.SECRET

BREAKING CHANGE: helm values now distinguish config-map vs secret env.
Existing installs must migrate `env.SECRET` entries under `env.secret.*`.
```

## Bad examples (and why)

| Subject | Problem |
|---|---|
| `WIP` | Not a Conventional Commit. CI rejects. |
| `fixed kanban drag` | Missing colon and type prefix; also past tense. |
| `feat: Add a new feature.` | Subject capitalised and ends with a period. |
| `feat(server): adds rate limiting` | Use imperative: "add", not "adds". |
| `chore: stuff` | Subject too vague. Describe the change. |
| `fix(client): fix bug in editor where if you type fast and then click somewhere the cursor jumps` | > 100 chars. Move detail to the body. |

## Why this matters

- **Changelog generation** — [`git-cliff`](https://git-cliff.org/) reads the commit history and emits a categorised changelog at release time. Bad subjects → missing or mislabelled entries.
- **Reviewer scan** — the type prefix lets reviewers and bisectors prioritise. A wall of unprefixed subjects forces everyone to read the diff to understand the shape of a PR.
- **Bisect** — `feat`/`fix`/`refactor` boundaries are natural bisect points.

## Tooling

Locally:

```bash
# After staging your changes
git commit
# commitlint's husky hook (if installed) checks the subject before recording
```

If the hook isn't wired (fresh clone), `npm run prepare` from the repo root installs it.

## Multi-line bodies

For anything non-trivial, add a body that answers "why":

```
fix(server): rate-limit MCP tool calls per key, not per IP

MCP agents typically connect from a single egress IP shared across many
keys. The old IP-bucketed limit punished one user's keys for another
user's traffic. Switch to per-key buckets to restore isolation.

Refs #678
```

## Breaking changes

Either prefix the subject with `!`:

```
feat(client)!: rename note action API from `onClick` to `execute`
```

…or include a `BREAKING CHANGE:` footer:

```
feat(client): rename note action API

BREAKING CHANGE: registerNoteAction now takes `execute` instead of
`onClick`. Existing plugins must rename the field.
```

Both are accepted by commitlint; the footer form gives you room to explain.

## See also

- [Dev setup](/kryton/advanced/contributing/dev-setup/)
- [Release process](/kryton/advanced/contributing/release-process/) — how the changelog is generated from these commits.
