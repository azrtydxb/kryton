---
title: Backups and restore
description: Back up and restore Kryton — Docker Compose (pg_dump + notes tarball) and Kubernetes (operator's pg_dump CronJob and PVC snapshots).
---

Kryton's state lives in two places: Postgres (notes content, vector embeddings, users, sessions, attachments metadata) and the notes directory on disk (note files). A working backup covers both at consistent points in time.

## Docker Compose

### Postgres dump

Run from the directory containing your compose file. The bundled Postgres image is reachable as the `postgres` service:

```bash
docker compose exec -T postgres \
  pg_dump -U kryton --format=custom kryton > kryton-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Notes:

- `--format=custom` is `pg_restore`-compatible and compresses by default.
- The `-T` flag (`docker compose exec -T`) disables TTY allocation so the redirect captures only the dump.
- Add `--no-owner --no-acl` if you intend to restore into a different role.

### Notes directory

The notes bind mount is `./notes` on the host. Tar it alongside the dump:

```bash
tar czf notes-$(date -u +%Y%m%dT%H%M%SZ).tar.gz notes/
```

### Consistency between the two

The notes filesystem and the Postgres state are not transactionally linked, but both are append-mostly. Taking the `pg_dump` first, then the `tar`, gives you a database that may reference a notes file that isn't in the archive — usually harmless on restore (the server treats missing files as not-yet-synced). Taking the `tar` first is also safe.

For stronger consistency, stop the kryton service briefly:

```bash
docker compose stop kryton
docker compose exec -T postgres pg_dump -U kryton --format=custom kryton > kryton.dump
tar czf notes.tar.gz notes/
docker compose start kryton
```

### Restoring Docker Compose

Start with an empty target stack — the database must not exist yet. From a clean directory:

1. Place `docker-compose.prod.yml` and your `.env`.
2. Start **Postgres only**:

   ```bash
   docker compose up -d postgres
   ```

3. Drop and recreate the database (`pg_restore` does not overwrite by default):

   ```bash
   docker compose exec -T postgres dropdb -U kryton --if-exists kryton
   docker compose exec -T postgres createdb -U kryton kryton
   docker compose exec -T postgres psql -U kryton -d kryton -c 'CREATE EXTENSION IF NOT EXISTS vector;'
   ```

4. Load the dump:

   ```bash
   docker compose exec -T postgres pg_restore -U kryton -d kryton --no-owner --no-acl < kryton.dump
   ```

5. Unpack the notes archive into the host directory the compose file mounts:

   ```bash
   tar xzf notes.tar.gz   # writes ./notes/…
   ```

6. Start kryton:

   ```bash
   docker compose up -d kryton
   ```

   The entrypoint runs `migrate-prod.mjs` again — pending migrations against the restored schema are applied automatically.

> **Restore order matters**: `vector` extension before `pg_restore` (the dump
> references vector-typed columns), then restore, then start the server so
> migrations run cleanly against the restored schema. The bundled
> `pgvector/pgvector:pg16` image ships the extension binaries; the `CREATE
> EXTENSION` step turns it on.

## Helm

The chart does not provide a `backup.*` block in `values.yaml` — there is no Helm-level backup primitive. Three options:

1. **Run the operator** (next section) — managed CronJob + S3-compatible target.
2. **Roll your own CronJob** — a `batch/v1` CronJob in the same namespace that execs into the Postgres pod and uploads the dump somewhere durable. The operator's `internal/controller/backup.go` is a working reference implementation you can copy.
3. **Volume snapshots** — if the Postgres PVC's StorageClass supports CSI snapshots, schedule `VolumeSnapshot` objects against `<release>-postgresql`. For the notes PVC do the same against the chart's PVC (`<release>` by default).

The chart's `livenessProbe` is `/healthz` and `readinessProbe` is `/readyz` — your backup tooling can read these to gate before/after windows.

## Operator (`Kryton` CR)

The operator ships two relevant primitives: `spec.backup` (pg_dump → S3-compatible) and `spec.snapshot` (CSI VolumeSnapshot of the persistence PVC).

### `spec.backup`

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: kryton-prod
spec:
  version: "4.5.0"
  backup:
    schedule: "0 3 * * *"      # 03:00 UTC daily
    retention: "30d"            # mc --older-than syntax: 30d, 12h, …
    objectStore:
      bucket: kryton-backups
      endpoint: https://minio.example.com
      region: ""                # optional; mc still reads the field
      prefix: kryton-prod/       # defaults to <cr-name>/
      credentialsSecretRef:
        name: kryton-backup-creds
```

Prerequisites:

- `kryton-backup-creds` Secret with `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY` keys.
- The chart's bundled Postgres (or an external one whose credentials are in a Secret named `<cr-name>-postgresql` with keys `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`).
- An S3-compatible bucket; the endpoint URL is explicit, so MinIO / Garage / SeaweedFS all work.

What the operator emits (`operator/internal/controller/backup.go`):

- A CronJob `<cr-name>-backup`, image `postgres:16`, with `concurrencyPolicy: Forbid`, `backoffLimit: 2`.
- The Job script installs `mc` at runtime (curl-fetched from `dl.min.io`), runs `pg_dump --format=custom --no-owner --no-acl`, uploads to `<bucket>/<prefix><database>-<timestamp>.dump`, and sweeps `mc rm --recursive --force --older-than $RETENTION`.

### `spec.snapshot`

```yaml
spec:
  snapshot:
    schedule: "0 4 * * *"
    retention: "7d"
    volumeSnapshotClassName: csi-hostpath-snapclass
```

Prerequisites:

- A CSI driver with snapshot support.
- The named `VolumeSnapshotClass`.
- A pre-existing ServiceAccount `<cr-name>-snapshot` with RBAC to create/delete `volumesnapshots` — **the operator does not provision this for you**.

What it emits: a CronJob `<cr-name>-snapshot`, image `bitnami/kubectl:1.31`, that `kubectl apply`s a `snapshot.storage.k8s.io/v1` `VolumeSnapshot` and sweeps older ones past retention.

### Restoring from an operator backup

The dumps are plain `pg_dump --format=custom` files in the bucket. The restore drill mirrors the Compose flow against the in-cluster Postgres pod:

```bash
# Download the dump to a workstation, then load via a one-shot pod:
kubectl run --rm -i --tty pg-restore --image=postgres:16 --restart=Never -- \
  bash -c 'apt-get update && apt-get -y install postgresql-client; \
           pg_restore -h <release>-postgresql -U kryton -d kryton --no-owner --no-acl < /tmp/kryton.dump'
```

Practical workflow: kubectl-copy the dump into a temporary pod with `mc` (or `aws s3 cp` if you stored to AWS), then `pg_restore` from inside that pod. Drop + recreate the database first (same `dropdb` / `createdb` / `CREATE EXTENSION vector` sequence as the Compose path).

For PVC restore from a `VolumeSnapshot`, create a new PVC with `dataSource: <snapshot>` and re-point the chart to that PVC via `persistence.existingClaim`.

## Testing a restore

Cheap drill that catches the usual breakage:

1. Take a dump + notes tarball.
2. Start a throwaway compose stack in a different directory with a different volume namespace (`docker compose -p kryton-restore up -d postgres`).
3. Restore into it.
4. `docker compose -p kryton-restore up -d kryton` — confirm `/api/version` answers and you can read a recent note.
5. `docker compose -p kryton-restore down -v` to clean up.

A restore that hasn't been exercised does not work.

## See also

- [Docker Compose](/advanced/deployment/docker-compose/)
- [Helm chart](/advanced/deployment/helm/)
- [Operator](/advanced/deployment/operator/)
- [Upgrades & migrations](/advanced/deployment/upgrades-and-migrations/)
