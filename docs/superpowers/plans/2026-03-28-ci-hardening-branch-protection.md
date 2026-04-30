# CI Hardening & Branch Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the CI pipeline with strict linting, add git hooks with conventional commits, set up branch protection with automerge, and create an automated release workflow with multi-arch Docker and auto-generated release notes.

**Architecture:** Husky manages git hooks locally (pre-commit runs lint-staged, commit-msg runs commitlint). CI validates everything on PRs. A separate release workflow triggers on `v*` tags to build multi-arch Docker images and auto-generate release notes via git-cliff.

**Tech Stack:** Husky 9, lint-staged 15, commitlint 19, git-cliff, GitHub Actions, Docker Buildx (QEMU for ARM64)

---

### Task 1: Fix server lint strictness

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: Add `--max-warnings 0` to server lint script**

In `packages/server/package.json`, change the lint script from:

```json
"lint": "eslint src",
```

to:

```json
"lint": "eslint src --max-warnings 0",
```

- [ ] **Step 2: Verify lint passes**

```bash
cd packages/server && npm run lint
```

Expected: exits 0 with no warnings or errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json
git commit -m "ci: enforce zero warnings in server lint"
```

---

### Task 2: Install Husky, lint-staged, and commitlint

**Files:**
- Modify: `package.json` (root)
- Create: `.husky/pre-commit`
- Create: `.husky/commit-msg`
- Create: `commitlint.config.js`

- [ ] **Step 1: Install devDependencies**

```bash
npm install --save-dev husky lint-staged @commitlint/cli @commitlint/config-conventional
```

- [ ] **Step 2: Add `prepare` script and `lint-staged` config to root `package.json`**

Add to the `"scripts"` section:

```json
"prepare": "husky"
```

Add a new top-level `"lint-staged"` key:

```json
"lint-staged": {
  "packages/client/src/**/*.{ts,tsx}": "eslint --fix",
  "packages/server/src/**/*.ts": "eslint --fix"
}
```

- [ ] **Step 3: Initialize Husky**

```bash
npx husky init
```

This creates the `.husky/` directory.

- [ ] **Step 4: Create pre-commit hook**

Write `.husky/pre-commit`:

```bash
npx lint-staged
```

- [ ] **Step 5: Create commit-msg hook**

Write `.husky/commit-msg`:

```bash
npx --no -- commitlint --edit $1
```

- [ ] **Step 6: Create commitlint config**

Write `commitlint.config.js`:

```javascript
export default {
  extends: ['@commitlint/config-conventional'],
};
```

- [ ] **Step 7: Verify hooks work**

Test with a bad commit message:

```bash
echo "test" > /tmp/test-commit-msg
npx --no -- commitlint --edit /tmp/test-commit-msg
```

Expected: error about invalid format.

Test with a good commit message:

```bash
echo "feat: test message" > /tmp/test-commit-msg
npx --no -- commitlint --edit /tmp/test-commit-msg
```

Expected: exits 0.

- [ ] **Step 8: Add `.husky/` to git and commit**

```bash
git add package.json package-lock.json .husky/ commitlint.config.js
git commit -m "ci: add husky, lint-staged, and commitlint for git hooks"
```

---

### Task 3: Create release workflow with multi-arch Docker and auto release notes

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `cliff.toml`

- [ ] **Step 1: Create git-cliff config**

Write `cliff.toml`:

```toml
[changelog]
header = ""
body = """
{% for group, commits in commits | group_by(attribute="group") %}
## {{ group | upper_first }}
{% for commit in commits %}
- {{ commit.message | split(pat="\n") | first | trim }}\
{% endfor %}
{% endfor %}
"""
trim = true

[git]
conventional_commits = true
commit_parsers = [
  { message = "^feat", group = "New Features" },
  { message = "^fix", group = "Bug Fixes" },
  { message = "^perf", group = "Performance" },
  { message = "^doc", group = "Other Changes" },
  { message = "^chore", group = "Other Changes" },
  { message = "^ci", group = "Other Changes" },
  { message = "^refactor", group = "Other Changes" },
  { message = "^style", group = "Other Changes" },
  { message = "^test", group = "Other Changes" },
]
filter_commits = false
```

- [ ] **Step 2: Create release workflow**

Write `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/kryton

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma client
        run: npx prisma generate --schema=packages/server/prisma/schema.prisma

      - name: TypeCheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build

      - name: Upload client dist
        uses: actions/upload-artifact@v4
        with:
          name: client-dist
          path: packages/client/dist

      - name: Upload server dist
        uses: actions/upload-artifact@v4
        with:
          name: server-dist
          path: packages/server/dist

  docker:
    needs: ci
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Download client dist
        uses: actions/download-artifact@v4
        with:
          name: client-dist
          path: packages/client/dist

      - name: Download server dist
        uses: actions/download-artifact@v4
        with:
          name: server-dist
          path: packages/server/dist

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - name: Build and push (multi-arch)
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  release:
    needs: [ci, docker]
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Generate release notes
        id: changelog
        uses: orhun/git-cliff-action@v4
        with:
          config: cliff.toml
          args: --latest --strip header
        env:
          OUTPUT: CHANGELOG.md

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: CHANGELOG.md
          generate_release_notes: false
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml cliff.toml
git commit -m "ci: add release workflow with multi-arch Docker and auto release notes"
```

---

### Task 4: Set up branch protection on master

**Files:** None (GitHub API configuration)

- [ ] **Step 1: Enable auto-merge on the repository**

```bash
gh repo edit piwi3910/kryton --enable-auto-merge --delete-branch-on-merge --enable-squash-merge --disable-merge-commit --disable-rebase-merge
```

- [ ] **Step 2: Set branch protection rules**

```bash
gh api repos/piwi3910/kryton/branches/master/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

This requires PRs (no direct push), requires the `build` check to pass, requires branch to be up-to-date, but does NOT require reviews (solo dev can merge own PRs).

- [ ] **Step 3: Verify protection is active**

```bash
gh api repos/piwi3910/kryton/branches/master/protection --jq '.required_status_checks.contexts'
```

Expected: `["build"]`

---

### Task 5: Push everything and verify the new workflow

- [ ] **Step 1: Push all commits to master**

This is the last direct push to master before protection is enabled.

```bash
git push origin master
```

- [ ] **Step 2: Enable branch protection (run Task 4 steps)**

Run the `gh` commands from Task 4 after pushing.

- [ ] **Step 3: Test the new workflow**

Create a test branch and PR:

```bash
git checkout -b test/ci-validation
echo "" >> README.md
git add README.md
git commit -m "test: verify CI and branch protection"
git push -u origin test/ci-validation
gh pr create --title "test: verify CI and branch protection" --body "Testing the new CI pipeline and branch protection."
gh pr merge --auto --squash
```

Wait for CI to pass and auto-merge to complete, then verify:

```bash
gh pr view --json state,mergedAt
```

Expected: `"state": "MERGED"`

- [ ] **Step 4: Clean up test branch**

```bash
git checkout master
git pull
git branch -d test/ci-validation
```
