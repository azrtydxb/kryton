/**
 * Drift-prevention sync gate.
 *
 * Verifies that every field declared in the server config schema
 * (`packages/server/config-schema.json`, produced by WS-A) is present
 * and correctly shaped in every deployment surface:
 *
 *   - `docker-compose.prod.yml` (compose surface)
 *   - `charts/kryton/values.yaml` + `values.schema.json` (helm surface)
 *   - `operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml` (CRD)
 *
 * Tolerance:
 *   Any of the four artifacts may be absent during initial bring-up of
 *   the parallel workstreams that deliver them. Missing artifacts are
 *   skipped silently rather than failing CI; the gate activates
 *   retroactively as each surface lands.
 *
 * Exits non-zero if any drift is detected. Each failure names the
 * field, the missing surface, and the concrete fix.
 *
 * Usage:
 *   tsx scripts/check-deployment-sync.ts
 *   tsx scripts/check-deployment-sync.ts --root <repo-root>
 *   tsx scripts/check-deployment-sync.ts --no-tools   # skip helm/kubeconform
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as YAML from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaFieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "url"
  | "json";

export interface SchemaField {
  name: string;
  type: SchemaFieldType | string;
  required: boolean;
  secret: boolean;
  userFacing: boolean;
  default?: unknown;
  description?: string;
  values?: string[];
}

export interface ConfigSchema {
  fields: SchemaField[];
}

export interface Finding {
  surface: "compose" | "helm" | "crd" | "tools";
  field?: string;
  message: string;
  fix?: string;
}

export interface CheckOptions {
  root: string;
  runTools?: boolean;
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

function readJsonIfExists<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readYamlIfExists<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return YAML.parse(fs.readFileSync(file, "utf8")) as T;
}

function readTextIfExists(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// Compose surface
// ---------------------------------------------------------------------------

interface ComposeService {
  environment?: Record<string, unknown> | string[];
}

interface ComposeFile {
  services?: Record<string, ComposeService>;
}

/**
 * Returns a map of envKey -> raw value (string) for the `kryton`
 * service's environment block. Handles both list-form
 * (`- KEY=value`) and map-form (`KEY: value`).
 */
