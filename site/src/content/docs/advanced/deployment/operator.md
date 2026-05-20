---
title: Kubernetes Operator
description: Manage Kryton instances as Kubernetes custom resources — CRD schema, example CRs, backups, snapshots, and plugin pre-install.
---

`kryton-operator` is a Kubernetes operator that manages `Kryton` custom resources by installing/upgrading the [kryton Helm chart](/advanced/deployment/helm/) on each reconcile, then layering three operator-only resources on top:

- A Postgres backup `CronJob` (`pg_dump` → S3-compatible object store with retention sweep).
- A plugin-installer init-container that downloads and SHA-256-verifies user-declared plugin archives into the persistence volume before the server boots.
- A `VolumeSnapshot` scheduler `CronJob`.

The helm-side install/upgrade uses `helm.sh/helm/v3/pkg/action` directly. The operator-only resources are reconciled by a controller-runtime reconciler in `operator/internal/controller/`.

- **Operator image**: `ghcr.io/azrtydxb/kryton/kryton-operator`
- **CRD bundle**: `kryton-crds.yaml`, attached to every GitHub Release.

## CRD

| Field | Value |
|---|---|
| `apiVersion` | `kryton.azrtydxb.io/v1alpha1` |
| `kind` | `Kryton` |
| Scope | Namespaced |
| Group / domain | `kryton.azrtydxb.io` |

Defined in `operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml`.

### Spec schema

Parsed straight from the CRD's OpenAPI v3 schema.

| Path | Type | Required | Description |
|---|---|---|---|
| `spec.version` | string | yes | appVersion of the kryton server image to deploy. |
| `spec.values` | object (passthrough) | no | Values forwarded verbatim to the embedded helm chart. Schema is the chart's `values.yaml`. |
| `spec.backup` | object | no | Postgres backup CronJob configuration. |
| `spec.backup.schedule` | string (cron) | yes (within `backup`) | Cron expression (UTC) for `pg_dump`. |
| `spec.backup.retention` | string | no | Retention duration (e.g. `30d`). Older objects in the target bucket are swept. |
| `spec.backup.objectStore` | object | no | S3-compatible target. |
| `spec.backup.objectStore.bucket` | string | yes (within `objectStore`) | Bucket name. |
| `spec.backup.objectStore.endpoint` | string | yes (within `objectStore`) | Full URL of the S3-compatible service (e.g. `https://minio.kw.local`). |
| `spec.backup.objectStore.region` | string | no | Optional. Some services ignore it; `mc` still wants the field. |
| `spec.backup.objectStore.prefix` | string | no | Key prefix inside the bucket. Defaults to `<cr-name>/`. |
| `spec.backup.objectStore.credentialsSecretRef.name` | string | yes (within `credentialsSecretRef`) | Name of a Secret with keys `OBJECT_STORE_ACCESS_KEY` and `OBJECT_STORE_SECRET_KEY`. |
| `spec.plugins[]` | array of objects | no | Plugins to pre-install via an init-container. |
| `spec.plugins[].name` | string | yes | Plugin file name on disk. |
| `spec.plugins[].url` | string | yes | URL to fetch the plugin archive from. |
| `spec.plugins[].sha256` | string (regex `^[a-fA-F0-9]{64}$`) | yes | Hex-encoded SHA-256 digest of the archive. |
| `spec.snapshot` | object | no | VolumeSnapshot schedule for the persistence PVC. |
| `spec.snapshot.schedule` | string (cron) | yes (within `snapshot`) | |
| `spec.snapshot.retention` | string | no | Retention window (e.g. `7d`). |
| `spec.snapshot.volumeSnapshotClassName` | string | no | CSI snapshot class name. |

### Status

The status subresource is enabled; the operator writes:

| Path | Type | Description |
|---|---|---|
| `status.helmRevision` | integer | Helm revision applied by the last reconcile. |
| `status.observedVersion` | string | Last appVersion successfully reconciled. |
| `status.conditions[]` | array | Standard `{type, status, reason, message, lastTransitionTime}` conditions. |

Additional unknown fields are preserved (`x-kubernetes-preserve-unknown-fields: true`).

## Install

### CRDs

Every GitHub Release attaches a `kryton-crds.yaml` asset bundling `operator/config/crd/bases/*.yaml`:

```bash
kubectl apply -f https://github.com/azrtydxb/kryton/releases/download/<tag>/kryton-crds.yaml
```

### Operator

The operator is built with operator-sdk's helm plugin; the install workflow uses the kustomize tree under `operator/config/`. From a checkout:

```bash
cd operator
make install   # CRDs
make deploy IMG=ghcr.io/azrtydxb/kryton/kryton-operator:<tag>
```

`make deploy` runs `kustomize build config/default | kubectl apply -f -` (see `operator/Makefile`). The operator pod, ServiceAccount, RBAC, and CRD are all applied from the same kustomize tree.

To uninstall:

```bash
make undeploy
make uninstall
```

## Example CRs

The operator ships four samples under `operator/config/samples/`.

### Minimal

`kryton_v1alpha1_kryton_minimal.yaml`:

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: kryton-minimal
spec:
  version: "4.5.0"
```

Boots the helm chart with all chart defaults. Bundled Postgres, ReadWriteOnce PVC, no Ingress.

> Note on the secret: the helm chart requires `env.secret.BETTER_AUTH_SECRET`
> to be set or the server crashloops. Either provide it via
> `spec.values.env.secret.BETTER_AUTH_SECRET`, or — recommended — create a
> chart `existingSecret` ahead of time and reference it.

### Backup-enabled

`kryton_v1alpha1_kryton.yaml`:

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: kryton-sample
spec:
  version: "4.5.0"
  values:
    ingress:
      enabled: false
    postgresql:
      enabled: true
  backup:
    schedule: "0 3 * * *"
    retention: "30d"
    objectStore:
      bucket: kryton-backups
      endpoint: https://minio.kw.local
      prefix: kryton-sample/
      credentialsSecretRef:
        name: kryton-backup-creds
  plugins: []
  snapshot:
    schedule: "0 4 * * *"
    retention: "7d"
```

