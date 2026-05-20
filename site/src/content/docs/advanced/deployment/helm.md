---
title: Helm chart
description: Install Kryton on Kubernetes via the OCI Helm chart — full values reference, ingress, ExternalSecrets, and Postgres options.
---

Kryton ships a Helm chart that installs the server Deployment, a ClusterIP Service, an optional Ingress, a chart-managed PVC, and (by default) an in-cluster Postgres subchart pinned to `pgvector/pgvector:pg16` so semantic search works out of the box.

- **Chart OCI ref**: `oci://ghcr.io/azrtydxb/charts/kryton`
- **Source**: `charts/kryton/` at the repo root.
- **Chart version / appVersion**: tracks the latest server release. The release workflow packages and pushes the chart on every `v*` tag.
- **Server image**: `ghcr.io/azrtydxb/kryton/kryton` (the chart sets the tag to `Chart.appVersion` unless `image.tag` is overridden).
- **kubeVersion**: `>=1.25.0-0` (declared in `Chart.yaml`).

## Install

```bash
helm install kryton oci://ghcr.io/azrtydxb/charts/kryton \
  --version <chart-version> \
  --set env.secret.BETTER_AUTH_SECRET=$(openssl rand -base64 32)
```

Or from a local checkout:

```bash
helm dependency update charts/kryton
helm install kryton charts/kryton \
  --set env.secret.BETTER_AUTH_SECRET=$(openssl rand -base64 32)
```

After install:

```bash
helm test kryton
kubectl port-forward svc/kryton 3001:3001
```

Then open `http://127.0.0.1:3001`.

## Subchart dependency

`Chart.yaml` declares a single dependency:

```yaml
- name: postgresql
  version: "16.4.5"
  repository: https://charts.bitnami.com/bitnami
  condition: postgresql.enabled
```

The subchart's image is overridden to `pgvector/pgvector:pg16`. Because that image isn't the bitnami hardened one, the chart sets `postgresql.global.security.allowInsecureImages: true` and disables `containerSecurityContext.readOnlyRootFilesystem` so the pgvector image's PID/socket lock can write under `/var/run/postgresql`. An `initdb` script enables the `vector` extension idempotently on first boot.

## POSTGRES_URL handling

When `postgresql.enabled=true` and `env.secret.POSTGRES_URL` is empty, the Deployment template (`templates/deployment.yaml`) auto-synthesises the connection string from the bitnami subchart's secret:

```text
postgres://<auth.username>:$(POSTGRES_PASSWORD)@<release>-postgresql:5432/<auth.database>
```

`POSTGRES_PASSWORD` is read from the subchart's secret via `secretKeyRef`. Setting `env.secret.POSTGRES_URL` explicitly disables the synthesis — use that path for external Postgres.

To use an external Postgres, set `postgresql.enabled=false` and provide `env.secret.POSTGRES_URL`. The external database **must** have the `pgvector` extension; the server's vector-typed migrations fail with `type "vector" does not exist` otherwise.

## Probes

The Deployment uses:

