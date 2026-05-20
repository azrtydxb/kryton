---
title: Upgrades and migrations
description: How Kryton handles version upgrades, the on-boot migration flow, version checks, and rollback caveats.
---

Kryton ships a single server image per version. The image embeds the client bundle, the server, and every Drizzle migration up to that point. Upgrading is "swap the image, restart" — no separate migration step, no maintenance window in the typical case.

## The migration flow

On every boot the server:

1. Connects to Postgres using `POSTGRES_URL`.
2. Inspects the `drizzle_migrations` table.
3. Applies every migration newer than the latest applied one, in order, inside a transaction per file.
4. Initialises the semantic-search worker (a no-op if `SEMANTIC_PROVIDER=off`).
5. Starts the HTTP listener and the Yjs WebSocket server.

If step 3 fails, the server exits non-zero. Postgres is left at the last successfully-applied migration. The pod (or Docker container) restarts and tries again — fix the underlying cause (insufficient privileges, missing extension, disk space) and the next boot picks up.

## Version check

```bash
curl -fsS https://kryton.example.com/api/version
# {"version":"4.6.0","commit":"a1b2c3d","node":"24.x"}
```

The CI release pipeline stamps `version` and `commit` into the image at build time. `node` is the Node runtime version inside the container.

Clients call this endpoint on every reload and compare the response against the version they were built for. A version mismatch surfaces a soft "reload to upgrade" banner — no force-disconnect, no data loss.

## Major-version compatibility

Kryton uses [SemVer](https://semver.org/). The server's contract:

- **Patch** (`x.y.Z`) — bug fixes only. Always forward-safe.
- **Minor** (`x.Y.z`) — additive changes: new endpoints, new schema columns (nullable / defaulted), new env vars (with defaults), new plugin API surface. Always forward-safe.
- **Major** (`X.y.z`) — anything else. Breaking. See the [changelog](/kryton/advanced/reference/changelog/) before upgrading. Pre-major versions (`v0.x`, `v1.x`) get a longer migration grace window with at least one minor that warns about the upcoming break.

### Rollback caveats

Drizzle migrations are **not** automatically reversible. The server applies forward-only. If you must roll back a major version:

1. Restore the database from the most recent backup taken **before** the upgrade. See [Backups and restore](/kryton/advanced/deployment/backups-restore/).
2. Restore the notes directory from the same backup window (file paths or content may have been rewritten by the upgrade — e.g. a wiki-link migration).
3. Redeploy the old image.

Restoring only the image without rolling the DB leaves the old server staring at a schema it doesn't understand. The server will refuse to boot.

Always take a backup immediately before any major upgrade. Routine minor / patch upgrades are forward-safe and a fresh backup isn't required, but you should still have a recent one on hand.

## Compose

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose logs -f kryton   # watch migrations run
```

If you pin a specific tag (recommended), bump it in `docker-compose.prod.yml` before `pull`. The `latest` tag floats.

## Helm

```bash
helm upgrade kryton oci://ghcr.io/azrtydxb/charts/kryton \
  --version 4.7.0 \
  --namespace kryton \
  --reuse-values
```

The chart's `version` and `appVersion` track 1:1. `--reuse-values` keeps your overrides; drop it if you're also changing values. With RWO storage the chart's strategy is `Recreate` (old pod terminates before the new one starts); under RWX it can `RollingUpdate`. Either way, the new pod must pass `/readyz` (which includes a DB check) before traffic flows.

## Operator

```bash
# 1. Upgrade the CRDs first (additive, safe).
kubectl apply -f https://github.com/azrtydxb/kryton/releases/download/v4.7.0/kryton-crds.yaml

# 2. Upgrade the operator Deployment.
kubectl apply -n kryton-system \
  -f https://github.com/azrtydxb/kryton/releases/download/v4.7.0/kryton-operator.yaml

# 3. Bump each Kryton instance.
kubectl -n kryton patch kryton my-kryton --type=merge \
  -p '{"spec":{"version":"4.7.0"}}'
```

In a multi-instance cluster, roll one CR at a time. The operator does not enforce serial rollout — that's your operational choice.

## Pre-release tags

Pre-release versions are tagged `vX.Y.Z-pre.N` (e.g. `v4.7.0-pre.3`). They're built and pushed like full releases but aren't tagged `latest`. Use them for staging environments; never auto-track them into production.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Server exits with `migration X failed` | Migration ran into a permissions / extension issue. | Read the error; usually `CREATE EXTENSION vector` or a missing role privilege. |
| `/api/version` returns the old version after upgrade | Browser cached the bundle. | Hard reload (Ctrl-Shift-R) — service worker invalidates on version bump. |
| New version refuses to boot, `column "foo" does not exist` | A migration was rolled back manually but the server image expects it. | Restore from backup and re-apply the upgrade. |
| Migration is slow on first boot after a major upgrade | Backfill migration on a large table. | Let it complete; check `kubectl logs` for progress. |

## See also

- [Changelog](/kryton/advanced/reference/changelog/) — what's in each release.
- [Backups and restore](/kryton/advanced/deployment/backups-restore/)
- [Release process](/kryton/advanced/contributing/release-process/) — how releases get made.
