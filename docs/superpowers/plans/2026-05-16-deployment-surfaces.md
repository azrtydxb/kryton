# Deployment Surfaces (Helm, Compose, Operator) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan via parallel workstreams. Each workstream below has strict file-ownership boundaries — do not modify files outside your workstream's owned paths. Coordinate at integration points via the spec doc.

**Goal:** Deliver a production-grade Helm chart, a helm-based Kubernetes Operator, and the drift-prevention CI machinery that keeps docker-compose, the chart, and the operator's CRD in lockstep with the server's runtime config schema.

**Reference:** [Spec — Deployment Surfaces Design](../specs/2026-05-16-deployment-surfaces-design.md).

**Conventions:**
- TDD where logic has branches (config schema export, sync-check parsing/diffing, operator-only reconciliation).
- Pragmatic single-test integration coverage for I/O-heavy boundaries (helm template rendering, operator-sdk reconcile loop, smoke tests).
- One commit per task or per logical step. Frequent commits. Conventional-commit format (`feat:`, `chore:`, `ci:`, `docs:`).
- No phasing. All six workstreams land in master before cutting the next release tag.
- Strict file ownership per workstream — agents must not edit files outside their owned paths.
- Integration points are explicit; resolve via the spec, not by reaching into another workstream's files.

---

## Integration Points

| From | To | Contract |
|---|---|---|
| WS-A → WS-B | `packages/server/config-schema.json` written by `scripts/dump-config-schema.ts`. JSON: `{ fields: [{ name, type, required, secret, userFacing, default, description }] }`. |
| WS-B → WS-C | `charts/kryton/` chart directory embedded by operator at build time via `//go:embed charts/kryton/**`. |
| WS-A → WS-D | Same `config-schema.json` consumed by `scripts/check-deployment-sync.ts`. |
| WS-B → WS-D | `charts/kryton/values.yaml` + `values.schema.json` parsed by sync-check. |
| WS-C → WS-D | Generated CRD schema at `operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml`. |
| WS-B → WS-E | Chart path `charts/kryton` packaged in `helm-publish`. |
| WS-C → WS-E | Operator Dockerfile at `operator/Dockerfile`; operator image name `ghcr.io/${{ github.repository }}/kryton-operator`. |
| WS-D → WS-E | `deployment-sync-check` job name referenced in branch protection update by WS-F. |
| WS-F → WS-D | Branch protection PATCH includes `deployment-sync-check` context. |

---

## Workstream A — Server config schema SSOT

**Owns:**
- `packages/server/src/config/**`
- `packages/server/scripts/dump-config-schema.ts` (new)
- `packages/server/package.json` (only the `scripts` block, only to add `config:dump`)
- `packages/server/config-schema.json` (generated artifact, committed)
- `packages/server/.gitignore` if needed

**Does not touch:** any other workstream's paths.

### Tasks

- [x] **A1.** Read the current `packages/server/src/config/index.ts` and identify the Zod schema(s) declaring env-var fields. Map every env var to: `name`, Zod type, required vs optional, default value if any, current description (if any).
- [x] **A2.** Extend the schema's per-field metadata to carry `secret: boolean` and `userFacing: boolean`. Approach: a small TypeScript helper `withMeta(zodField, { secret, userFacing, description })` that stores metadata in a `WeakMap` keyed by the Zod field, since Zod doesn't have a stable metadata API across versions. Re-export the schema unchanged for runtime use.
- [x] **A3.** Audit every env field and assign correct `secret` + `userFacing` values. Postgres password, BETTER_AUTH_SECRET, API tokens → `secret: true`. Internal-only knobs (LOG_LEVEL, debug flags) → `userFacing: false`. Document the audit decisions inline.
- [x] **A4.** Write `packages/server/scripts/dump-config-schema.ts` that imports the schema, walks each field, resolves type / required / default / secret / userFacing / description, and writes `packages/server/config-schema.json` as `{ fields: [...] }`. Stable key order, trailing newline (match `dump-openapi.ts` style).
- [x] **A5.** Add `config:dump` and `config:check` scripts to `packages/server/package.json`. `config:check` runs the dumper to a temp file and diffs against `config-schema.json` (mirror the `openapi:check` pattern).
- [x] **A6.** Unit tests for the schema dumper: every metadata field round-trips, types map correctly (`ZodString` → `"string"`, `ZodNumber` → `"number"`, `ZodEnum` → `"enum"` with `values`), defaults serialize.
- [x] **A7.** Run `npm run config:dump`, commit `config-schema.json`.
- [x] **A8.** Sanity check: `npm run config:check` exits 0.

