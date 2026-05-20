---
title: Kubernetes Operator
description: Manage Kryton instances as Kubernetes custom resources — CRD schema, example CRs, backups, snapshots, and plugin pre-install.
---

The Kryton Operator manages Kryton instances as Kubernetes custom resources. It embeds the official Helm chart and adds lifecycle features the chart cannot express on its own:

- **Backup / restore** — scheduled `pg_dump` to S3-compatible object storage (MinIO, Garage, SeaweedFS, etc.) with retention sweeping.
- **Plugin install** — pre-install plugins by URL with SHA-256 verification before the server pod starts.
- **Volume snapshots** — scheduled `VolumeSnapshot` resources against the data PVC.
- **Multi-instance** — multiple isolated Kryton instances on one cluster, declaratively.

- **CRD**: `kryton.azrtydxb.io/v1alpha1`, kind `Kryton`
- **Operator image**: `ghcr.io/azrtydxb/kryton/kryton-operator`
- **Source**: [`operator/`](https://github.com/azrtydxb/kryton/tree/master/operator)

The operator is helm-based: every reconcile invokes `helm upgrade --install` against the embedded chart. Anything the chart can do, the operator can do via `spec.values` passthrough.

## Install

### 1. Install the CRD bundle

```bash
kubectl apply -f https://github.com/azrtydxb/kryton/releases/download/v4.6.0/kryton-crds.yaml
```

Or from a local checkout:

```bash
kubectl apply -f operator/config/crd/bases/
```

### 2. Deploy the operator

```bash
kubectl create namespace kryton-system
kubectl apply -n kryton-system \
  -f https://github.com/azrtydxb/kryton/releases/download/v4.6.0/kryton-operator.yaml
```

The bundle includes the operator Deployment, ServiceAccount, ClusterRole, ClusterRoleBinding, and a default `Kryton`-watching configuration scoped to all namespaces. To restrict to a single namespace, set `WATCH_NAMESPACE` on the operator Deployment.

Verify:

```bash
kubectl -n kryton-system get pods
kubectl -n kryton-system logs deploy/kryton-operator
```

## CRD schema

`kryton.azrtydxb.io/v1alpha1`, kind `Kryton`, namespace-scoped. The full schema:

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: my-kryton
  namespace: kryton
spec:
  version: "4.6.0"           # required — appVersion (image tag) to deploy
  values: {}                 # passthrough to the embedded chart's values.yaml
  backup:                    # optional
    schedule: "0 3 * * *"    # required when backup is set
    retention: "30d"
    objectStore:
      endpoint: https://minio.kw.local   # required
      bucket: kryton-backups             # required
      region: us-east-1                  # optional; mc still wants the field set
      prefix: prod/                      # optional; defaults to "<cr-name>/"
      credentialsSecretRef:
        name: kryton-backup-creds        # Secret with OBJECT_STORE_ACCESS_KEY + _SECRET_KEY
  plugins:                   # optional
    - name: pomodoro
      url: https://example.com/pomodoro.tar.gz
      sha256: 7a3e9c2b1d8f4a5e6c7b8d9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b
  snapshot:                  # optional
    schedule: "0 4 * * *"
    retention: "14d"
    volumeSnapshotClassName: csi-snapclass
status:
  helmRevision: 0
  observedVersion: ""
  conditions: []
```

`spec.values` is a strict superset of the chart's `values.yaml` schema (enforced by the `deployment-sync-check` CI gate). Anything you put in `values.yaml` for `helm install` goes under `spec.values` here.

## Example CRs

These ship under `operator/config/samples/`:

- `kryton_v1alpha1_kryton_minimal.yaml`
- `kryton_v1alpha1_kryton.yaml`
- `kryton_v1alpha1_kryton_with_plugins.yaml`
- `kryton_v1alpha1_kryton_multi.yaml`

### Minimal

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: kryton
  namespace: kryton
spec:
  version: "4.6.0"
  values:
    ingress:
      enabled: true
      className: nginx
      hosts:
        - host: kryton.example.com
          paths: [{ path: /, pathType: Prefix }]
```

Embedded Postgres (pgvector subchart) is enabled by default.

### With scheduled backups

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: kryton
  namespace: kryton
spec:
  version: "4.6.0"
  values:
    ingress:
      enabled: true
      hosts:
        - host: kryton.example.com
          paths: [{ path: /, pathType: Prefix }]
  backup:
    schedule: "0 3 * * *"            # 03:00 UTC daily
    retention: "30d"
    objectStore:
      endpoint: https://minio.kw.local
      bucket: kryton-backups
      prefix: prod/
      credentialsSecretRef:
        name: kryton-backup-creds    # keys: OBJECT_STORE_ACCESS_KEY, OBJECT_STORE_SECRET_KEY
```

The operator emits a `CronJob` that runs `pg_dump` against the embedded (or external) Postgres and uploads the dump to the configured object store using `mc` (MinIO client — works with any S3-compatible service). A sweep step deletes objects older than `retention`. No Velero, no AWS dependency, no separate backup image — the CronJob runs `postgres:16` and installs `mc` at runtime.

### With pre-installed plugins

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: kryton
  namespace: kryton
spec:
  version: "4.6.0"
  plugins:
    - name: pomodoro
      url: https://github.com/azrtydxb/kryton-plugins/releases/download/v1.4.0/pomodoro.tar.gz
      sha256: 7a3e9c2b1d8f4a5e6c7b8d9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b
    - name: kanban
      url: https://github.com/azrtydxb/kryton-plugins/releases/download/v2.1.0/kanban.tar.gz
      sha256: 1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c
```

The operator patches the kryton Deployment with an init-container that downloads each plugin URL, verifies the SHA-256 digest, and extracts into the persistence volume's plugin directory before the main server starts. A digest mismatch fails the init-container and the kryton pod fails to start (intentional — the server never runs untrusted plugin code).

### Multi-instance

```yaml
---
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: team-alpha
  namespace: kryton
spec:
  version: "4.6.0"
  values:
    fullnameOverride: team-alpha
    postgresql:
      fullnameOverride: team-alpha-postgres
    ingress:
      enabled: true
      hosts:
        - host: alpha.kryton.example.com
          paths: [{ path: /, pathType: Prefix }]
---
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: team-beta
  namespace: kryton
spec:
  version: "4.6.0"
  values:
    fullnameOverride: team-beta
    postgresql:
      fullnameOverride: team-beta-postgres
    ingress:
      enabled: true
      hosts:
        - host: beta.kryton.example.com
          paths: [{ path: /, pathType: Prefix }]
```

The operator passes the CR's `metadata.name` through `fullnameOverride` so each release's resources are name-scoped. PVCs, Services, Secrets, and Postgres releases are isolated per CR. Two CRs can run different `spec.version` values side-by-side — useful for canary upgrades.

## Backup and restore

### How backups work

When `spec.backup` is set, the operator reconciles a `CronJob` named `<cr-name>-backup` in the CR's namespace. Each run:

1. Resolves the Postgres DSN from the same source the server uses (embedded subchart Secret, or external Secret reference).
2. Runs `pg_dump --format=custom --no-owner --no-acl` into a file.
3. Uploads to `<bucket>/<prefix><database>-<timestamp>.dump` using `mc`.
4. Sweeps objects under the prefix older than `retention` (`mc rm --recursive --older-than <retention>`).

Object-store credentials come from `spec.backup.objectStore.credentialsSecretRef`. The Secret must contain `OBJECT_STORE_ACCESS_KEY` and `OBJECT_STORE_SECRET_KEY`. Endpoint URL is always explicit (`spec.backup.objectStore.endpoint`) — point it at MinIO, Garage, SeaweedFS, or any other S3-compatible service.

### Inspect backup history

```bash
kubectl -n kryton get cronjob,jobs -l app.kubernetes.io/component=backup
kubectl -n kryton logs job/<backup-job-name>
```

### Restore from a backup

Restoration is intentionally **not** automated by the operator — it's destructive and you should be present to verify.

```bash
# 1. Scale the kryton Deployment to 0 so nothing writes during restore.
kubectl -n kryton scale deploy/<cr-name> --replicas=0

# 2. Download the dump.
mc alias set store https://minio.kw.local "$ACCESS_KEY" "$SECRET_KEY"
mc cp store/kryton-backups/prod/<cr-name>-2026-05-15T03-00-00.dump ./restore.dump

# 3. pg_restore against the target Postgres.
kubectl -n kryton exec -it sts/<cr-name>-postgresql -- \
  bash -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore --clean --if-exists \
    -U kryton -d kryton' < restore.dump

# 4. Scale kryton back up.
kubectl -n kryton scale deploy/<cr-name> --replicas=1

# 5. Verify.
kubectl -n kryton port-forward svc/<cr-name> 3001:80
curl -fsS http://localhost:3001/healthz
```

For external Postgres, run `pg_restore` from any host that can reach the database.

### Snapshots

```yaml
spec:
  snapshot:
    schedule: "0 4 * * *"
    retention: "14d"
    volumeSnapshotClassName: csi-snapclass
```

The operator emits a `VolumeSnapshot` against the kryton PVC on the schedule and sweeps older snapshots. Useful as a fast complement to `pg_dump`: snapshots cover the notes / attachments / plugins volume; `pg_dump` covers the database.

## Plugin install flow

```
       CR.spec.plugins[]
              │
              ▼
   ┌─────────────────────────┐
   │ Operator patches the    │
   │ kryton Deployment       │
   │ podSpec.initContainers  │
   └──────────┬──────────────┘
              │
              ▼
   ┌─────────────────────────┐  shared
   │ init: download-plugins  ├─ persistence volume mount
   │ - curl <url>            │   /data/plugins/
   │ - sha256 check          │
   │ - tar -xzf into mount   │
   └──────────┬──────────────┘
              │
              ▼
   ┌─────────────────────────┐
   │ kryton server starts.   │
   │ Plugin loader scans     │
   │ /data/plugins/ at boot. │
   └─────────────────────────┘
```

Notes:

- The server's plugin API is unchanged. From the server's perspective, the plugins were already on disk at startup.
- SHA-256 verification is **mandatory**. There's no skip flag — by design.
- A failing digest fails the init-container, which fails the pod. The CR's `status.conditions[Ready]=False` with a clear reason.
- Plugins installed via the CRD persist in the persistence volume. Removing an entry from `spec.plugins` does **not** delete the on-disk plugin; it just stops re-fetching it. To remove, exec into the pod and delete the plugin dir, or recreate the PVC.

## Upgrade procedure

Operator upgrades and Kryton instance upgrades are decoupled.

### Upgrade the operator

```bash
kubectl apply -n kryton-system \
  -f https://github.com/azrtydxb/kryton/releases/download/v4.7.0/kryton-operator.yaml
kubectl apply -f https://github.com/azrtydxb/kryton/releases/download/v4.7.0/kryton-crds.yaml
```

Always apply the new CRDs **before** the new operator Deployment. CRDs are backward-compatible within `v1alpha1` (additive fields only); breaking changes will move to `v1beta1`.

### Upgrade a Kryton instance

```bash
kubectl -n kryton patch kryton my-kryton --type=merge \
  -p '{"spec":{"version":"4.7.0"}}'
```

The operator runs `helm upgrade` against the new embedded chart version. Database migrations run automatically at server startup. Roll one CR at a time in multi-instance setups.

## Troubleshooting

### CR stuck in `Reconciling`

```bash
kubectl -n kryton describe kryton <name>
kubectl -n kryton-system logs deploy/kryton-operator --tail=200
```

Most reconcile failures surface as `status.conditions[Ready].message`.

### `helm release "<name>" failed`

| Helm error | Fix |
|---|---|
| `cannot patch ... field is immutable` | Delete the resource and let the operator recreate, or roll back: `kubectl patch kryton <name> --type=merge -p '{"spec":{"version":"<prev>"}}'`. |
| `timed out waiting for the condition` | Pod isn't going ready. `kubectl describe pod` for the probe failure. |
| `release ... has no deployed releases` | Previous reconcile left the release in `failed`. `helm rollback <name>` or delete and re-apply the CR. |

### Plugin init-container fails

```bash
kubectl -n kryton logs pod/<kryton-pod> -c download-plugins
```

`sha256 mismatch` → the URL or digest is wrong. Update the CR.

### Backup CronJob never runs

```bash
kubectl -n kryton get cronjob
kubectl -n kryton get jobs -l app.kubernetes.io/component=backup
```

Trigger manually:

```bash
kubectl -n kryton create job --from=cronjob/<cr-name>-backup test-backup-1
kubectl -n kryton logs job/test-backup-1
```

## See also

- [Helm chart](/kryton/advanced/deployment/helm/) — the embedded chart, for direct helm install without the operator.
- [Backups and restore](/kryton/advanced/deployment/backups-restore/)
- [Upgrades and migrations](/kryton/advanced/deployment/upgrades-and-migrations/)
