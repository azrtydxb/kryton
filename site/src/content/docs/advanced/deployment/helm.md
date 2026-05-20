---
title: Helm chart
description: Install Kryton on Kubernetes via the official OCI Helm chart — full values reference, ingress, ExternalSecrets, and Postgres options.
---

Kryton ships an official Helm chart for Kubernetes deployments, distributed as an OCI artifact on GitHub Container Registry.

- **Chart**: `oci://ghcr.io/azrtydxb/charts/kryton`
- **Source**: [`charts/kryton/`](https://github.com/azrtydxb/kryton/tree/master/charts/kryton)
- **App image**: `ghcr.io/azrtydxb/kryton/kryton`

The chart bundles an optional [pgvector](https://github.com/pgvector/pgvector)-enabled Postgres subchart (Bitnami `postgresql`) for first-run UX, and supports external Postgres for production.

## Install

### From OCI registry (recommended)

```bash
helm install kryton oci://ghcr.io/azrtydxb/charts/kryton \
  --version 4.6.0 \
  --namespace kryton --create-namespace \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=kryton.example.com
```

Pin `--version` to a known chart version. Versions track the app's `package.json` version 1:1.

### From a local checkout

```bash
git clone https://github.com/azrtydxb/kryton.git
cd kryton
helm dependency update charts/kryton
helm install kryton charts/kryton --namespace kryton --create-namespace
```

### Verify

```bash
kubectl -n kryton get pods
kubectl -n kryton port-forward svc/kryton 3001:80
curl -fsS http://localhost:3001/health
```

The first user to register through the UI becomes admin.

## Values reference

The full values reference, regenerated from `values.yaml` by `helm-docs`, is on GitHub. Every top-level key with its default:

| Key | Default | Description |
|---|---|---|
| `replicaCount` | `1` | Number of kryton server replicas. The server is stateless aside from the PVC — HPA-friendly when persistence is RWX or externalised. |
| `strategy.type` | `Recreate` | Deployment update strategy. RWO PVCs deadlock under `RollingUpdate`; only switch with RWX. |
| `image.repository` | `ghcr.io/azrtydxb/kryton/kryton` | Container image repository for the kryton server. |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy. |
| `image.tag` | `""` | Overrides `Chart.appVersion`. Leave empty to track appVersion. |
| `imagePullSecrets` | `[]` | Pull secrets for private registries. |
| `serviceAccount.create` | `true` | Create a dedicated ServiceAccount for the kryton pod. |
| `podSecurityContext` | runAsNonRoot, fsGroup=1000, RuntimeDefault seccomp | Pod-level security defaults. |
| `securityContext` | drop ALL caps, no privesc, runAsUser=1000 | Container-level security defaults. |
| `service.type` | `ClusterIP` | Kubernetes Service type. |
| `service.port` | `3001` | Service port exposed on the ClusterIP. |
| `service.targetPort` | `3001` | Container port the kryton server listens on. |
| `ingress.enabled` | `false` | Enable Ingress for the kryton service. |
| `ingress.className` | `""` | IngressClassName (e.g. `nginx`, `traefik`). |
| `ingress.annotations` | `{}` | Annotations applied to the Ingress. |
| `ingress.hosts[]` | `kryton.local` / `/` | Hostname + path matchers. |
| `ingress.tls[]` | `[]` | TLS configuration; list hosts and the cluster Secret name. |
| `resources` | `{}` | Pod resource requests / limits. |
| `livenessProbe` | `/healthz`, 30 s delay | Liveness probe; basic alive check. |
| `readinessProbe` | `/readyz`, 5 s delay | Readiness probe; alive + DB check. |
| `autoscaling.enabled` | `false` | HorizontalPodAutoscaler for the Deployment. |
| `autoscaling.minReplicas` | `1` | Min replicas when HPA is on. |
| `autoscaling.maxReplicas` | `5` | Max replicas when HPA is on. |
| `autoscaling.targetCPUUtilizationPercentage` | `80` | Scale-out trigger. |
| `nodeSelector` / `tolerations` / `affinity` | `{}` / `[]` / `{}` | Standard pod scheduling. |
| `persistence.enabled` | `true` | Chart-managed PVC for notes / plugin data / attachments. |
| `persistence.storageClass` | `""` | StorageClass; empty = cluster default. |
| `persistence.accessModes` | `[ReadWriteOnce]` | Access modes for the PVC. |
| `persistence.size` | `10Gi` | PVC size. |
| `persistence.existingClaim` | `""` | Bring-your-own PVC name. |
| `persistence.mountPath` | `/data/notes` | Mount path inside the container; matches `env.NOTES_DIR`. |
| `serviceMonitor.enabled` | `false` | Emit a Prometheus Operator ServiceMonitor. |
| `serviceMonitor.interval` | `30s` | Scrape interval. |
| `serviceMonitor.path` | `/metrics` | Scrape path. |
| `externalSecrets.enabled` | `false` | Emit an ExternalSecret instead of a plain Secret. |
| `externalSecrets.secretStoreName` | `""` | ClusterSecretStore name. |
| `externalSecrets.secretStoreKind` | `ClusterSecretStore` | Kind of the secret store reference. |
| `externalSecrets.refreshInterval` | `1h` | Refresh interval for the ExternalSecret. |
| `env.config.*` | sensible defaults | Non-secret env vars — flow into a ConfigMap consumed via `envFrom`. |
| `env.secret.*` | `""` | Secret env vars — flow into a Secret OR an ExternalSecret. |
| `postgresql.enabled` | `true` | Enable the bundled Bitnami Postgres subchart (pgvector image). |
| `postgresql.image.repository` | `pgvector/pgvector` | Image override (the bitnami pre-baked image lacks pgvector). |
| `postgresql.image.tag` | `pg16` | Postgres 16 with pgvector. |
| `postgresql.auth.username` | `kryton` | DB username. |
| `postgresql.auth.database` | `kryton` | DB name. |
| `postgresql.primary.persistence.size` | `10Gi` | Postgres PVC size. |
| `postgresql.primary.containerSecurityContext.readOnlyRootFilesystem` | `false` | Pgvector image writes lock files under `/var/run/postgresql`. |
| `postgresql.primary.initdb.scripts."00-pgvector.sql"` | `CREATE EXTENSION IF NOT EXISTS vector;` | Idempotent pgvector enable on first init. |

Field names under `env` are derived from the server's Zod config schema (`packages/server/config-schema.json`). The CI drift gate (`deployment-sync-check`) ensures every required server env var has a values key.

## Upgrade

```bash
helm upgrade kryton oci://ghcr.io/azrtydxb/charts/kryton \
  --version 4.7.0 \
  --namespace kryton \
  --reuse-values
```

Behaviour:

- Chart `version` and `appVersion` bump together. Upgrading the chart upgrades the app image.
- Database migrations run automatically at server startup (Drizzle Kit). No manual migration step.
- The Deployment uses a rolling update strategy under RWX; under RWO it falls back to `Recreate` (the default).
- If a chart upgrade introduces a new required env var, the sync-check would have blocked the merge that added it.

### Pinning the app image independently

The chart's `appVersion` is the default image tag, but you can override it:

```yaml
image:
  repository: ghcr.io/azrtydxb/kryton/kryton
  tag: 4.6.1
```

Escape-hatch territory — prefer matching chart and app versions.

## Postgres options

### Embedded (default)

```yaml
postgresql:
  enabled: true
  image:
    repository: pgvector/pgvector
    tag: pg16
  auth:
    username: kryton
    database: kryton
  primary:
    persistence:
      enabled: true
      size: 20Gi
```

Suitable for evaluation and small single-instance deployments. The Bitnami chart manages its own PVC, Service, and Secret.

### External

```yaml
postgresql:
  enabled: false

env:
  config:
    # POSTGRES_URL comes from the secret block below.
  secret:
    POSTGRES_URL: ""   # sourced from an out-of-band Secret

externalSecrets:
  enabled: true
  secretStoreName: cluster-secret-store
  secretStoreKind: ClusterSecretStore
  data:
    - secretKey: POSTGRES_URL
      remoteRef:
        key: kryton/prod
        property: postgres_url
```

The target database must have `CREATE EXTENSION IF NOT EXISTS vector;` run once.

## Ingress examples

### nginx-ingress + cert-manager

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: 50m       # attachment uploads
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600" # Yjs WebSocket
  hosts:
    - host: kryton.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: kryton-tls
      hosts: [kryton.example.com]
```

### Traefik

```yaml
ingress:
  enabled: true
  className: traefik
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
  hosts:
    - host: kryton.example.com
      paths:
        - path: /
          pathType: Prefix
```

The Yjs collaborative-editing endpoint (`/ws/yjs/:docId`) is a WebSocket — make sure your ingress controller allows long-lived upgrades. Most do by default.

## ExternalSecrets

Assumes [external-secrets-operator](https://external-secrets.io/) is installed with a `ClusterSecretStore` named `cluster-secret-store`.

```yaml
externalSecrets:
  enabled: true
  refreshInterval: 1h
  secretStoreName: cluster-secret-store
  secretStoreKind: ClusterSecretStore
  data:
    - secretKey: BETTER_AUTH_SECRET
      remoteRef:
        key: kryton/prod
        property: auth_secret
    - secretKey: POSTGRES_URL
      remoteRef:
        key: kryton/prod
        property: postgres_url
    - secretKey: GOOGLE_CLIENT_SECRET
      remoteRef:
        key: kryton/prod
        property: google_oauth_secret
    - secretKey: SMTP_PASS
      remoteRef:
        key: kryton/prod
        property: smtp_pass
```

When `externalSecrets.enabled=true`, the chart **skips** rendering the plain `Secret` — the operator-pulled secret is the source of truth.

## Troubleshooting

### Pod stuck in `CrashLoopBackOff`

```bash
kubectl -n kryton logs deploy/kryton --previous
```

| Symptom | Fix |
|---|---|
| `extension "vector" does not exist` | Postgres lacks pgvector. Use the bundled subchart, or run `CREATE EXTENSION vector;` on your external DB. |
| `Invalid env: BETTER_AUTH_SECRET must be at least 32 chars` | `openssl rand -hex 32`, update Secret/ExternalSecret. |
| `ECONNREFUSED ... 5432` | `POSTGRES_URL` host/port wrong, or Postgres not ready. Check `kubectl get pods`. |
| `EACCES` writing to notes dir | PVC fsGroup mismatch. Set `podSecurityContext.fsGroup: 1000`. |

### Probe failures

```bash
kubectl -n kryton exec deploy/kryton -- wget -qO- http://localhost:3001/healthz
```

If that works but the kubelet's probe doesn't, your `service.port` and `containerPort` disagree.

### Uninstall

```bash
helm uninstall kryton -n kryton
kubectl -n kryton delete pvc --all   # only if you want to delete data
```

PVCs survive `helm uninstall` by design.

## See also

- [Operator](/kryton/advanced/deployment/operator/) — multi-instance with managed backups built on top of this chart.
- [Backups and restore](/kryton/advanced/deployment/backups-restore/)
- [Upgrades and migrations](/kryton/advanced/deployment/upgrades-and-migrations/)
