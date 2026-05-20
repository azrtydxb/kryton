---
title: Configuration
description: Plugin manifest schema, registry shape, and the canonical config files Kryton consumes.
---

The runtime environment variables live in [Environment variables](/kryton/advanced/reference/env-vars/). This page covers everything else — the manifests, schemas, and registry shapes Kryton parses.

## Plugin manifest

Source: validated by the server's plugin loader on boot. The shape is documented in [`kryton-plugins/types/manifest.d.ts`](https://github.com/azrtydxb/kryton-plugins/blob/main/types) (the canonical types package).

```json
{
  "id": "kanban",
  "name": "Kanban Board",
  "version": "1.0.0",
  "description": "Render kanban boards from code fences using a simple column/card format",
  "author": "Kryton",
  "minKrytonVersion": "2.0.0",
  "tags": ["productivity", "tasks", "visualization"],
  "icon": "columns",
  "client": "client/index.js"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` matching `^[a-z][a-z0-9-]{1,40}$` | yes | Unique across the registry. The on-disk directory name must equal this. |
| `name` | `string` | yes | Display name. |
| `version` | SemVer string | yes | Plugin version, independent of Kryton's. |
| `description` | `string` | yes | One-sentence summary. Shown in the admin panel. |
| `author` | `string` | yes | Free-form. GitHub handle or full name. |
| `minKrytonVersion` | SemVer string | yes | Lowest Kryton version this plugin runs against. The host refuses to load mismatches. |
| `tags` | `string[]` | no | Free-form labels for registry search. |
| `icon` | [lucide](https://lucide.dev/icons/) icon name | no | Default icon for the plugin's sidebar / settings card. |
| `client` | path | no | Relative path to the JS entrypoint loaded in the browser. |
| `server` | path | no | Relative path to the JS entrypoint loaded in the Node server. |

If both `client` and `server` are omitted, the manifest is loaded but the plugin does nothing — not a useful state.

## Registry

The canonical registry (`kryton-plugins/registry.json`) is a single JSON file: an array of registry entries.

```json
[
  {
    "id": "kanban",
    "name": "Kanban Board",
    "version": "1.0.0",
    "description": "Render kanban boards from code fences using a simple column/card format",
    "author": "Kryton",
    "minKrytonVersion": "2.0.0",
    "tags": ["productivity", "tasks", "visualization"],
    "icon": "columns",
    "archiveUrl": "https://github.com/azrtydxb/kryton-plugins/releases/download/kanban-v1.0.0/kanban.tar.gz",
    "sha256": "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c"
  }
]
```

Registry entries are a superset of `manifest.json` — they add `archiveUrl` and `sha256` so the admin-panel installer can fetch and verify the archive.

## Helm chart values

The chart's `values.yaml` is the source of truth. Full reference: [Helm chart](/kryton/advanced/deployment/helm/#values-reference). The CI drift gate (`deployment-sync-check`) ensures every required server env var has a values key.

## Operator CRD

The `Kryton` CRD schema lives at [`operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml`](https://github.com/azrtydxb/kryton/blob/master/operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml). Top-level `spec` fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `spec.version` | `string` | yes | appVersion (image tag) to deploy. |
| `spec.values` | object | no | Passthrough to the embedded Helm chart's `values.yaml`. Preserves unknown fields. |
| `spec.backup` | object | no | Postgres backup CronJob configuration. See [Operator backups](/kryton/advanced/deployment/operator/#with-scheduled-backups). |
| `spec.plugins[]` | array | no | Plugins to pre-install via init-container. Each requires `name`, `url`, `sha256` (64 hex chars). |
| `spec.snapshot` | object | no | VolumeSnapshot schedule for the persistence PVC. |

Status (subresource):

| Field | Type | Notes |
|---|---|---|
| `status.helmRevision` | integer | Helm release revision. |
| `status.observedVersion` | `string` | The `spec.version` last reconciled. |
| `status.conditions[]` | array | Kubernetes-standard Condition entries (`type`, `status`, `reason`, `message`, `lastTransitionTime`). |

## Server config schema (`config-schema.json`)

`packages/server/config-schema.json` is the JSON-Schema dump of the Zod env schema. It's the artefact the Helm values and Operator CRD generators read to derive their own schemas — single source of truth for "every env var the server understands". Regenerate it with:

```bash
npm run build:config-schema --workspace=packages/server
```

CI re-runs this and fails if the committed file drifts from the generated one.

## Drizzle migrations

Schema migrations live at `packages/server/src/db/migrations/`. Each is an `.sql` file plus a `meta/` snapshot. Drizzle applies them in order on every boot. They're plain SQL — read them if you need to know exactly what changes between versions.

## See also

- [Environment variables](/kryton/advanced/reference/env-vars/)
- [Helm chart values](/kryton/advanced/deployment/helm/#values-reference)
- [Operator CRD](/kryton/advanced/deployment/operator/#crd-schema)
- [Plugins overview](/kryton/advanced/plugins/overview/)
