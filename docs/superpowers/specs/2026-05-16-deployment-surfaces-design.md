# Deployment Surfaces (Helm, Compose, Operator) — Design

**Date**: 2026-05-16
**Status**: Proposed

## Problem

Kryton ships a single multi-arch container image to ghcr.io (and now mirrored to the cluster zot). Deployment artifacts today:

- `Dockerfile` + `docker-compose.yml` + `docker-compose.prod.yml` — single-host docker.

No declarative Kubernetes deployment lives in the repo. A self-hoster running on K8s has to hand-roll Deployments, Services, Ingresses, Postgres, secrets, storage. Multiple users have asked for a Helm chart, and the project will eventually want a Kubernetes operator to manage multi-instance lifecycle (backups, upgrades, plugin install).

Adding three deployment surfaces (compose, helm, operator) creates a **drift problem**: every new env var, port, volume, or dependency is three places to update, and one will be forgotten. Without a forcing function, the surfaces silently diverge — users on helm get a working install at v4.5.0, then v4.6.0 quietly requires a new env var that only docker-compose knows about, and helm-deployed instances crash on boot.

This design proposes a layered architecture for the three deployment surfaces that **makes divergence mechanically impossible** via a single source of truth and a CI gate.

## Goals

- Self-hosters can `helm install kryton` (or `docker compose up`, or apply a `Kryton` CR) and get a working stack.
- Every new runtime config knob added to the server propagates to all three surfaces in the same PR, or CI rejects the PR.
- Compose, helm, and operator stay version-locked to the app image.
- Helm chart and (later) operator are distributed as OCI artifacts to ghcr.io, mirrored to the cluster zot.
- No hand-maintained second copy of K8s manifests between helm and operator.

## Non-goals

- Multi-tenant SaaS deployment (every CR is a separate Kryton instance — single-tenant only).
- Operator-managed cross-cluster federation.
- Helm chart for the WordPress plugin or for kryton-mobile/desktop clients (the chart is server-side only).
- Replacing docker-compose. Compose stays the recommended single-host path; helm/operator are for K8s.

## Design

### Architecture

```
                  ┌─────────────────────────────────────┐
                  │  Zod config schema in packages/     │
                  │  server/src/config (SSOT)           │
                  └────────────────┬────────────────────┘
                                   │
                ┌──────────────────┼────────────────────┐
                │                  │                    │
        sync-check gate    sync-check gate     sync-check gate
                │                  │                    │
                ▼                  ▼                    ▼
       ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
       │ docker-      │    │ charts/      │    │ operator CRD │
       │ compose.     │    │ kryton/      │    │ schema       │
       │ prod.yml     │    │ values.yaml  │    │ (generated   │
       └──────────────┘    │ + templates  │    │  from chart) │
                          └──────┬───────┘    └──────┬───────┘
                                 │                    │
                                 │   helm-based       │
                                 └────── operator ────┘
                                       reconciles
```

Three principles:

