# kryton helm chart

Production-grade Helm chart for [kryton](https://github.com/azrtydxb/kryton), the
self-hostable note-taking & knowledge server. Ships the kryton Deployment, a
ClusterIP Service, an optional Ingress, a chart-managed PVC for notes/plugin
data, and an optional [bitnami/postgresql](https://artifacthub.io/packages/helm/bitnami/postgresql)
subchart pinned to the `pgvector/pgvector:pg16` image so semantic search works
out of the box.

## TL;DR

```bash
# From OCI (recommended, once published):
helm install kryton oci://ghcr.io/azrtydxb/charts/kryton \
  --version 4.5.0 \
  --set env.secret.BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# Or from a local checkout:
helm dependency update charts/kryton
helm install kryton charts/kryton \
  --set env.secret.BETTER_AUTH_SECRET=$(openssl rand -base64 32)
```

Then:

```bash
helm test kryton
kubectl port-forward svc/kryton 3001:3001
open http://127.0.0.1:3001
```

## Values reference

### Image & workload

| Key | Default | Description |
|-----|---------|-------------|
| `replicaCount` | `1` | Number of kryton server replicas. |
| `image.repository` | `ghcr.io/azrtydxb/kryton/kryton` | Container image repository. |
| `image.tag` | `""` (falls back to `Chart.appVersion`) | Image tag. |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy. |
| `imagePullSecrets` | `[]` | Image pull secrets for private registries. |
| `resources` | `{}` | Pod resource requests/limits. |
| `nodeSelector` / `tolerations` / `affinity` | `{}` / `[]` / `{}` | Standard scheduling controls. |
| `podSecurityContext` / `securityContext` | secure defaults | Pod- and container-level security context. |
| `autoscaling.enabled` | `false` | Enable HPA. |

### Service & ingress

| Key | Default | Description |
|-----|---------|-------------|
| `service.type` | `ClusterIP` | Service type. |
| `service.port` | `3001` | Service port. |
| `service.targetPort` | `3001` | Container port (must match `env.config.PORT`). |
| `ingress.enabled` | `false` | Emit an Ingress resource. |
| `ingress.className` | `""` | IngressClassName. |
| `ingress.annotations` | `{}` | Ingress annotations (e.g. cert-manager). |
| `ingress.hosts` | `[{ host: kryton.local, paths: [{ path: /, pathType: Prefix }] }]` | Host rules. |
| `ingress.tls` | `[]` | TLS Secret references. |

### Persistence

| Key | Default | Description |
|-----|---------|-------------|
| `persistence.enabled` | `true` | Provision a chart-managed PVC. |
| `persistence.storageClass` | `""` (cluster default) | StorageClass for the PVC. |
| `persistence.size` | `10Gi` | PVC size. |
| `persistence.accessModes` | `[ReadWriteOnce]` | PVC access modes. |
| `persistence.mountPath` | `/data/notes` | Mount path (matches `env.config.NOTES_DIR`). |
| `persistence.existingClaim` | `""` | Reuse an existing PVC instead of provisioning. |

### Secrets

By default the chart emits a plain `Secret`. Set `externalSecrets.enabled=true`
to instead emit an `ExternalSecret` (requires [external-secrets-operator](https://external-secrets.io/)
installed in the cluster). When enabled, each value under `env.secret` is the
remote key name in the upstream secret store.

| Key | Default | Description |
|-----|---------|-------------|
| `externalSecrets.enabled` | `false` | Switch from plain Secret to ExternalSecret. |
| `externalSecrets.secretStoreName` | `""` | Name of the (Cluster)SecretStore. |
| `externalSecrets.secretStoreKind` | `ClusterSecretStore` | Kind of secret store reference. |
| `externalSecrets.refreshInterval` | `1h` | Refresh interval. |
| `externalSecrets.remoteKeyPrefix` | `""` | Prepended to every remote key. |

### Application env

`env.config` is rendered into a ConfigMap; `env.secret` is rendered into a
Secret (or ExternalSecret). Keys must match the env-var names the kryton
server expects — see `packages/server/src/config/env.ts` for the canonical
list. `BETTER_AUTH_SECRET` MUST be at least 32 characters or the server will
fail to start.

### Postgres

The bitnami/postgresql subchart is enabled by default with the
`pgvector/pgvector:pg16` image so semantic search works without a separate DB.
Set `postgresql.enabled=false` and provide `env.secret.POSTGRES_URL` to use an
external database.

## Example: production values

```yaml
# values-production.yaml
replicaCount: 2

image:
  pullPolicy: IfNotPresent

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
  enabled: true
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
    BETTER_AUTH_SECRET: "" # provide via --set or external-secrets
    POSTGRES_URL: ""       # auto-derived if blank and postgresql.enabled
```

## Upgrade considerations

- `appVersion` is locked to the kryton server version on every release; bumping
  the chart bumps the image automatically unless `image.tag` is overridden.
- The postgresql subchart is pinned. Major-version bumps of the subchart are
  flagged in the chart `CHANGELOG.md` (when published) — review before upgrade.
- Stateful data lives in the PVC and (if enabled) the postgresql subchart's
  PVC; `helm uninstall` does NOT delete PVCs.

## Troubleshooting

- **Pod crashloops with `BETTER_AUTH_SECRET must be at least 32 characters`** —
  set `env.secret.BETTER_AUTH_SECRET` to a 32+ char string.
- **Pod cannot reach postgres** — confirm `env.secret.POSTGRES_URL`
  resolves; if you disabled the subchart you must set this explicitly.
- **`helm test` times out** — check the kryton Pod logs; readiness probe
  fails until `/health` returns 200.