---

## Workstream B — Helm chart

**Owns:**
- `charts/kryton/**` (entire directory, new)
- `.helmignore` if needed

**Does not touch:** anything outside `charts/kryton/`.

### Tasks

- [x] **B1.** Create `charts/kryton/Chart.yaml` with `apiVersion: v2`, `name: kryton`, `type: application`. `version` and `appVersion` both set to the current `package.json` version. `dependencies` block referencing `bitnami/postgresql` pinned to a current major version. Use `condition: postgresql.enabled` so the dep is opt-out.
- [x] **B2.** Write `charts/kryton/values.yaml`. Top-level groups: `image`, `replicaCount`, `service`, `ingress` (default `enabled: false`), `persistence`, `postgresql` (default `enabled: true`, override image to a pgvector image), `externalSecrets` (default `enabled: false`), `resources`, `nodeSelector`, `tolerations`, `affinity`, `podSecurityContext`, `securityContext`, `serviceMonitor` (default `enabled: false`), `env` (the schema-driven block — non-secret defaults).
- [x] **B3.** Write `charts/kryton/values.schema.json` describing the values structure (JSON Schema draft 2020-12). Cover the same top-level groups. This will be regenerated/validated by WS-D against `config-schema.json`; for now write a hand-crafted version that matches `values.yaml`.
- [x] **B4.** Templates:
  - `templates/_helpers.tpl` — name, fullname, labels, selectorLabels helpers (standard helm pattern).
  - `templates/deployment.yaml` — kryton Deployment. Image from `.Values.image`. ContainerPort from `.Values.service.port`. EnvFrom both the ConfigMap and the Secret. Liveness + readiness probes against `/health`. VolumeMounts for `.Values.persistence`. ImagePullSecrets if set.
  - `templates/service.yaml` — ClusterIP service.
  - `templates/ingress.yaml` — gated by `.Values.ingress.enabled`. Supports `className`, `annotations`, `tls`, `hosts[].host` + `paths[]`.
  - `templates/configmap.yaml` — env keys where `secret=false` and `userFacing=true|false`, rendered from `.Values.env`.
  - `templates/secret.yaml` — gated by `not .Values.externalSecrets.enabled`. Keys where `secret=true`. Values via `.Values.env.secret` map.
  - `templates/externalsecret.yaml` — gated by `.Values.externalSecrets.enabled`. References a ClusterSecretStore by name from values; secretKey refs are listed per secret env name.
  - `templates/pvc.yaml` — gated by `.Values.persistence.enabled`.
  - `templates/servicemonitor.yaml` — gated by `.Values.serviceMonitor.enabled`. Targets the kryton service, scrape path configurable.
  - `templates/tests/connection-test.yaml` — `helm test` Pod that hits `http://<svc>:<port>/health` via wget, exits 0 on 200.
  - `templates/NOTES.txt` — install summary (URL to access, postgres status, ingress URL if enabled).
- [x] **B5.** Set the postgresql subchart's image to pgvector via `values.yaml`:
  ```yaml
  postgresql:
    enabled: true
    image:
      repository: pgvector/pgvector
      tag: pg16
    auth:
      username: kryton
      database: kryton
  ```