1. **Server config schema is the canonical SSOT.** Every runtime input the app needs is declared there once, with type, default, required-ness, and description. All three deployment surfaces are validated against it.
2. **Helm chart is the only K8s manifest source.** The operator does not define Deployments, Services, or any K8s resources itself — it invokes `helm upgrade --install` (via the embedded helm SDK or `operator-sdk`'s helm flavor) with values computed from the CR spec. Chart improvements automatically appear in the operator.
3. **CI gate prevents drift at PR time, not release time.** A new `deployment-sync-check` job runs alongside the existing parallel CI gates and fails any PR that adds a config field to one surface without the others.

### Single source of truth: the config schema

The server's [packages/server/src/config](packages/server/src/config) module exports a Zod schema describing every env var. Today it's used at runtime by `loadEnv()`. The design adds: export this schema as JSON via a script (`scripts/dump-config-schema.ts`) so non-TypeScript consumers (helm linter, CI checks, future operator) can read it.

Schema metadata is extended (via `.describe()` and custom Zod registry) to carry:
- `description` — used as `# comment` in compose / helm values
- `secret: boolean` — true → goes into K8s Secret, false → ConfigMap; env name added to compose's `${VAR:?}` required-block
- `userFacing: boolean` — true → exposed in helm `values.yaml` top-level; false → internal default, not surfaced

The schema is dumped to `packages/server/config-schema.json` on `npm run build:shared`. CI checks consume this file.

### Helm chart shape

`charts/kryton/` lives in repo. Layout:

```
charts/kryton/
├── Chart.yaml                  # version + appVersion bumped by release flow
├── values.yaml                 # all knobs, generated section for env
├── values.schema.json          # generated from server config schema
├── templates/
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml            # gated by .Values.ingress.enabled
│   ├── configmap.yaml          # non-secret env
│   ├── secret.yaml             # secret env, gated by externalSecrets.enabled
│   ├── externalsecret.yaml     # gated by externalSecrets.enabled
│   ├── pvc.yaml                # gated by .Values.persistence.enabled
│   ├── servicemonitor.yaml     # optional, gated on prometheus-operator presence
│   ├── tests/
│   │   └── connection-test.yaml  # helm test: hits /health
│   └── NOTES.txt
├── charts/                     # bitnami/postgresql subchart pinned
└── README.md                   # auto-generated from values.yaml via helm-docs
```

Configured per design discussion:
- **Postgres**: optional bitnami postgres subchart with pgvector image override. `postgres.enabled=true` by default for first-run UX; `postgres.enabled=false` + `postgres.external.url` for production users with their own DB.
- **Ingress**: optional Ingress template, `ingress.enabled=false` default. Annotations + className pluggable. Gateway API can be added later as a sibling template if needed.
- **Storage**: chart-managed PVC, `persistence.storageClass` + `persistence.size` tunable. Mounted at the path the server reads from for plugin data + attachments.
- **Secrets**: plain `Secret` resource by default. If `externalSecrets.enabled=true`, chart emits an `ExternalSecret` resource (assumes [external-secrets-operator](https://external-secrets.io/) is installed in the cluster) and skips the plain Secret.

### Docker compose

`docker-compose.prod.yml` already exists and already declares the env vars the server needs. The design only adds the **sync-check** against the schema — no structural change. Compose stays the recommended single-host self-host path.

### Operator (Phase 2, after chart is stable)

Use the helm-based operator pattern (operator-sdk's `--plugins=helm` or kubebuilder + `helm.sh/helm/v3` SDK). The operator binary embeds `charts/kryton/`. The CRD looks like:

```yaml
apiVersion: kryton.azrtydxb.io/v1alpha1
kind: Kryton
metadata:
  name: my-kryton
spec:
  version: "4.5.0"           # appVersion to deploy
  values:                    # passthrough to helm values.yaml
    ingress:
      enabled: true
      host: kryton.example.com
    postgres:
      enabled: true
  # operator-only fields (not in chart values):
  backup:
    schedule: "0 3 * * *"
    retention: "30d"
status:
  helmRevision: 5
  observedVersion: "4.5.0"
  conditions: [...]
```

Reconciliation:
1. Compute helm values from `spec.values` + operator defaults.
2. `helm upgrade --install <name> charts/kryton --values <computed>`.
3. Operator-only features (CRD `spec.backup`, `spec.plugins`, `spec.snapshot`) handled in additional controller logic that runs against the same release.

Operator does not duplicate any Deployment/Service/etc. yaml.

### Drift-prevention CI gate

New job `deployment-sync-check` in [.github/workflows/ci.yml](.github/workflows/ci.yml), added as a 5th parallel gate alongside `typecheck/lint/test-build/openapi-check`.

The job runs a TypeScript script `scripts/check-deployment-sync.ts` that:

1. **Load schema.** Reads `packages/server/config-schema.json` → canonical field list with metadata.
2. **Compose check.** Parses `docker-compose.prod.yml`, inspects the `environment:` block of the kryton service. Asserts:
   - Every required field appears, either with a default literal or as `${VAR:?}`.
   - Every secret field uses `${VAR:?}` (no defaults in compose for secrets).
   - No env keys exist that aren't in the schema (compose has no orphans).
3. **Helm check.** Parses `charts/kryton/values.yaml` + `values.schema.json` + `templates/configmap.yaml` + `templates/secret.yaml` (or externalsecret). Asserts:
   - Every required field has a values.yaml key or a `required:` constraint in `values.schema.json`.
   - Every secret field is rendered into the Secret template, never the ConfigMap.
   - Values schema JSON validates `values.yaml` clean.
   - `helm lint charts/kryton` passes.
   - `helm template charts/kryton | kubeconform -strict` validates against current K8s API.
4. **Operator check (Phase 2).** Compares CRD OpenAPI schema (in `operator/config/crd/bases/`) against helm `values.schema.json`. CRD `spec.values` schema must be a superset of values.schema.json.

Failure mode: clear error message naming the field and which surface is missing it. Example:

```
deployment-sync: FAIL
  Field SEMANTIC_PROVIDER (required, secret=false) declared in
  config-schema.json but missing from charts/kryton/values.yaml.
  Add:
    semanticProvider: "off"  # default
  to values.yaml, and reference it from templates/configmap.yaml.
```

### Smoke tests per surface

In [.github/workflows/e2e.yml](.github/workflows/e2e.yml) (the slow tier, run manually + as release gate), add parallel jobs:

- `compose-smoke`: `docker compose -f docker-compose.prod.yml up -d`, wait for `/health` → 200, teardown.
- `helm-smoke`: `kind create cluster`, `helm install kryton charts/kryton`, wait for the kryton Pod ready + `/health` 200, teardown.
- `operator-smoke` (Phase 2): same as helm-smoke but applies a `Kryton` CR and waits for `status.conditions[Ready]=True`.

These exercise the artifact end-to-end and catch issues the static sync-check can't (e.g., wrong probe path, missing volume mount, broken Postgres connectivity).

### Versioning and distribution

- `charts/kryton/Chart.yaml` has both `version:` (chart version) and `appVersion:` (image tag). Both bumped by the same `chore(release):` commit that bumps `package.json` and friends.
- A pre-tag check (could be wrapped in the release helper script): `Chart.yaml`'s `appVersion` must equal `package.json`'s `version`.
- New release.yml job `helm-publish`:
  - Needs: `[manifest]` (so the image exists before the chart can reference it).
  - `helm package charts/kryton`.
  - `helm push kryton-<version>.tgz oci://ghcr.io/azrtydxb/charts`.
  - Runs in parallel with `mirror` and `release`.
- A new `chart-mirror` step (or extending the existing `mirror` job) does the equivalent `crane copy` / `imagetools` of the chart artifact from ghcr to the cluster zot.
- Operator (Phase 2): its own Dockerfile + parallel arm64/amd64 jobs, pushed to `ghcr.io/azrtydxb/kryton/kryton-operator:<version>`.

### Distribution paths

| Artifact | ghcr.io path | Cluster zot path |
|---|---|---|
| Server image | `azrtydxb/kryton/kryton:<ver>` | `azrtydxb/kryton/kryton:<ver>` |
| Helm chart | `azrtydxb/charts/kryton:<ver>` | `azrtydxb/charts/kryton:<ver>` |
| Operator image | `azrtydxb/kryton/kryton-operator:<ver>` | (mirror) |

Users on K8s install with:
```
helm install kryton oci://ghcr.io/azrtydxb/charts/kryton --version 4.5.0
```

## Non-design alternatives considered

- **Hand-maintained discipline, no SSOT or CI gate.** Rejected: every long-lived multi-surface project drifts this way. The gate is non-negotiable.
- **Operator as a hand-written reconciler defining its own Deployment/Service yaml.** Rejected: doubles the deployment manifests; every chart change requires a porting commit to the operator. Helm-based operator eliminates this.
- **Kustomize instead of helm.** Rejected: helm is the dominant K8s packaging format, has OCI distribution, and works cleanly with the helm-based operator pattern. Kustomize overlays could be added later as user-side composition on top of `helm template` output.
- **Generate helm chart from the Zod schema directly.** Rejected (for now): template logic is real K8s engineering — probes, init containers, sidecar patterns, Pod Security Standards — and shouldn't be auto-generated from a config schema. Schema covers env vars only; chart templates remain hand-written, schema-validated.

## Delivery

Everything in this design ships in a single phase. Helm chart, operator, drift gate, smoke tests, and publishing are landed together so the deployment surface is complete from day one rather than evolving in stages with mid-flight rework. Implementation is parallelized across independent workstreams (see workstreams below), not phases.

The implementation plan (separate doc) breaks this single delivery into parallel workstreams with file-ownership boundaries:

- **WS-A (Schema):** Extend Zod schema with `secret`/`userFacing` metadata, ship `scripts/dump-config-schema.ts`, generate `config-schema.json` on build. Owns `packages/server/src/config/**`, `scripts/dump-config-schema.ts`.
- **WS-B (Helm chart):** Scaffold `charts/kryton/` with all templates (Deployment, Service, Ingress, ConfigMap, Secret, ExternalSecret, PVC, ServiceMonitor, tests/connection-test). Wire bitnami postgres subchart with pgvector image override. Generate `values.schema.json` from WS-A output. Owns `charts/kryton/**`.
- **WS-C (Operator):** Scaffold `operator/` via `operator-sdk init --plugins=helm`, embed `charts/kryton/` from WS-B, define CRD with passthrough `spec.values` + operator-only fields (backup, plugins, snapshot), implement controllers for the operator-only fields. Operator image Dockerfile. Owns `operator/**`.
- **WS-D (Sync gate):** Write `scripts/check-deployment-sync.ts` covering schema↔compose↔helm↔CRD. Wire as `deployment-sync-check` job in ci.yml. Owns `scripts/check-deployment-sync.ts`, ci.yml additions.
- **WS-E (CI/CD plumbing):** Smoke tests in e2e.yml (`compose-smoke`, `helm-smoke`, `operator-smoke`). Release.yml additions: `helm-publish`, operator arm64+amd64 builds + manifest, CRD bundle publishing, chart + operator image mirroring to cluster zot. Owns release.yml + e2e.yml additions.
- **WS-F (Docs + branch protection):** README sections for each install path (compose, helm, operator). Update branch protection required checks. Owns docs + GH API call.

Integration points between workstreams are explicit:
- WS-B depends on WS-A's `config-schema.json` format.
- WS-C embeds WS-B's chart directory.
- WS-D depends on WS-A's schema, WS-B's values, WS-C's CRD.
- WS-E depends on WS-B's chart path, WS-C's operator image name.

Workstreams are executed by parallel implementer agents per the repo's standard agentic-development workflow.

## Open questions

These are answered as part of the single delivery (no deferral):

- **Plugin install via CR.** `spec.plugins[]` declares plugin URLs/digests; operator pre-installs them into a volume mounted at the server's plugins dir before the server pod starts (init-container pattern). Server's existing plugin loader picks them up at boot. No changes needed to the server plugin API.
- **Backup mechanics.** `spec.backup.schedule` (cron) triggers a Job that runs `pg_dump` against the configured postgres URL and uploads to S3-compatible storage via env-configured creds. `spec.backup.retention` enforced by a sweep step. No Velero dependency.
- **Multi-instance on a single cluster.** Each `Kryton` CR gets `metadata.name`-prefixed releases. The operator passes `fullnameOverride: <cr-name>` and `postgres.fullnameOverride: <cr-name>-postgres` into helm values to ensure no naming collisions. Storage PVCs likewise scoped by name.

## Acceptance

Design approved when:
- [ ] User signs off on the SSOT location (Zod schema in `packages/server/src/config`) and the metadata extension (`secret`, `userFacing`).
- [ ] User signs off on the helm chart shape (postgres subchart, optional ingress, chart-managed PVC, plain Secret + ExternalSecret support).
- [ ] User signs off on the helm-based operator approach.
- [ ] User signs off on the CI gate location (ci.yml as a parallel sibling) and failure semantics (PR blocked on schema drift).
- [ ] User signs off on the single-phase delivery via parallel workstreams.
- [ ] Implementation plan written and approved.
