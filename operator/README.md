# kryton-operator

Kubernetes operator for Kryton. Manages `Kryton` custom resources by installing
and upgrading the [kryton helm chart](../charts/kryton) on each reconcile, then
layering operator-only resources on top:

- Postgres **backup** CronJob (`pg_dump` → S3-compatible object store with retention sweep).
- **Plugin** init-container that downloads and sha256-verifies user-declared
  plugin archives into the kryton persistence volume before the server boots.
- VolumeSnapshot **scheduler** CronJob.

The operator is built with **operator-sdk's helm plugin** for the Deployment/
Service/Ingress/etc. surface — there is no second copy of those manifests in
this repo. Operator-only logic lives in `internal/controller/` as a regular
controller-runtime reconciler.

## Layout

```
operator/
├── cmd/manager/             # Go entrypoint (combines helm + extras reconcilers)
├── config/                  # operator-sdk kustomize manifests (CRD, RBAC, deployment, samples)
│   ├── crd/bases/           # CRD with explicit operator-only fields
│   ├── rbac/
│   └── samples/             # example Kryton CRs (minimal / backup / plugins / multi-instance)
├── helm-charts/kryton/      # operator-sdk helm scaffold input (mirrors WS-B's chart)
├── internal/
│   ├── chartfs/             # //go:embed wrapper for the chart
│   │   └── chart/           # populated at build time by `make sync-chart`
│   ├── chart-placeholder/   # fallback chart used until WS-B's chart lands
│   ├── helm/                # helm-operator-plugins reconciler wiring
│   └── controller/          # operator-only reconcilers (backup/plugins/snapshot)
├── Dockerfile               # multi-stage Go build, distroless runtime
└── Makefile                 # operator-sdk Makefile + `sync-chart`, `test`
```

## Integration with WS-B

The chart lives at `charts/kryton/` at the repo root. The operator embeds it
via `//go:embed all:chart` in `internal/chartfs/chartfs.go`. The Makefile
target `make sync-chart` copies `../charts/kryton/` into
`internal/chartfs/chart/` before `go build` runs; the Dockerfile invokes the
same copy via `RUN`. If `../charts/kryton/` is not present yet (current state
of this worktree), `sync-chart` falls back to the minimal placeholder at
`internal/chart-placeholder/kryton/` so the operator still builds and the
embed mechanic is verified end-to-end.

**Once WS-B lands in master**, no operator code change is required: the next
`make sync-chart && make docker-build` picks up the real chart automatically.

## CRD shape

`spec` keys:

| Key | Type | Description |
|---|---|---|
| `version` | string (required) | appVersion of the kryton server image. |
| `values` | object (passthrough) | Forwarded verbatim to the helm chart's values. |
| `backup.schedule` | cron string | `pg_dump` cron expression (UTC). |
| `backup.retention` | duration | Retention window for backup objects. |
| `backup.objectStore` | object | S3-compatible target: bucket, endpoint, region, prefix, credentialsSecretRef. Works with MinIO, Garage, SeaweedFS, etc. |
| `plugins[]` | list of `{name,url,sha256}` | Plugins to pre-install. |
| `snapshot.schedule` | cron string | VolumeSnapshot cron. |
| `snapshot.retention` | duration | VolumeSnapshot retention. |
| `snapshot.volumeSnapshotClassName` | string | CSI snapshot class. |

See `config/crd/bases/kryton.azrtydxb.io_krytons.yaml` for the full OpenAPI
schema, and `config/samples/` for working examples:

- `kryton_v1alpha1_kryton_minimal.yaml` — smallest possible CR.
- `kryton_v1alpha1_kryton.yaml` — backup configured.
- `kryton_v1alpha1_kryton_with_plugins.yaml` — plugin pre-install.
- `kryton_v1alpha1_kryton_multi.yaml` — two CRs side-by-side in one namespace.

## Build & deploy

```bash
# Unit tests (no cluster needed).
make test

# Build the image. Synchronises the chart from ../charts/kryton/ first.
make docker-build IMG=ghcr.io/azrtydxb/kryton/kryton-operator:dev

# Install the CRD.
make install

# Deploy the operator + RBAC.
make deploy IMG=ghcr.io/azrtydxb/kryton/kryton-operator:dev

# Apply a sample CR.
kubectl apply -f config/samples/kryton_v1alpha1_kryton_minimal.yaml
```

## Operational notes

- **Multi-instance**: each `Kryton` CR's helm release is name-scoped via
  `fullnameOverride: <metadata.name>` (injected by the helm reconciler), so
  multiple instances in the same namespace never collide on Service or PVC
  names.
- **Backups** require an object-store credentials Secret (referenced by
  `backup.objectStore.credentialsSecretRef`) containing
  `OBJECT_STORE_ACCESS_KEY` and `OBJECT_STORE_SECRET_KEY` keys, plus a
  postgres-credentials Secret with `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`.
  The chart's postgres subchart emits the latter under `<release>-postgresql`
  by default. The backup CronJob runs in a plain `postgres:16` image and
  installs `mc` (MinIO client) at runtime — no AWS dependency, no separate
  backup image to maintain.
- **Plugins** are dropped into the persistence volume's `/plugins` directory.
  The server's existing plugin loader picks them up at boot — no server
  changes required.
- **Snapshots** require a CSI driver with snapshot support and a
  `VolumeSnapshotClass` already present in the cluster.

## Status

| Task | State |
|---|---|
| C1 init scaffold | done |
| C2 create-api + helm chart binding | done |
| C3 go:embed wrapper | done (skeleton, real helm-SDK wiring TODO once WS-B chart lands) |
| C4 CRD operator-only fields | done |
| C5 operator-only reconcilers | done (resource generators + tests; controller wiring stub) |
| C6 RBAC | done |
| C7 Dockerfile | done |
| C8 CRD bundle commit | done |
| C9 unit tests | done |
| C10 README | done |

Outstanding follow-up (post-merge with WS-B):

1. Replace `internal/helm/reconciler.go` stub with the real
   `helm-operator-plugins` reconciler wiring (loader.LoadFS + GVK + value
   mapper for `fullnameOverride`).
2. Replace controller-stub `SetupWithManager` with the full
   `For(&v1alpha1.Kryton{}).Owns(...)` chain once the v1alpha1 Go types are
   generated.
3. envtest-based integration coverage for `KrytonExtrasReconciler` end-to-end.