- [x] **B6.** Write `charts/kryton/README.md` documenting top-level values, install command (both `helm install` from a local dir and from `oci://`), upgrade considerations, and an example `values-production.yaml`.
- [x] **B7.** Add `charts/kryton/.helmignore` excluding `tests/`, `*.md`, etc.
- [x] **B8.** Run `helm lint charts/kryton` locally — must pass with zero warnings.
- [x] **B9.** Run `helm template charts/kryton --set ingress.enabled=true --set externalSecrets.enabled=false` and pipe through `kubeconform -strict` — must validate.
- [x] **B10.** Run `helm dependency update charts/kryton`, verify the postgres tgz is fetched.

---

## Workstream C — Operator

**Owns:**
- `operator/**` (entire directory, new)

**Does not touch:** anything outside `operator/`. (It reads `charts/kryton/` via `go:embed` but does not edit it.)

### Tasks

- [x] **C1.** From `operator/`, run `operator-sdk init --domain=azrtydxb.io --repo=github.com/azrtydxb/kryton/operator --plugins=helm`. Commit the scaffold.
- [x] **C2.** Add a Kryton CRD: `operator-sdk create api --group=kryton --version=v1alpha1 --kind=Kryton --helm-chart=../charts/kryton`. This wires the helm-based reconciler to the chart at the integration-point path.
- [x] **C3.** Convert the chart embed from path-reference to `//go:embed` so the operator image is self-contained: copy the embed step into a small wrapper around `helm.NewClient`, then bind the embedded FS to the chart resolver. Reference operator-sdk's helm SDK docs for the embed pattern.
- [x] **C4.** Extend the CRD `Kryton` type with operator-only spec fields:
  ```go
  type KrytonSpec struct {
      Version  string                 `json:"version"`
      Values   map[string]interface{} `json:"values,omitempty"` // passthrough to chart
      Backup   *BackupSpec            `json:"backup,omitempty"`
      Plugins  []PluginSpec           `json:"plugins,omitempty"`
      Snapshot *SnapshotSpec          `json:"snapshot,omitempty"`
  }
  ```
  `BackupSpec`: schedule (cron), retention (duration), objectStore config (bucket, endpoint, region, prefix, credentialsSecretRef) for S3-compatible targets (MinIO/Garage/SeaweedFS).
  `PluginSpec`: name, url, sha256 digest.
  `SnapshotSpec`: schedule, retention.
- [x] **C5.** Implement the operator-only reconciler logic (separate controller, not the helm one):
  - Backup: emit a CronJob that runs `pg_dump` against the configured postgres URL → uploads to S3 via env-configured creds → sweeps older-than-retention objects.
  - Plugins: pre-install via an init-container on the kryton pod that downloads each plugin URL, verifies sha256, drops into the persistence volume's plugins dir.
  - Snapshot: VolumeSnapshot resource on the PVC at the schedule, retention via sweep.
- [x] **C6.** RBAC manifests for the operator (`operator/config/rbac/`): permissions to manage Deployments/Services/Ingresses/ConfigMaps/Secrets/PVCs/Jobs/CronJobs/VolumeSnapshots in the operator's namespace, plus the helm release ConfigMaps.
- [x] **C7.** `operator/Dockerfile` — multi-stage Go build, distroless or scratch runtime base. Multi-arch via buildx.
- [x] **C8.** Generate the CRD bundle: `make manifests` produces `operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml`. Commit.
- [x] **C9.** Operator unit tests for the operator-only reconcile logic (envtest-based) — backup, plugin install, snapshot paths.
- [x] **C10.** Write `operator/README.md` documenting CRD install, operator deploy, example `Kryton` CRs (minimal, with backup, with plugins, multi-instance).

---

## Workstream D — Drift-prevention sync gate

**Owns:**
- `scripts/check-deployment-sync.ts` (new, at repo root)
- `package.json` (root, only to add `sync:check` script)
- `.github/workflows/ci.yml` — adds `deployment-sync-check` as a 5th parallel gate job. **Edits this file but coordinates with WS-E to avoid merge conflicts (WS-E adds `helm-publish` to release.yml, not ci.yml; should be conflict-free).**

**Does not touch:** chart files, operator files, server config files.

### Tasks

