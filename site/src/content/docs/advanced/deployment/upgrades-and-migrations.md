---
title: Upgrades and migrations
description: Kryton's on-boot Drizzle migrator, the /api/version endpoint, and upgrade ordering for Compose, Helm and the operator.
---

## Migration mechanism

Every Kryton server boot runs Drizzle migrations against `POSTGRES_URL` before the HTTP listener opens. The Dockerfile's entrypoint is two lines:

```sh
node scripts/migrate-prod.mjs
exec node dist/server.js
```

`scripts/migrate-prod.mjs` opens a `pg.Pool` with `max: 1`, builds a Drizzle client, and calls Drizzle's `migrate()` against `dist/db/migrations/`. Migration failure exits the container with a non-zero status; under `restart: unless-stopped` (Compose) or a Kubernetes Deployment, it crashloops with a visible error in the logs.

Migration files live in `packages/server/src/db/migrations/` and are baked into the image under `dist/db/migrations/`. They are SQL, applied in lexical order. The Drizzle migrator tracks applied migrations in `drizzle.__drizzle_migrations` in the target database — re-runs are safe.

If you ever need to run migrations out-of-band (a one-shot Job, or against an external Postgres you've just provisioned), exec the script:

```bash
docker run --rm \
  -e POSTGRES_URL=postgres://… \
  ghcr.io/azrtydxb/kryton/kryton:<tag> \
  node scripts/migrate-prod.mjs
```

## `/api/version`

The server exposes a public endpoint at `GET /api/version`:

```json
{
  "version": "4.6.5-pre.5",
  "commit": "abc1234",
  "major": 4
}
```

Defined in `packages/server/src/modules/platform/routes/version.routes.ts`; backed by `packages/server/src/lib/version.ts`, which reads `package.json` at boot and falls back to `/COMMIT_SHA` (written into the image at build time) when `git rev-parse` is unavailable.

This is the canonical post-upgrade check — if `/api/version` returns the new tag and `commit` matches the image you deployed, the new build is live.

## Health checks

The Helm chart's templates wire two probes:

- `livenessProbe: GET /healthz` — basic alive, doesn't touch the DB.
- `readinessProbe: GET /readyz` — alive + DB reachable.

Upgrade tooling should wait on `/readyz` (and `/api/version`) before declaring a rollout healthy.

## Docker Compose upgrades

```bash
docker compose pull
docker compose up -d
```

The new image's entrypoint runs migrations before serving. If the dump format of the new release is incompatible with the previous one (rare; documented per release), `docker compose up -d` is still correct — the migration runner brings the schema forward.

To pin a specific release, edit the compose file's `image:` line:

```yaml
kryton:
  image: ghcr.io/azrtydxb/kryton/kryton:v4.6.4
```

Then `docker compose up -d`.

## Helm upgrades

The chart's `appVersion` tracks the server release on every published version. Bumping the chart bumps `image.tag` automatically unless you override:

```bash
helm upgrade kryton oci://ghcr.io/azrtydxb/charts/kryton --version <new>
```

To pin the image tag independently of the chart version:

```bash
helm upgrade kryton oci://ghcr.io/azrtydxb/charts/kryton \
  --version <chart-ver> \
  --set image.tag=v4.6.4
```

### Ordering across the chart

The chart's only state-bearing resources are:

- The `Deployment` (re-rolled on every upgrade).
- The chart-managed PVC (preserved across upgrades; `helm uninstall` does **not** delete PVCs).
- The optional bitnami/postgresql subchart's PVC (same caveat).

The Deployment's `strategy.type` is `Recreate` (default). On `helm upgrade`:

1. Helm patches the Deployment with the new image.
2. The old pod is terminated.
3. A new pod starts, runs the migrator, then serves.

There is no manual ordering you need to enforce — migrations run during pod start. The brief downtime window (old pod terminating before new pod is ready) is the cost of `Recreate`. To eliminate it, configure RWX storage and switch `strategy.type` to `RollingUpdate`; otherwise leave it alone.

If you're upgrading the bitnami/postgresql subchart at the same time (because `Chart.yaml`'s dependency moved), do that as a deliberate step — a subchart major bump can change StatefulSet labels and trigger Postgres rotation. The chart's `Chart.yaml` pins the subchart version explicitly (currently `16.4.5`), so upgrades only happen when you bump the parent chart version that bumped it.

## Operator upgrades

Two surfaces to think about: the operator image, and the per-CR `spec.version`.

### Operator image

The CRDs ship as a separate `kryton-crds.yaml` asset on each GitHub Release.

```bash
# If the release notes call out CRD changes:
kubectl apply -f https://github.com/azrtydxb/kryton/releases/download/<new-tag>/kryton-crds.yaml

# Then bump the operator Deployment:
cd operator
make deploy IMG=ghcr.io/azrtydxb/kryton/kryton-operator:<new-tag>
```

**Order**: CRDs first if the schema changed (otherwise `kubectl apply` against the operator's CR types may reject fields), then the operator Deployment. The operator's reconciler is forwards-compatible within a CRD's stored version (`v1alpha1` at the time of writing).

### Per-CR `spec.version`

Bumping a single instance:

```bash
kubectl patch kryton kryton-prod --type merge \
  -p '{"spec":{"version":"4.6.4"}}'
```

The helm-side reconciler runs an upgrade against the embedded chart with `image.tag: <spec.version>` injected. The Deployment re-rolls, the new pod runs migrations, then serves. `status.observedVersion` reflects the new value once the reconcile completes.

The operator's helm reconciler uses `helm.sh/helm/v3/pkg/action` directly (not helm-operator-plugins). Failed installs/upgrades surface as conditions on `status.conditions`.

## Rollback caveats

**Schema migrations are forward-only.** Drizzle's migrator does not generate or apply down-migrations. If a release ships a destructive migration (column drop, type change), rolling the image back will not restore the dropped data. The release notes call this out explicitly when it happens.

For Compose:

```bash
docker compose pull   # if you've already pulled the new tag
# Edit compose file to pin previous tag, then:
docker compose up -d
```

The previous image will start, find migrations newer than itself in `drizzle.__drizzle_migrations`, and **may** boot anyway — the Drizzle migrator does not verify that the application code understands every applied migration. The honest rollback path for a breaking release is restore-from-backup (see [Backups & restore](/advanced/deployment/backups-restore/)), not image downgrade.

For Helm:

```bash
helm rollback kryton <previous-revision>
```

Same caveat — the older chart's image will run against the migrated schema. Safe for additive migrations; unsafe for destructive ones.

For the operator: patch `spec.version` back to the previous value. Same caveat again.

## Pre-upgrade checklist

1. Take a backup (`pg_dump` + notes tarball — see [Backups & restore](/advanced/deployment/backups-restore/)).
2. Read the [CHANGELOG](https://github.com/azrtydxb/kryton/blob/master/CHANGELOG.md) for the target release; look for the word "breaking" and any migration notes.
3. Confirm the current version: `curl -s https://<host>/api/version`.
4. Pin to a tag (don't track `:latest` for production upgrades).
5. Apply the upgrade.
6. Re-check `/api/version` and `/readyz`.

## See also

- [Docker Compose](/advanced/deployment/docker-compose/)
- [Helm chart](/advanced/deployment/helm/)
- [Operator](/advanced/deployment/operator/)
- [Backups & restore](/advanced/deployment/backups-restore/)
