---
title: Configuration
description: Three configuration surfaces — plugin manifests, helm values, and the operator CR — with pointers to the canonical references.
---

Kryton has three distinct configuration surfaces. Each is defined in code and has a canonical reference page.

## Plugin manifest

A plugin's `manifest.json` is parsed against the `PluginManifest` TypeScript interface in `packages/server/src/modules/plugins/services/types.ts`:

| Field | Type | Required |
|---|---|---|
| `id` | `string` | Yes |
| `name` | `string` | Yes |
| `version` | `string` | Yes |
| `description` | `string` | Yes |
| `author` | `string` | Yes |
| `minKrytonVersion` | `string` | Yes |
| `server` | `string` (path to server entry) | No |
| `client` | `string` (path to client entry) | No |
| `settings` | `PluginSettingDefinition[]` | No |

Each settings entry is `{ key, type ("string" | "boolean" | "number"), default, label, perUser }`. There is no runtime Zod validator — the manifest is `JSON.parse`d and consumed via the typed interface in `manager.ts`.

Plugin authoring lives at [Plugins → Quickstart](/kryton/advanced/plugins/quickstart/) and [Server API](/kryton/advanced/plugins/server-api/).

## Helm chart values

Cluster-level configuration is set via the chart at `charts/kryton/`. The full values reference, including ingress, ExternalSecrets, the bundled Bitnami `postgresql` subchart, and resource knobs, is documented on [Deployment → Helm chart](/kryton/advanced/deployment/helm/).

The chart is published as an OCI artefact to `oci://ghcr.io/azrtydxb/charts/kryton`.

## Operator Custom Resource

The Kubernetes Operator reconciles `Kryton` custom resources defined in `operator/api/v1alpha1/kryton_types.go`. A `KrytonSpec` has:

- `version` — server image `appVersion` to deploy (surfaced into helm values as `image.tag`)
- `values` — opaque YAML blob forwarded verbatim to the embedded helm chart
- `backup` — schedule + retention + S3-compatible `objectStore` for the postgres backup CronJob
- `plugins` — pre-install list (each entry pinned by SHA-256 of the plugin archive)
- `snapshot` — VolumeSnapshot CronJob configuration

The canonical CRD schema lives at `operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml` and ships in each release as `kryton-crds.yaml`. Full CR reference, example specs, and lifecycle on [Deployment → Kubernetes Operator](/kryton/advanced/deployment/operator/).