- [x] **D1.** Write `scripts/check-deployment-sync.ts`. Load `packages/server/config-schema.json` → canonical field list.
- [x] **D2.** Compose check: parse `docker-compose.prod.yml`, find the kryton service's `environment:` block. For each schema field:
  - Required + secret → must appear as `KEY: ${KEY:?}` (no default).
  - Required + non-secret → must appear with a default literal OR `${KEY:?}`.
  - Optional → may appear with default; absence is OK.
  - Compose has no env keys missing from the schema (orphan detection).
- [x] **D3.** Helm check: parse `charts/kryton/values.yaml` and `values.schema.json`. For each schema field:
  - Required + secret → must be referenced by `templates/secret.yaml` (or `externalsecret.yaml`), never `configmap.yaml`.
  - Required + non-secret → must have a values.yaml default OR be marked required in `values.schema.json`.
  - Optional → may be present.
- [x] **D4.** Run `helm lint charts/kryton` and `helm template charts/kryton | kubeconform -strict` from within the check. Fail the gate if either fails.
- [x] **D5.** CRD check: parse `operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml`. Extract `spec.values` schema. Assert it's a superset of `charts/kryton/values.schema.json` (every property in values.schema.json appears under CRD `spec.values`).
- [x] **D6.** Output format: structured failure messages naming the field, the missing surface, and a concrete fix (the exact line to add). Exit 1 on any mismatch.
- [x] **D7.** Unit tests with synthetic schema + synthetic compose/helm/CRD fixtures covering each mismatch class.
- [x] **D8.** Add `sync:check` to root `package.json`: `tsx scripts/check-deployment-sync.ts`.
- [x] **D9.** Add `deployment-sync-check` job to `.github/workflows/ci.yml` as a 5th parallel sibling alongside `typecheck`, `lint`, `test-build`, `openapi-check`. Cached `npm ci`, runs `helm` + `kubeconform` (install in step), runs `npm run sync:check`.

---

## Workstream E — CI/CD plumbing

**Owns:**
- `.github/workflows/release.yml` — adds `helm-publish`, operator build jobs, CRD bundle publishing, extended `mirror`.
- `.github/workflows/e2e.yml` — adds `compose-smoke`, `helm-smoke`, `operator-smoke` parallel jobs.

**Does not touch:** ci.yml (WS-D owns that), chart files, operator source.

### Tasks

- [x] **E1.** Add `helm-publish` job to release.yml. `needs: [manifest]`. Steps: install helm, `helm package charts/kryton`, log in to ghcr, `helm push kryton-<ver>.tgz oci://ghcr.io/${{ github.repository_owner }}/charts`. Outputs the resulting OCI URL.
- [x] **E2.** Add operator build jobs to release.yml: `build-operator-arm64` + `build-operator-amd64` (parallel, mirroring the existing `build-arm64`/`build-amd64` pattern). Image name `${{ env.REGISTRY }}/${{ github.repository }}/kryton-operator`. Push by digest. Outputs digest.
- [x] **E3.** Add `manifest-operator` job: `needs: [build-operator-arm64, build-operator-amd64]`. Uses `imagetools create` to assemble the multi-arch operator image, same pattern as the existing `manifest` job.
- [x] **E4.** Extend `mirror` job (or add a sibling `chart-mirror` + `operator-mirror`): mirror the chart OCI artifact and the operator image to the cluster zot using the same `docker buildx imagetools create` pattern. Source: `ghcr.io/.../charts/kryton:<ver>` and `ghcr.io/.../kryton-operator:<ver>`. Dest: `192.168.10.123:5000/...` equivalent paths.
- [x] **E5.** Update `release` job's `needs:` to include `helm-publish` and `manifest-operator`.
- [x] **E6.** Add `compose-smoke` to e2e.yml. Brings up `docker compose -f docker-compose.prod.yml up -d`, waits for the kryton container's `/health` endpoint to return 200, tears down.
- [x] **E7.** Add `helm-smoke` to e2e.yml. Installs `kind`, creates a cluster, `helm install kryton charts/kryton --wait`, asserts `/health` via port-forward or NodePort, teardown.
- [x] **E8.** Add `operator-smoke` to e2e.yml. Same as helm-smoke but: installs the CRD bundle, deploys the operator, applies a minimal `Kryton` CR, waits for `status.conditions[Ready]=True`, asserts `/health`, teardown.
- [x] **E9.** Verify the existing concurrency / cancel-in-progress settings still apply to the added jobs. (Neither workflow declared a `concurrency:` block originally; nothing to migrate. New jobs share the same workflow-run scope as the existing jobs.)

