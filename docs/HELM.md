# Helm Chart

Kryton ships an official Helm chart for Kubernetes deployments. The chart is distributed as an OCI artifact on GitHub Container Registry.

- **Chart**: `oci://ghcr.io/azrtydxb/charts/kryton`
- **Source**: [`charts/kryton/`](../charts/kryton)
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

The canonical values reference is the chart's own [`charts/kryton/README.md`](../charts/kryton/README.md), regenerated from `values.yaml` by `helm-docs`. Top-level groups:

| Group | Purpose |
|---|---|
| `image` | Kryton server image repository / tag / pullPolicy / pullSecrets |
| `replicaCount` | Number of kryton pods (server is stateless aside from the PVC; HPA-friendly when persistence is shared via RWX or externalised) |
| `service` | ClusterIP service type and port |
| `ingress` | Optional Ingress: `enabled`, `className`, `annotations`, `tls`, `hosts[]` |
| `persistence` | Chart-managed PVC for notes/attachments/plugins: `enabled`, `storageClass`, `size`, `accessModes` |
| `postgresql` | Bitnami Postgres subchart; `enabled: true` by default, image overridden to `pgvector/pgvector:pg16` |
| `postgres.external` | When `postgresql.enabled=false`, set `external.url` to your DSN |
| `externalSecrets` | When `enabled: true`, the chart emits an `ExternalSecret` and skips the plain `Secret` |
| `serviceMonitor` | Optional Prometheus Operator `ServiceMonitor`, `enabled: false` by default |
| `resources` / `nodeSelector` / `tolerations` / `affinity` | Standard pod scheduling |
| `podSecurityContext` / `securityContext` | Pod and container security contexts |
| `env` | Server runtime config — non-secret values flow into the ConfigMap; secrets flow into the Secret or ExternalSecret |

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
- The Deployment uses a rolling update strategy; the new pod must pass `/health` before the old pod is terminated.
- If a chart upgrade introduces a new required env var, the sync-check would have blocked the merge that added it — but if you override `values.yaml` heavily, re-check the chart's `values.yaml` diff between versions.

### Pinning the app image independently

The chart's `appVersion` is the default image tag, but you can override it:

```yaml
image:
  repository: ghcr.io/azrtydxb/kryton/kryton
  tag: 4.6.1   # overrides Chart.yaml's appVersion
```

This is escape-hatch territory — prefer matching chart and app versions.

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
    # password auto-generated and stored in a Secret named <release>-postgresql
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
  POSTGRES_URL: ""   # leave empty; sourced from a Secret

externalSecrets:
  enabled: true
  store:
    name: cluster-secret-store
    kind: ClusterSecretStore
  data:
    - secretKey: POSTGRES_URL
      remoteRef:
        key: kryton/prod
        property: postgres_url
```

Or with a plain Secret you create out-of-band:

```yaml
postgresql:
  enabled: false

env:
  POSTGRES_URL: ""

# Reference an existing Secret named "kryton-db" with key POSTGRES_URL.
existingSecret: kryton-db
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
    nginx.ingress.kubernetes.io/proxy-body-size: 50m       # for attachment uploads
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600" # for Yjs WebSocket
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

## ExternalSecrets example

Assumes [external-secrets-operator](https://external-secrets.io/) is installed and a `ClusterSecretStore` named `cluster-secret-store` exists.

```yaml
externalSecrets:
  enabled: true
  refreshInterval: 1h
  store:
    name: cluster-secret-store
    kind: ClusterSecretStore
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

When `externalSecrets.enabled=true`, the chart **skips** rendering the plain `Secret` resource — the operator's pulled secret is the source of truth for the kryton pod's env.

## Troubleshooting

### Pod stuck in `CrashLoopBackOff`

```bash
kubectl -n kryton logs deploy/kryton --previous
```

Common causes:

| Symptom in logs | Fix |
|---|---|
| `relation "...", extension "vector" does not exist` | Postgres lacks pgvector. Use the bundled subchart, or run `CREATE EXTENSION vector;` on your external DB. |
| `Invalid env: BETTER_AUTH_SECRET must be at least 32 chars` | Regenerate: `openssl rand -hex 32`, update Secret/ExternalSecret. |
| `ECONNREFUSED ... 5432` | `POSTGRES_URL` host/port wrong, or Postgres pod not ready yet. Check `kubectl get pods` and `nslookup <release>-postgresql.<ns>.svc`. |
| `EACCES` writing to notes dir | PVC mounted but `securityContext.fsGroup` doesn't match the container user. Set `podSecurityContext.fsGroup: 1000` (kryton runs as uid/gid 1000). |

### Probe failures

The liveness/readiness probes hit `/health`. If they fail despite the app being up:

```bash
kubectl -n kryton exec deploy/kryton -- wget -qO- http://localhost:3001/health
```

If that works but the kubelet's probe doesn't, your `service.port` and `containerPort` likely disagree. Double-check `values.yaml`.

### Postgres password rotation

The Bitnami subchart's auto-generated password lives in `<release>-postgresql` Secret. Helm upgrades do **not** rotate it. If you need to rotate, see [Bitnami's password rotation docs](https://github.com/bitnami/charts/tree/main/bitnami/postgresql#upgrade) — you must update both the postgres Secret and the kryton Secret in lockstep.

### Chart rendering issues

```bash
helm template kryton charts/kryton --debug
helm lint charts/kryton
```

For schema validation:

```bash
helm install --dry-run --debug kryton charts/kryton -f values-prod.yaml
```

### Uninstall

```bash
helm uninstall kryton -n kryton
kubectl -n kryton delete pvc --all   # only if you want to delete data
```

PVCs are not garbage-collected by `helm uninstall` by design.

## See also

- [docs/OPERATOR.md](OPERATOR.md) — Kubernetes Operator built on top of this chart
- [charts/kryton/README.md](../charts/kryton/README.md) — generated values reference
- [Deployment Surfaces design](superpowers/specs/2026-05-16-deployment-surfaces-design.md)