export function parseComposeEnv(
  compose: ComposeFile,
): Record<string, string> | undefined {
  const svc = compose.services?.["kryton"];
  if (!svc) return undefined;
  const env = svc.environment;
  if (!env) return {};
  if (Array.isArray(env)) {
    const out: Record<string, string> = {};
    for (const entry of env) {
      if (typeof entry !== "string") continue;
      const idx = entry.indexOf("=");
      if (idx === -1) {
        out[entry] = "";
      } else {
        out[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
    }
    return out;
  }
  if (typeof env === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      out[k] = v == null ? "" : String(v);
    }
    return out;
  }
  return {};
}

/** `${KEY:?...}` — interpolation with required marker. */
function isRequiredInterp(value: string, key: string): boolean {
  const pattern = new RegExp(`\\$\\{${key}:\\?[^}]*\\}`);
  return pattern.test(value);
}

/** `${KEY:-...}` or `${KEY-...}` — interpolation with default. */
function hasDefaultInterp(value: string, key: string): boolean {
  const pattern = new RegExp(`\\$\\{${key}:?-[^}]*\\}`);
  return pattern.test(value);
}

export function checkCompose(
  schema: ConfigSchema,
  compose: ComposeFile,
): Finding[] {
  const findings: Finding[] = [];
  const env = parseComposeEnv(compose);
  if (env === undefined) {
    findings.push({
      surface: "compose",
      message:
        "docker-compose.prod.yml has no `kryton` service — sync-check cannot validate compose surface.",
    });
    return findings;
  }

  const schemaNames = new Set(schema.fields.map((f) => f.name));

  for (const field of schema.fields) {
    const raw = env[field.name];
    const present = field.name in env;

    if (field.required) {
      if (!present) {
        findings.push({
          surface: "compose",
          field: field.name,
          message: `Required field ${field.name} (secret=${field.secret}) missing from docker-compose.prod.yml environment block.`,
          fix: field.secret
            ? `Add to services.kryton.environment:\n  - ${field.name}=\${${field.name}:?Set ${field.name}}`
            : `Add to services.kryton.environment:\n  - ${field.name}=\${${field.name}:-${stringifyDefault(field.default)}}`,
        });
        continue;
      }
      if (field.secret) {
        // Secret required fields must use the `${KEY:?}` required-marker.
        if (!isRequiredInterp(raw, field.name)) {
          findings.push({
            surface: "compose",
            field: field.name,
            message: `Secret field ${field.name} must use required-interpolation \${${field.name}:?...} in docker-compose.prod.yml; got \`${raw}\`.`,
            fix: `Change to: - ${field.name}=\${${field.name}:?Set ${field.name}}`,
          });
        }
        // Secret fields must not embed a default literal.
        if (hasDefaultInterp(raw, field.name)) {
          findings.push({
            surface: "compose",
            field: field.name,
            message: `Secret field ${field.name} must not have a default in docker-compose.prod.yml.`,
            fix: `Change to: - ${field.name}=\${${field.name}:?Set ${field.name}}`,
          });
        }
      } else {
        // Required non-secret: must either have a default-interp or
        // required-interp or be a plain literal.
        const hasInterp = raw.includes("${");
        if (
          hasInterp &&
          !isRequiredInterp(raw, field.name) &&
          !hasDefaultInterp(raw, field.name)
        ) {
          findings.push({
            surface: "compose",
            field: field.name,
            message: `Required field ${field.name} uses bare \${${field.name}} interpolation without default or required marker.`,
            fix: `Use \${${field.name}:-${stringifyDefault(field.default)}} or \${${field.name}:?Set ${field.name}}.`,
          });
        }
      }
    }
  }

  // Orphan check: compose env keys that aren't in schema.
  for (const key of Object.keys(env)) {
    if (!schemaNames.has(key)) {
      findings.push({
        surface: "compose",
        field: key,
        message: `Env key ${key} present in docker-compose.prod.yml but not declared in config-schema.json.`,
        fix: `Either add ${key} to the server Zod config schema, or remove it from docker-compose.prod.yml.`,
      });
    }
  }

  return findings;
}

function stringifyDefault(d: unknown): string {
  if (d === undefined || d === null) return "";
  if (typeof d === "string") return d;
  return JSON.stringify(d);
}

// ---------------------------------------------------------------------------
// Helm surface
// ---------------------------------------------------------------------------

interface HelmValues {
  env?: Record<string, unknown> & {
    secret?: Record<string, unknown>;
  };
}

interface HelmValuesSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface HelmInputs {
  values?: HelmValues;
  valuesSchema?: HelmValuesSchema;
  configmapTemplate?: string;
  secretTemplate?: string;
  externalSecretTemplate?: string;
}

/**
 * Returns the set of env-keys referenced inside a helm template
 * (configmap or secret). We look for both `.Values.env.KEY` style
 * and bare `KEY:` lines under a `data:` block.
 */
export function extractTemplateKeys(template: string): Set<string> {
  const keys = new Set<string>();
  // Match `.Values.env.<KEY>` and `.Values.env.secret.<KEY>`.
  for (const m of template.matchAll(/\.Values\.env(?:\.secret)?\.([A-Z0-9_]+)/g)) {
    keys.add(m[1]);
  }
  // Match `<KEY>:` data keys (env-var-shaped uppercase).
  for (const m of template.matchAll(/^\s+([A-Z][A-Z0-9_]+)\s*:/gm)) {
    keys.add(m[1]);
  }
  return keys;
}

export function checkHelm(
  schema: ConfigSchema,
  inputs: HelmInputs,
): Finding[] {
  const findings: Finding[] = [];
  if (!inputs.values && !inputs.valuesSchema) {
    // Chart not present yet — skip silently.
    return findings;
  }

  const configmapKeys = inputs.configmapTemplate
    ? extractTemplateKeys(inputs.configmapTemplate)
    : new Set<string>();
  const secretKeys = new Set<string>([
    ...(inputs.secretTemplate
      ? extractTemplateKeys(inputs.secretTemplate)
      : []),
    ...(inputs.externalSecretTemplate
      ? extractTemplateKeys(inputs.externalSecretTemplate)
      : []),
  ]);

  const valuesEnv = (inputs.values?.env ?? {}) as Record<string, unknown>;
  const valuesEnvSecret = (valuesEnv["secret"] ?? {}) as Record<string, unknown>;

  const schemaRequiredFromValuesSchema = new Set(
    inputs.valuesSchema?.required ?? [],
  );

  for (const field of schema.fields) {
    if (field.secret) {
      // Secret fields must be referenced by the Secret/ExternalSecret
      // templates, never by the ConfigMap.
      if (configmapKeys.has(field.name)) {
        findings.push({
          surface: "helm",
          field: field.name,
          message: `Secret field ${field.name} appears in templates/configmap.yaml — secrets must only live in templates/secret.yaml or templates/externalsecret.yaml.`,
          fix: `Move ${field.name} out of templates/configmap.yaml and reference it from templates/secret.yaml as { .Values.env.secret.${field.name} }.`,
        });
      }
      if (field.required) {
        const inSecret = secretKeys.has(field.name);
        const inValuesSecret = field.name in valuesEnvSecret;
        if (!inSecret && !inValuesSecret) {
          findings.push({
            surface: "helm",
            field: field.name,
            message: `Required secret field ${field.name} missing from helm chart (not in templates/secret.yaml or templates/externalsecret.yaml).`,
            fix: `Add to templates/secret.yaml stringData:\n  ${field.name}: {{ required "${field.name} is required" .Values.env.secret.${field.name} | quote }}`,
          });
        }
      }
    } else {
      // Non-secret fields: should appear in configmap or have a values.yaml default.
      if (field.required) {
        const hasDefaultInValues = field.name in valuesEnv;
        const inConfigmap = configmapKeys.has(field.name);
        const markedRequiredInSchema = schemaRequiredFromValuesSchema.has(
          field.name,
        );
        if (!hasDefaultInValues && !inConfigmap && !markedRequiredInSchema) {
          findings.push({
            surface: "helm",
            field: field.name,
            message: `Required non-secret field ${field.name} not surfaced in helm chart (no default in values.yaml, no reference in templates/configmap.yaml, not required in values.schema.json).`,
            fix: `Either add to values.yaml:\n  env:\n    ${field.name}: ${stringifyDefault(field.default)}\nor reference it from templates/configmap.yaml.`,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CRD surface
// ---------------------------------------------------------------------------

interface CrdDocument {
  spec?: {
    versions?: Array<{
      schema?: {
        openAPIV3Schema?: {
          properties?: {
            spec?: {
              properties?: {
                values?: {
                  properties?: Record<string, unknown>;
                  // x-kubernetes-preserve-unknown-fields lets the CRD
                  // accept arbitrary passthrough values, satisfying the
                  // superset requirement automatically.
                  ["x-kubernetes-preserve-unknown-fields"]?: boolean;
                };
              };
            };
          };
        };
      };
    }>;
  };
}

export function checkCrd(
  valuesSchema: HelmValuesSchema | undefined,
  crd: CrdDocument | undefined,
): Finding[] {
  const findings: Finding[] = [];
  if (!valuesSchema || !crd) return findings;

  const versions = crd.spec?.versions ?? [];
  if (versions.length === 0) {
    findings.push({
      surface: "crd",
      message: "CRD has no spec.versions[] — cannot validate spec.values shape.",
    });
    return findings;
  }
  // Validate against the latest stored version.
  const v = versions[versions.length - 1];
  const valuesNode =
    v.schema?.openAPIV3Schema?.properties?.spec?.properties?.values;
  if (!valuesNode) {
    findings.push({
      surface: "crd",
      message:
        "CRD spec.values has no schema node — operator cannot validate chart values.",
      fix: "Define spec.values under the CRD with either explicit properties or x-kubernetes-preserve-unknown-fields: true.",
    });
    return findings;
  }
  // Passthrough schemas trivially satisfy superset.
  if (valuesNode["x-kubernetes-preserve-unknown-fields"] === true) {
    return findings;
  }
  const crdProps = valuesNode.properties ?? {};
  const valuesProps = valuesSchema.properties ?? {};
  for (const key of Object.keys(valuesProps)) {
    if (!(key in crdProps)) {
      findings.push({
        surface: "crd",
        field: key,
        message: `CRD spec.values is missing property "${key}" declared in charts/kryton/values.schema.json.`,
        fix: `Either add "${key}" under spec.values.properties in the CRD, or set x-kubernetes-preserve-unknown-fields: true to accept passthrough values.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// External tools: helm lint + kubeconform
// ---------------------------------------------------------------------------

function which(bin: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function runHelmTools(chartDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!fs.existsSync(chartDir)) return findings; // chart not present yet
  if (!which("helm")) {
    findings.push({
      surface: "tools",
      message: "helm binary not found in PATH — skipping helm lint.",
    });
  } else {
    try {
      execFileSync("helm", ["lint", chartDir], { stdio: "pipe" });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const out =
        (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") ||
        (e.message ?? "helm lint failed");
      findings.push({
        surface: "tools",
        message: `helm lint ${chartDir} failed:\n${out}`,
      });
    }
  }

  if (!which("kubeconform")) {
    findings.push({
      surface: "tools",
      message:
        "kubeconform binary not found in PATH — skipping rendered-manifest validation.",
    });
    return findings;
  }
  if (!which("helm")) return findings;

  // Render and pipe to kubeconform.
  try {
    const rendered = execFileSync("helm", ["template", chartDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      execFileSync(
        "kubeconform",
        ["-strict", "-summary", "-ignore-missing-schemas"],
        { input: rendered, stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const out =
        (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") ||
        (e.message ?? "kubeconform failed");
      findings.push({
        surface: "tools",
        message: `kubeconform validation of rendered chart failed:\n${out}`,
      });
    }
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const out =
      (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") ||
      (e.message ?? "helm template failed");
    findings.push({
      surface: "tools",
      message: `helm template ${chartDir} failed:\n${out}`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface CheckResult {
  findings: Finding[];
  surfacesPresent: {
    schema: boolean;
    compose: boolean;
    helmValues: boolean;
    helmValuesSchema: boolean;
    crd: boolean;
  };
}

export function checkDeploymentSync(opts: CheckOptions): CheckResult {
  const root = opts.root;
  const findings: Finding[] = [];

  const schemaPath = path.join(root, "packages/server/config-schema.json");
  const composePath = path.join(root, "docker-compose.prod.yml");
  const chartDir = path.join(root, "charts/kryton");
  const valuesPath = path.join(chartDir, "values.yaml");
  const valuesSchemaPath = path.join(chartDir, "values.schema.json");
  const configmapPath = path.join(chartDir, "templates/configmap.yaml");
  const secretPath = path.join(chartDir, "templates/secret.yaml");
  const externalSecretPath = path.join(
    chartDir,
    "templates/externalsecret.yaml",
  );
  const crdPath = path.join(
    root,
    "operator/config/crd/bases/kryton.azrtydxb.io_krytons.yaml",
  );

  const schema = readJsonIfExists<ConfigSchema>(schemaPath);
  const compose = readYamlIfExists<ComposeFile>(composePath);
  const values = readYamlIfExists<HelmValues>(valuesPath);
  const valuesSchema = readJsonIfExists<HelmValuesSchema>(valuesSchemaPath);
  const configmapTemplate = readTextIfExists(configmapPath);
  const secretTemplate = readTextIfExists(secretPath);
  const externalSecretTemplate = readTextIfExists(externalSecretPath);
  const crd = readYamlIfExists<CrdDocument>(crdPath);

  const surfacesPresent = {
    schema: !!schema,
    compose: !!compose,
    helmValues: !!values,
    helmValuesSchema: !!valuesSchema,
    crd: !!crd,
  };

  // If schema is absent, every cross-check skips silently. The gate
  // activates retroactively once WS-A lands.
  if (schema) {
    if (compose) findings.push(...checkCompose(schema, compose));
    if (values || valuesSchema)
      findings.push(
        ...checkHelm(schema, {
          values,
          valuesSchema,
          configmapTemplate,
          secretTemplate,
          externalSecretTemplate,
        }),
      );
    if (valuesSchema && crd) findings.push(...checkCrd(valuesSchema, crd));
  }

  if (opts.runTools !== false) {
    findings.push(...runHelmTools(chartDir));
  }

  return { findings, surfacesPresent };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function formatReport(result: CheckResult): string {
  const lines: string[] = [];
  lines.push("deployment-sync: scanning surfaces");
  for (const [k, v] of Object.entries(result.surfacesPresent)) {
    lines.push(`  ${v ? "found  " : "missing"} ${k}`);
  }
  if (result.findings.length === 0) {
    lines.push("");
    lines.push("deployment-sync: PASS (no drift detected)");
    return lines.join("\n");
  }
  lines.push("");
  lines.push(`deployment-sync: FAIL (${result.findings.length} issue(s))`);
  for (const f of result.findings) {
    lines.push("");
    lines.push(`  [${f.surface}]${f.field ? ` ${f.field}` : ""}: ${f.message}`);
    if (f.fix) {
      const indented = f.fix
        .split("\n")
        .map((l) => `      ${l}`)
        .join("\n");
      lines.push(`    fix:\n${indented}`);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv: string[]): CheckOptions {
  let root = process.cwd();
  let runTools = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path.resolve(argv[++i] ?? ".");
    } else if (a === "--no-tools") {
      runTools = false;
    }
  }
  return { root, runTools };
}

function isMain(): boolean {
  // tsx sets process.argv[1] to the script path.
  const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const here = path.resolve(import.meta.url.replace(/^file:\/\//, ""));
  return argv1 === here;
}

if (isMain()) {
  const opts = parseArgs(process.argv.slice(2));
  const result = checkDeploymentSync(opts);
  // eslint-disable-next-line no-console
  console.log(formatReport(result));
  // Non-blocking findings: pure missing-tool warnings should not fail
  // CI if the host doesn't have helm/kubeconform installed. We only
  // count actual drift findings.
  const blocking = result.findings.filter((f) => {
    if (f.surface !== "tools") return true;
    return !/binary not found in PATH/.test(f.message);
  });
  process.exit(blocking.length > 0 ? 1 : 0);
}
