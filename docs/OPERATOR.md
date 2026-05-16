# Kryton Operator

The Kryton Operator manages Kryton instances as Kubernetes custom resources. It embeds the official Helm chart and adds lifecycle features the chart cannot express on its own:

- **Backup / restore** — scheduled `pg_dump` to S3-compatible object storage (MinIO, Garage, SeaweedFS, etc.) with retention.
- **Plugin install** — pre-install plugins by URL with sha256 verification before the server pod starts.
- **Volume snapshots** — scheduled `VolumeSnapshot` resources against the data PVC.
- **Multi-instance** — multiple isolated Kryton instances on one cluster, declaratively.

- **CRD**: `kryton.azrtydxb.io/v1alpha1`, kind `Kryton`
- **Operator image**: `ghcr.io/azrtydxb/kryton/kryton-operator`
- **Source**: [`operator/`](../operator)

The operator is helm-based: every reconcile invokes `helm upgrade --install` against the embedded chart. Anything the chart can do, the operator can do via `spec.values` passthrough.

## Install

### 1. Install the CRD bundle

CRDs are published as part of each release.

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

### 3. Apply a Kryton CR

See examples below.

## CRD overview

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: my-kryton
  namespace: kryton
spec:
  version: "4.6.0"           # appVersion (image tag) to deploy
  values: {}                 # passthrough to the embedded chart's values.yaml
  backup: {}                 # optional: scheduled pg_dump to S3-compatible storage
  plugins: []                # optional: plugins to pre-install
  snapshot: {}               # optional: scheduled VolumeSnapshot
status:
  helmRevision: 0
  observedVersion: ""
  conditions: []
```

`spec.values` is a strict superset of the chart's `values.yaml` schema (enforced by the `deployment-sync-check` CI gate). Anything you can put in `values.yaml` for `helm install`, you can put under `spec.values` here.

## Example CRs

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
    schedule: "0 3 * * *"             # 03:00 UTC daily
    retention: "30d"
    objectStore:
      endpoint: https://minio.kw.local  # any S3-compatible service
      bucket: kryton-backups
      prefix: prod/
      credentialsSecretRef:
        name: kryton-backup-creds       # keys: OBJECT_STORE_ACCESS_KEY, OBJECT_STORE_SECRET_KEY
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

The operator patches the kryton Deployment with an init-container that downloads each plugin URL, verifies the sha256 digest, and extracts into the persistence volume's plugin directory before the main server starts. If a digest mismatches, the init-container exits non-zero and the kryton pod fails to start (intentional — the server never runs untrusted plugin code).

### Multi-instance on a single cluster

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

The operator passes the CR's `metadata.name` through `fullnameOverride` so each release's resources are name-scoped. Storage PVCs, Services, Secrets, and Postgres releases are all isolated per CR. Two CRs can run different `spec.version` values side-by-side — useful for canary upgrades.

## Backup and restore

### How backups work

When `spec.backup` is set, the operator reconciles a `CronJob` named `<cr-name>-backup` in the CR's namespace. Each run:

1. Resolves the Postgres DSN from the same source the server uses (embedded subchart Secret, or external Secret reference).
2. Runs `pg_dump --format=custom --no-owner --no-acl` into a file.
3. Uploads to `<bucket>/<prefix><database>-<timestamp>.dump` using `mc` (MinIO client, installed at runtime in the `postgres:16` image).
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

# 2. Download the dump (mc works against any S3-compatible endpoint).
mc alias set store https://minio.kw.local "$ACCESS_KEY" "$SECRET_KEY"
mc cp store/kryton-backups/prod/<cr-name>-2026-05-15T03-00-00.dump ./restore.dump

# 3. Run pg_restore against the target Postgres.
kubectl -n kryton exec -it sts/<cr-name>-postgresql -- \
  bash -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_restore --clean --if-exists \
    -U kryton -d kryton' < restore.dump

# 4. Scale kryton back up.
kubectl -n kryton scale deploy/<cr-name> --replicas=1

# 5. Verify.
kubectl -n kryton port-forward svc/<cr-name> 3001:80
curl -fsS http://localhost:3001/health
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
   │ init: download-plugins  ├─ emptyDir / persistence vol mount
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
- sha256 verification is **mandatory**. There's no way to skip it via the CRD — by design.
- A failing digest fails the init-container, which fails the pod. The Deployment never goes ready; the CR's `status.conditions[Ready]=False` with a clear reason.
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

### Pinning the operator's chart vs. spec.version

The operator ships with one embedded chart version per release. `spec.version` controls the **image tag** but does not change the chart templates. If a future release changes the chart's templates incompatibly, you upgrade by bumping the operator (which carries the new embedded chart), not by changing `spec.version`.

## Troubleshooting

### CR stuck in `Reconciling`

```bash
kubectl -n kryton describe kryton <name>
kubectl -n kryton-system logs deploy/kryton-operator --tail=200
```

Most reconcile failures surface as `status.conditions[Ready].message` with the helm error.

### `helm release "<name>" failed`

The operator logs the underlying helm output. Common cases:

| Helm error | Fix |
|---|---|
| `cannot patch ... field is immutable` | A `Service` or `StatefulSet` field changed in a way helm can't roll. Delete the resource and let the operator recreate, or roll back: `kubectl patch kryton <name> --type=merge -p '{"spec":{"version":"<prev>"}}'`. |
| `timed out waiting for the condition` | Pod isn't going ready. `kubectl describe pod` to find the probe failure or scheduling issue. |
| `release ... has no deployed releases` | Previous reconcile left the release in `failed` state. `helm rollback <name>` or delete the CR and re-apply. |

### Plugin init-container fails

```bash
kubectl -n kryton logs pod/<kryton-pod> -c download-plugins
```

`sha256 mismatch` → the URL or digest in the CR is wrong (or the upstream artifact changed). Update the CR.

### Backup CronJob never runs

```bash
kubectl -n kryton get cronjob
kubectl -n kryton get jobs -l app.kubernetes.io/component=backup
```

If no `Job`s exist, the CronJob's schedule may not have triggered yet. To trigger manually:

```bash
kubectl -n kryton create job --from=cronjob/<cr-name>-backup test-backup-1
kubectl -n kryton logs job/test-backup-1
```

### Operator can't manage cluster resources

Check the operator's ClusterRoleBinding. It needs permissions on Deployments, Services, Ingresses, ConfigMaps, Secrets, PVCs, Jobs, CronJobs, VolumeSnapshots, and helm release ConfigMaps.

```bash
kubectl auth can-i create deployments \
  --as=system:serviceaccount:kryton-system:kryton-operator \
  -n kryton
```

## See also

- [docs/HELM.md](HELM.md) — the embedded chart, for direct helm install without the operator
- [Deployment Surfaces design](superpowers/specs/2026-05-16-deployment-surfaces-design.md)
- [Deployment Surfaces plan](superpowers/plans/2026-05-16-deployment-surfaces.md)