The `kryton-backup-creds` Secret must contain:

```bash
kubectl create secret generic kryton-backup-creds \
  --from-literal=OBJECT_STORE_ACCESS_KEY=<access> \
  --from-literal=OBJECT_STORE_SECRET_KEY=<secret>
```

### Plugins

`kryton_v1alpha1_kryton_with_plugins.yaml`:

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: kryton-with-plugins
spec:
  version: "4.5.0"
  values:
    persistence:
      enabled: true
      size: 10Gi
  plugins:
    - name: example-plugin
      url: https://example.com/plugins/example-1.2.3.tar.gz
      sha256: "0000000000000000000000000000000000000000000000000000000000000000"
```

The sample uses an all-zeros SHA-256 — replace with the real digest of your plugin archive.

### Multi-instance

`kryton_v1alpha1_kryton_multi.yaml` puts two independent Kryton CRs in one namespace. The operator passes `fullnameOverride: <metadata.name>` to helm so releases never collide on Service or PVC names.

## How each operator-only feature works

### Backup

(`operator/internal/controller/backup.go`)

The reconciler renders a `CronJob` named `<cr-name>-backup` running the `postgres:16` image. The script:

1. Installs `mc` (MinIO client) into the pod at runtime if not already present (curl-fetched from `dl.min.io`).
2. Configures an `mc alias` for the configured endpoint using `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY` from the credentials Secret.
3. Runs `pg_dump --format=custom --no-owner --no-acl` against the bundled Postgres, using `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` from the chart's `<cr-name>-postgresql` Secret.
4. Uploads the dump under `<prefix><database>-<timestamp>.dump`.
5. Sweeps the prefix with `mc rm --recursive --force --older-than $RETENTION`.

CronJob settings: `concurrencyPolicy: Forbid`, `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3`, `backoffLimit: 2`, `restartPolicy: OnFailure`.

The image is plain `postgres:16` — there is no separate backup image to build.

If `spec.backup` is cleared on the CR, the controller deletes the CronJob.

### Plugins

(`operator/internal/controller/plugins.go` + `kryton_extras_controller.go`)

For each `spec.plugins[]` entry the reconciler:

1. Fetches the Deployment named `<cr-name>` (the chart's `fullnameOverride` convention).
2. Patches its pod template to add an init-container `plugin-installer`, image `curlimages/curl:8.10.1`.
3. The init-container's script `curl -fsSL --retry 3` each `url`, verifies via `sha256sum -c`, and writes to `/plugins/<name>`.
4. The init-container is patched onto the Deployment in place; the reconciler replaces any prior `plugin-installer` to stay idempotent.

The init-container mounts a volume named `plugins` at `/plugins`. **You must wire a `plugins` volume into the chart values** for the init-container's mount to resolve — the operator does not synthesise this volume on the chart for you.

If `spec.plugins` is empty, the reconciler does nothing. (It does not currently clean up a previously-injected init-container when the field is cleared — track that on your end if you toggle plugins off.)

### Snapshot

(`operator/internal/controller/snapshot.go`)

The reconciler renders `<cr-name>-snapshot`, a `CronJob` running `bitnami/kubectl:1.31` under a ServiceAccount `<cr-name>-snapshot`. The script `kubectl apply`s a `snapshot.storage.k8s.io/v1` `VolumeSnapshot` against the chart's PVC (which the operator assumes is named `<cr-name>` — matches the chart's default naming), then sweeps older `VolumeSnapshot` objects past retention.

Requirements:

- A CSI driver with snapshot support installed cluster-wide.
- A `VolumeSnapshotClass` already present, named by `spec.snapshot.volumeSnapshotClassName`.
- A ServiceAccount + RBAC `<cr-name>-snapshot` granting create/delete on `volumesnapshots`. **The operator does not currently create this ServiceAccount or its Role/RoleBinding for you** — provision it before enabling snapshots.

If `spec.snapshot` is cleared, the controller deletes the CronJob.

### Values passthrough and naming

The helm-side reconciler injects two values on every install/upgrade:

- `fullnameOverride: <cr-name>` — so multi-tenant deploys don't collide.
- `postgresql.fullnameOverride: …` — so the bundled subchart picks the same prefix.
- `image.tag: <spec.version>` — pins the server image.

Everything under `spec.values` is merged on top.

## Operational reference

| RBAC verbs the operator uses (from `kryton_extras_controller.go`) |
|---|
| `kryton.azrtydxb.io/krytons`: get/list/watch + status:get/update/patch |
| `batch/cronjobs`, `batch/jobs`: full CRUD |
| `core/secrets`, `core/configmaps`, `core/persistentvolumeclaims`: get/list/watch/create/update/patch |
| `apps/deployments`: get/list/watch/update/patch |
| `snapshot.storage.k8s.io/volumesnapshots,volumesnapshotclasses`: full CRUD |

| Garbage collection |
|---|
| Child CronJobs are owned by the parent CR (controller reference). `kubectl delete kryton <name>` deletes them. The Helm release's resources are not owned by the CR — the helm-side reconciler is responsible for them. |

## See also

- [Helm chart values reference](/advanced/deployment/helm/) — all keys you can put under `spec.values`.
- [Backups & restore](/advanced/deployment/backups-restore/) — restore drill for the operator's pg_dump artefacts.
- [Upgrades & migrations](/advanced/deployment/upgrades-and-migrations/) — bumping `spec.version`.