---

## Workstream F — Docs + branch protection

**Owns:**
- `README.md` (only the deployment section)
- `docs/HELM.md` (new)
- `docs/OPERATOR.md` (new)
- Branch protection update via `gh api` (no file owned, but a checklist task).

**Does not touch:** workflows, scripts, charts, operator source.

### Tasks

- [x] **F1.** Write `docs/HELM.md`: install command (from OCI + from local), values reference (link to `charts/kryton/README.md`), upgrade flow, postgres options, ingress examples, ExternalSecrets example, troubleshooting (probe failures, common values mistakes).
- [x] **F2.** Write `docs/OPERATOR.md`: install (CRD bundle + operator Deployment), example CRs (minimal, with backup, with plugins, multi-instance), backup/restore procedures, plugin installation flow, upgrade procedure (operator first, then bump `spec.version` per CR), troubleshooting.
- [x] **F3.** Update `README.md`'s install/deploy section to list all three paths (compose for single-host, helm for k8s, operator for managed lifecycle) with one-liner pros/cons and links to the detailed docs.
- [ ] **F4.** After all other workstreams land and CI is green, update branch protection on master to add `deployment-sync-check` to the required checks. Use:
  ```
  gh api -X PATCH repos/azrtydxb/kryton/branches/master/protection/required_status_checks \
    --input - <<'EOF'
  {
    "strict": true,
    "checks": [
      {"context": "typecheck", "app_id": 15368},
      {"context": "lint", "app_id": 15368},
      {"context": "test-build", "app_id": 15368},
      {"context": "openapi-check", "app_id": 15368},
      {"context": "deployment-sync-check", "app_id": 15368}
    ]
  }
  EOF
  ```

---

## Integration & Release

- [ ] **R1.** Once all six workstreams land in master, cut a release tag (e.g. `v4.6.0`). Verify the full release.yml DAG executes green: gate jobs, both arch builds, both operator arch builds, manifests, mirrors, helm-publish, release.
- [ ] **R2.** From a workstation, install the chart fresh on a real k8s cluster (or kind). Walk through: `helm install`, hit `/health`, verify postgres pod up, verify a real auth flow works. Then upgrade by bumping `appVersion` and re-installing. Capture any rough edges as follow-up issues.
- [ ] **R3.** Apply a minimal `Kryton` CR to the same cluster. Verify the operator reconciles to the same end state as the chart install. Test backup CronJob, plugin install, snapshot.
- [ ] **R4.** Document any operational surprises in `docs/OPERATOR.md`.
- [ ] **R5.** Update the project memory: mark `kryton-mirror-pending-verification` resolved once `chart-mirror` and `operator-mirror` are confirmed green and visible in the zot UI.

---

## Notes for parallel execution

- **Dependency ordering at runtime, not commit-time.** All six workstreams can land in parallel. The sync-check (WS-D) tolerates missing artifacts during initial bring-up: if `config-schema.json` doesn't exist yet, the check skips silently rather than failing — so WS-D can land before WS-A is fully done, and once WS-A's schema lands the gate activates retroactively on the next PR.
- **Test-first per workstream.** Each agent writes the failing test for its piece before the implementation, per the repo's TDD norm.
- **Conflict-prone files.** Only `release.yml`, `e2e.yml`, and the root `package.json` are touched by multiple workstreams. Use the integration-point table to keep edits non-overlapping; if a real conflict arises, surface it via the workstream's status report rather than guessing the merge.
