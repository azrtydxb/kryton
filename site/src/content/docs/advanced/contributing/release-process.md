---
title: Release process
description: What happens when a v* tag lands — server image, operator image, Helm chart, mirror to harbor.kw.local, and the pre-release discipline.
---

Releases are tag-driven. Push a tag matching `v*` (e.g. `v4.7.0`, `v4.7.0-pre.1`) and the [`release.yml`](https://github.com/azrtydxb/kryton/blob/master/.github/workflows/release.yml) workflow takes it from there.

## Trigger

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        description: 'Existing v* tag to publish (omit to use github.ref_name)'
        required: false
        type: string
```

Two entry points:

1. **`git tag v4.7.0 && git push origin v4.7.0`** — normal release.
2. **`gh workflow run release.yml --ref master -f tag=v4.7.0`** — re-run the workflow against an existing tag from `master`. Useful when the workflow itself had a bug; the version number stays pinned to the tag.

## Job graph

```
   typecheck ─┐
   lint       │                                                  ┌── helm-publish ──┐
   test       ├── build-arm64 ────────────┐                      │                  │
   e2e        │                           ├── manifest ──────────┼── mirror         ├── release
   build ─────┴── build-amd64 ────────────┘                      │                  │
               ├── build-operator-arm64 ─┐                       └── manifest-operator
               └── build-operator-amd64 ─┴── manifest-operator ──┘
```

Three artefact streams run in parallel after the validation gate (typecheck / lint / test / e2e / build):

### 1. Server image

Per-arch builds — arm64 on a local dind runner, amd64 on a remote BuildKit instance. `manifest` stitches the digests into a multi-arch image tagged `vX.Y.Z`, `X.Y`, and `latest`. Published to `ghcr.io/azrtydxb/kryton/kryton`.

### 2. Operator image

Same per-arch pattern (`build-operator-arm64` + `build-operator-amd64`), same multi-arch stitching (`manifest-operator`). Published to `ghcr.io/azrtydxb/kryton/kryton-operator`.

### 3. Helm chart

`helm-publish` packages `charts/kryton/` and pushes the OCI artifact to `ghcr.io/azrtydxb/charts/kryton:X.Y.Z`. The chart's `version` and `appVersion` track the tag 1:1.

## Mirror to `harbor.kw.local`

After all three streams land, the `mirror` job copies them to the cluster zot registry at `192.168.10.123:5000` (surfaced internally as `harbor.kw.local`):

```yaml
mirror:
  needs: [manifest, manifest-operator, helm-publish]
```

It runs `skopeo copy` for each tag of each artefact (`vX.Y.Z`, `X.Y`, `latest` for images; the exact version for the chart). Cross-registry transfer happens server-side — no rebuild, multi-arch manifest preserved. Mirror failures don't block the GitHub Release; they're best-effort.

The mirror exists so the in-cluster Kubernetes nodes can pull images and charts without hitting `ghcr.io` (egress savings, faster pulls, isolation from outages).

## The Release object

`release` (the final job) creates the GitHub Release with the auto-generated changelog from [`cliff.toml`](https://github.com/azrtydxb/kryton/blob/master/cliff.toml) (driven by `git-cliff` over the Conventional Commits history) and attaches:

- `kryton-crds.yaml` — combined CRD manifest from `operator/config/crd/bases/`.
- `kryton-operator.yaml` — operator Deployment + RBAC + ServiceAccount bundle.

These are the files the Operator install docs reference at `https://github.com/azrtydxb/kryton/releases/download/vX.Y.Z/…`.

## Changesets

Day-to-day, contributors do **not** edit `CHANGELOG.md`. `git-cliff` regenerates it from commit history. The flow:

1. Land Conventional Commits onto `master`. (`feat`, `fix`, `perf`, `refactor` — those land in the changelog. `chore`, `style`, `ci`, `build` don't.)
2. When ready to release, run `git cliff --tag vX.Y.Z --unreleased --prepend CHANGELOG.md`.
3. Commit the changelog update on `master`.
4. Tag the same SHA: `git tag vX.Y.Z && git push origin master vX.Y.Z`.
5. `release.yml` triggers and publishes everything.

## Pre-release discipline

Iterative releases use `vX.Y.Z-pre.N` tags. **Never cut a clean `vX.Y.Z` tag without explicit sign-off.** The flow:

```bash
git tag v4.7.0-pre.1 && git push origin v4.7.0-pre.1
# Verify in staging.
# More fixes land.
git tag v4.7.0-pre.2 && git push origin v4.7.0-pre.2
# When good:
git tag v4.7.0 && git push origin v4.7.0
```

Pre-release tags push their own image tag (`v4.7.0-pre.1`) but **do not** touch `latest`. The Helm chart's `version` includes the pre-release suffix; users opt in by pinning `--version 4.7.0-pre.1`.

## Manual re-runs

When a workflow bug lands and an already-tagged version needs a re-publish:

```bash
gh workflow run release.yml --ref master -f tag=v4.7.0
```

`github.ref_name` resolves to `master` (the manual-trigger ref), so the workflow uses the `tag` input wherever it would have used the ref name. Build artefacts come out tagged `v4.7.0` exactly as if the tag push had triggered it.

## Permissions

`release.yml` runs with `contents: write` (to create the Release) and `packages: write` (to push to ghcr.io). Both come from `GITHUB_TOKEN`. The mirror step uses anonymous push to the cluster zot, which is configured to accept pushes from the github-actions egress range.

## See also

- [Commit conventions](/kryton/advanced/contributing/commit-conventions/) — feeds `git-cliff`.
- [Upgrades and migrations](/kryton/advanced/deployment/upgrades-and-migrations/) — what a release means for operators.
- [Changelog](/kryton/advanced/reference/changelog/) — the generated artefact.