- Liveness: HTTP GET `/healthz` (basic alive — doesn't touch the DB).
- Readiness: HTTP GET `/readyz` (alive + DB reachable).

This split keeps a transient DB outage from killing the pod via liveness while still gating Service traffic.

## Update strategy

`strategy.type` defaults to `Recreate` because the persistence PVC is `ReadWriteOnce`. Rolling updates would deadlock waiting for the old pod to release the volume. Switch to `RollingUpdate` only if you've configured RWX storage and run multi-replica.

## ExternalSecrets

Set `externalSecrets.enabled=true` to emit an `ExternalSecret` resource instead of a plain `Secret`. Each value under `env.secret` is then interpreted as the remote key name in the upstream secret store. Requires [external-secrets-operator](https://external-secrets.io/) installed in the cluster.

## Values reference

Every top-level key in `values.yaml` with its default.

### Workload

| Key | Default | Description |
|---|---|---|
| `replicaCount` | `1` | Number of kryton server replicas. |
| `strategy.type` | `Recreate` | Deployment update strategy. |
| `strategy.rollingUpdate` | `{}` | Rolling-update parameters (only used when `strategy.type: RollingUpdate`). |
| `image.repository` | `ghcr.io/azrtydxb/kryton/kryton` | Container image repository. |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy. |
| `image.tag` | `""` | Override `Chart.appVersion`. Empty tracks appVersion. |
| `imagePullSecrets` | `[]` | Image pull secrets (private registries). |
| `nameOverride` | `""` | Override the chart name fragment in object names. |
| `fullnameOverride` | `""` | Fully override the release fullname. |
| `resources` | `{}` | Container resource requests/limits. |
| `nodeSelector` | `{}` | Node selector for the pod. |
| `tolerations` | `[]` | Tolerations. |
| `affinity` | `{}` | Affinity rules. |
| `podAnnotations` | `{}` | Annotations on the pod. |
| `podLabels` | `{}` | Labels on the pod. |

### Security context

| Key | Default | Description |
|---|---|---|
| `podSecurityContext.runAsNonRoot` | `true` | Pod runs as a non-root user. |
| `podSecurityContext.fsGroup` | `1000` | Group ID for volume ownership. |
| `podSecurityContext.seccompProfile.type` | `RuntimeDefault` | Seccomp profile. |
| `securityContext.allowPrivilegeEscalation` | `false` | Forbid privilege escalation. |
| `securityContext.readOnlyRootFilesystem` | `false` | Root FS is writable (server needs scratch). |
| `securityContext.runAsNonRoot` | `true` | Container runs as non-root. |
| `securityContext.runAsUser` | `1000` | UID inside the container. |
| `securityContext.capabilities.drop` | `[ALL]` | Drop all Linux capabilities. |

### ServiceAccount

| Key | Default | Description |
|---|---|---|
| `serviceAccount.create` | `true` | Whether to create a ServiceAccount. |
| `serviceAccount.annotations` | `{}` | Annotations on the ServiceAccount. |
| `serviceAccount.name` | `""` | Name of the ServiceAccount; auto-generated when empty. |

### Service & Ingress

| Key | Default | Description |
|---|---|---|
| `service.type` | `ClusterIP` | Kubernetes Service type. |
| `service.port` | `3001` | Service port exposed on the ClusterIP. |
| `service.targetPort` | `3001` | Container port (matches `env.config.PORT`). |
| `service.annotations` | `{}` | Annotations on the Service. |
| `ingress.enabled` | `false` | Emit an Ingress resource. |
| `ingress.className` | `""` | IngressClassName. |
| `ingress.annotations` | `{}` | Ingress annotations. |
| `ingress.hosts` | `[{host: kryton.local, paths: [{path: /, pathType: Prefix}]}]` | Host rules. |
| `ingress.tls` | `[]` | TLS Secret references. |

### Probes

| Key | Default | Description |
|---|---|---|
| `livenessProbe.httpGet.path` | `/healthz` | Liveness probe path. |
| `livenessProbe.httpGet.port` | `http` | Port name. |
| `livenessProbe.initialDelaySeconds` | `30` | |
| `livenessProbe.periodSeconds` | `10` | |
| `livenessProbe.timeoutSeconds` | `5` | |
| `livenessProbe.failureThreshold` | `3` | |
| `readinessProbe.httpGet.path` | `/readyz` | Readiness probe path. |
| `readinessProbe.httpGet.port` | `http` | Port name. |
| `readinessProbe.initialDelaySeconds` | `5` | |
| `readinessProbe.periodSeconds` | `5` | |
| `readinessProbe.timeoutSeconds` | `3` | |
| `readinessProbe.failureThreshold` | `3` | |

### Autoscaling

| Key | Default | Description |
|---|---|---|
| `autoscaling.enabled` | `false` | Emit a HorizontalPodAutoscaler. |
| `autoscaling.minReplicas` | `1` | |
| `autoscaling.maxReplicas` | `5` | |
| `autoscaling.targetCPUUtilizationPercentage` | `80` | |

### Persistence

| Key | Default | Description |
|---|---|---|
| `persistence.enabled` | `true` | Provision a chart-managed PVC. |
| `persistence.storageClass` | `""` | StorageClass; empty uses the cluster default. |
| `persistence.accessModes` | `[ReadWriteOnce]` | PVC access modes. |
| `persistence.size` | `10Gi` | PVC size. |
| `persistence.existingClaim` | `""` | Use an existing PVC instead of provisioning. |
| `persistence.mountPath` | `/data/notes` | Mount path (matches `env.config.NOTES_DIR`). |
| `persistence.subPath` | `""` | Optional sub-path inside the volume. |
| `persistence.annotations` | `{}` | Annotations on the PVC. |

### Observability

| Key | Default | Description |
|---|---|---|
| `serviceMonitor.enabled` | `false` | Emit a Prometheus Operator ServiceMonitor. |
| `serviceMonitor.labels` | `{}` | Additional labels (some operators require a selector match). |
| `serviceMonitor.interval` | `30s` | Scrape interval. |
| `serviceMonitor.path` | `/metrics` | Scrape path. |
| `serviceMonitor.scrapeTimeout` | `10s` | Scrape timeout. |

### ExternalSecrets

| Key | Default | Description |
|---|---|---|
| `externalSecrets.enabled` | `false` | Emit an ExternalSecret instead of a Secret. |
| `externalSecrets.secretStoreName` | `""` | Name of the (Cluster)SecretStore. |
| `externalSecrets.secretStoreKind` | `ClusterSecretStore` | Kind of secret-store reference. |
| `externalSecrets.refreshInterval` | `1h` | ExternalSecret refresh interval. |
| `externalSecrets.remoteKeyPrefix` | `""` | Prefix prepended to each remote key. |

### Application environment — `env.config` (ConfigMap)

| Key | Default | Description |
|---|---|---|
| `env.config.NODE_ENV` | `"production"` | Runtime environment. |
| `env.config.LOG_LEVEL` | `"info"` | Pino log level. |
| `env.config.PORT` | `"3001"` | TCP port the server listens on. |
| `env.config.HOST` | `"0.0.0.0"` | Interface the server binds to. |
| `env.config.BETTER_AUTH_URL` | `"http://localhost:3001"` | Public URL for Better-Auth. |
| `env.config.APP_URL` | `"http://localhost:5173"` | Public URL of the client app. |
| `env.config.CORS_ORIGINS` | `"http://localhost:5173"` | Comma-separated CORS allow-list. |
| `env.config.RATE_LIMIT_MAX` | `"1000"` | Max requests per rate-limit window. |
| `env.config.RATE_LIMIT_WINDOW` | `"1 minute"` | Rate-limit window. |
| `env.config.NOTES_DIR` | `"/data/notes"` | Filesystem path for notes. |
| `env.config.WEBAUTHN_RP_ID` | `"localhost"` | WebAuthn Relying Party ID. Set to the public hostname for production. |
| `env.config.OPENAPI_ENABLED` | `"true"` | Enable `/docs` OpenAPI UI. |
| `env.config.SEMANTIC_PROVIDER` | `"pgvector-local"` | Embedder backend. `"off"` disables semantic search. |
| `env.config.SEMANTIC_MODEL` | `"Xenova/all-MiniLM-L6-v2"` | HF model id for the local embedder. |
| `env.config.SEMANTIC_DIMENSIONS` | `"384"` | Embedding vector dimensions. |
| `env.config.SEMANTIC_CHUNK_TOKENS` | `"256"` | Tokens per chunk. |
| `env.config.SEMANTIC_CHUNK_OVERLAP` | `"32"` | Token overlap between chunks. |

### Application environment — `env.secret` (Secret / ExternalSecret)

When `externalSecrets.enabled=false` (default), values are plain strings. When enabled, each value is the remote key name in the upstream store.

| Key | Default | Description |
|---|---|---|
| `env.secret.BETTER_AUTH_SECRET` | `""` | Better-Auth signing secret. **Required.** Must be ≥32 chars. |
| `env.secret.POSTGRES_URL` | `""` | Postgres connection string. Auto-synthesised when empty and `postgresql.enabled=true`. |
| `env.secret.GOOGLE_CLIENT_ID` | `""` | Google OAuth client ID. |
| `env.secret.GOOGLE_CLIENT_SECRET` | `""` | Google OAuth client secret. |
| `env.secret.GITHUB_CLIENT_ID` | `""` | GitHub OAuth client ID. |
| `env.secret.GITHUB_CLIENT_SECRET` | `""` | GitHub OAuth client secret. |
| `env.secret.SMTP_HOST` | `""` | SMTP host. |
| `env.secret.SMTP_PORT` | `""` | SMTP port. |
| `env.secret.SMTP_SECURE` | `""` | TLS toggle (`"true"` / `"false"`). |
| `env.secret.SMTP_USER` | `""` | SMTP username. |
| `env.secret.SMTP_PASS` | `""` | SMTP password. |
| `env.secret.SMTP_FROM` | `""` | Default From: address. |

### Postgres subchart

Only the keys the chart explicitly sets are listed. All other [bitnami/postgresql](https://artifacthub.io/packages/helm/bitnami/postgresql) values pass through.

| Key | Default | Description |
|---|---|---|
| `postgresql.enabled` | `true` | Install the bundled Postgres. Set `false` for external Postgres. |
| `postgresql.global.security.allowInsecureImages` | `true` | Required when overriding the subchart image to non-bitnami. |
| `postgresql.image.repository` | `pgvector/pgvector` | Image override. |
| `postgresql.image.tag` | `pg16` | Tag override. |
| `postgresql.auth.username` | `kryton` | Postgres user. |
| `postgresql.auth.database` | `kryton` | Database name. |
| `postgresql.auth.password` | `""` | If empty, auto-generated by the subchart. |
| `postgresql.auth.postgresPassword` | `""` | Superuser password (auto-generated when empty). |
| `postgresql.auth.existingSecret` | `""` | Use an existing K8s secret for credentials. |
| `postgresql.primary.persistence.enabled` | `true` | Persistent PVC for Postgres data. |
| `postgresql.primary.persistence.size` | `10Gi` | Postgres PVC size. |
| `postgresql.primary.resources` | `{}` | Postgres pod resources. |
| `postgresql.primary.containerSecurityContext.readOnlyRootFilesystem` | `false` | Disabled because pgvector image writes under `/var/run/postgresql`. |
| `postgresql.primary.initdb.scripts.00-pgvector.sql` | `CREATE EXTENSION IF NOT EXISTS vector;` | Enable pgvector on first DB init. |

## Production values example

```yaml
replicaCount: 2

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: kryton.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: kryton-tls
      hosts:
        - kryton.example.com

persistence:
  storageClass: rook-ceph-block
  size: 50Gi

postgresql:
  auth:
    existingSecret: kryton-postgres-auth
  primary:
    persistence:
      size: 100Gi
    resources:
      requests:
        cpu: 500m
        memory: 1Gi

env:
  config:
    APP_URL: "https://kryton.example.com"
    BETTER_AUTH_URL: "https://kryton.example.com"
    CORS_ORIGINS: "https://kryton.example.com"
    WEBAUTHN_RP_ID: "kryton.example.com"
  secret:
    BETTER_AUTH_SECRET: ""  # set via --set or external-secrets
```

> `replicaCount: 2` with the default `Recreate` strategy still works, but rolling
> updates require RWX storage. Either set `persistence.enabled=false` (no
> chart-managed PVC) or wire `persistence.existingClaim` to a RWX volume and
> switch `strategy.type` to `RollingUpdate`.

## See also

- [Kryton operator](/advanced/deployment/operator/) — multi-tenant install of this chart with backup, snapshot and plugin pre-install.
- [Upgrades & migrations](/advanced/deployment/upgrades-and-migrations/) — chart upgrade ordering and the `/api/version` shape.
- [Backups & restore](/advanced/deployment/backups-restore/) — backup paths under Helm and Operator.
