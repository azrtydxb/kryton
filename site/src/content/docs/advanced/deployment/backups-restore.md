---
title: Backups and restore
description: Back up and restore Kryton — Docker Compose (volume snapshot + pg_dump) and Helm/Operator (managed CronJob), with restore drills.
---

Kryton has two state stores:

1. **Postgres** — users, sessions, API keys, tags, share permissions, semantic-search embeddings, plugin metadata.
2. **The notes directory** — your markdown files, attachments, generated assets, installed plugin code.

A complete backup includes both. Restoring one without the other leaves you with broken references (notes the DB doesn't know about, or DB pointers to notes that vanished).

## Docker Compose

### Backup

```bash
# pg_dump of the database
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U kryton --format=custom kryton > "kryton-db-$(date +%F).dump"

# tar of the notes dir (the bind-mounted ./notes)
tar czf "kryton-notes-$(date +%F).tar.gz" notes/

# (Optional) named data volume — plugin data + attachments
docker run --rm -v kryton_kryton-data:/data -v "$(pwd)":/backup alpine \
  tar czf "/backup/kryton-data-$(date +%F).tar.gz" -C /data .
```

Combine the three into one tarball and ship them off-host (rsync, rclone, S3 — your choice). Verify each archive's checksum at write time:

```bash
sha256sum kryton-db-$(date +%F).dump \
          kryton-notes-$(date +%F).tar.gz \
          kryton-data-$(date +%F).tar.gz > checksums.txt
```

Re-verify on the destination — `sha256sum -c checksums.txt`.

### Cron-driven

```bash
cat > /etc/cron.daily/kryton-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /home/kryton/kryton
TS=$(date +%Y%m%d-%H%M%S)
DEST=/var/backups/kryton
mkdir -p "$DEST"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U kryton --format=custom kryton > "$DEST/db-$TS.dump"
tar czf "$DEST/notes-$TS.tar.gz" notes/
find "$DEST" -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/kryton-backup
```

### Restore

```bash
# 1. Stop the server (DB stays up).
docker compose -f docker-compose.prod.yml stop kryton

# 2. Restore the DB. --clean drops existing objects first.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U kryton -d kryton --clean --if-exists --no-owner --no-acl \
  < kryton-db-2026-05-15.dump

# 3. Restore notes.
rm -rf notes/
tar xzf kryton-notes-2026-05-15.tar.gz

# 4. Bring the server back up.
docker compose -f docker-compose.prod.yml start kryton

# 5. Verify.
curl -fsS http://localhost:3100/healthz
```

Always test the restore drill at least once against a scratch instance before you rely on it.

## Helm / Operator

The Helm chart itself does not provision a backup CronJob — you have two clean options:

### Option A — the Operator (recommended)

The Kryton Operator's `spec.backup` declares the schedule, retention, and S3-compatible target. The operator reconciles a `CronJob` that runs `pg_dump` and uploads to the bucket, sweeping objects older than the retention window. Full reference: [Operator backups](/kryton/advanced/deployment/operator/#backup-and-restore).

```yaml
spec:
  backup:
    schedule: "0 3 * * *"
    retention: "30d"
    objectStore:
      endpoint: https://minio.kw.local
      bucket: kryton-backups
      credentialsSecretRef:
        name: kryton-backup-creds
```

### Option B — chart-only with your own CronJob

Run a separate `CronJob` that mounts the same secret as kryton (for `POSTGRES_URL`), shells out `pg_dump --format=custom`, and `mc cp`s the result to S3:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: kryton-backup
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: dump
              image: postgres:16
              envFrom:
                - secretRef: { name: kryton }
              command:
                - sh
                - -c
                - |
                  set -e
                  apt-get update && apt-get install -y curl
                  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
                  chmod +x /usr/local/bin/mc
                  TS=$(date +%Y%m%dT%H%M%SZ)
                  pg_dump "$POSTGRES_URL" --format=custom --no-owner --no-acl \
                    > /tmp/kryton-$TS.dump
                  mc alias set s3 "$OBJECT_STORE_ENDPOINT" "$ACCESS_KEY" "$SECRET_KEY"
                  mc cp /tmp/kryton-$TS.dump s3/kryton-backups/
                  mc rm --recursive --force --older-than 30d s3/kryton-backups/
```

The notes / plugins PVC is covered by the operator's `spec.snapshot` (a `VolumeSnapshot`) or by your storage class's own backup mechanism (rook-ceph snapshots, OpenEBS backups, CSI snapshotter).

### Restore

```bash
# 1. Scale the kryton Deployment to 0.
kubectl -n kryton scale deploy/kryton --replicas=0

# 2. Pull the dump.
mc cp s3/kryton-backups/kryton-2026-05-15T03-00-00.dump ./

# 3. pg_restore into the in-cluster Postgres.
kubectl -n kryton exec -i sts/kryton-postgresql -- \
  bash -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore -U kryton -d kryton \
    --clean --if-exists --no-owner --no-acl' < kryton-2026-05-15T03-00-00.dump

# 4. (If you snapshot the PVC) restore the VolumeSnapshot per your CSI driver.

# 5. Scale back up.
kubectl -n kryton scale deploy/kryton --replicas=1

# 6. Verify.
kubectl -n kryton port-forward svc/kryton 3001:80 &
curl -fsS http://localhost:3001/healthz
```

## Verify

After every restore, sanity-check:

- A representative user can log in.
- The notes count matches your expectation (`GET /api/notes | jq 'length'`).
- A search query returns results (`GET /api/search?q=…`) — confirms the in-memory MiniSearch index rebuilt from disk and the pgvector embeddings survived.
- Tag and graph queries return results (`GET /api/tags`, `GET /api/graph`).

If any of these fail, the database and the notes directory are out of sync — restore both from the same backup window.

## See also

- [Operator backups](/kryton/advanced/deployment/operator/#backup-and-restore) — managed CronJobs.
- [Upgrades and migrations](/kryton/advanced/deployment/upgrades-and-migrations/) — when to back up before bumping versions.
