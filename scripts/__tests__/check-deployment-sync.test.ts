/**
 * Unit tests for the drift-prevention sync gate.
 *
 * Uses synthetic in-memory fixtures rather than the real repo artifacts
 * so each mismatch class is exercised in isolation.
 */
import { describe, expect, it } from "vitest";
import {
  type ConfigSchema,
  type HelmInputs,
  checkCompose,
  checkCrd,
  checkDeploymentSync,
  checkHelm,
  extractTemplateKeys,
  parseComposeEnv,
} from "../check-deployment-sync.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kryton-ws-d-"));
}

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const schema: ConfigSchema = {
  fields: [
    {
      name: "BETTER_AUTH_SECRET",
      type: "string",
      required: true,
      secret: true,
      userFacing: true,
    },
    {
      name: "APP_URL",
      type: "url",
      required: true,
      secret: false,
      userFacing: true,
      default: "http://localhost:3000",
    },
    {
      name: "LOG_LEVEL",
      type: "enum",
      required: false,
      secret: false,
      userFacing: false,
      default: "info",
      values: ["debug", "info", "warn", "error"],
    },
  ],
};

describe("parseComposeEnv", () => {
  it("parses list-form env block", () => {
    const env = parseComposeEnv({
      services: {
        kryton: {
          environment: ["FOO=bar", "BAZ=${BAZ:?}"],
        },
      },
    });
    expect(env).toEqual({ FOO: "bar", BAZ: "${BAZ:?}" });
  });

  it("parses map-form env block", () => {
    const env = parseComposeEnv({
      services: {
        kryton: {
          environment: { FOO: "bar", N: 42 },
        },
      },
    });
    expect(env).toEqual({ FOO: "bar", N: "42" });
  });

  it("returns undefined when kryton service is absent", () => {
    expect(parseComposeEnv({ services: { other: {} } })).toBeUndefined();
  });
});

describe("checkCompose", () => {
  it("passes when every schema field is present correctly", () => {
    const findings = checkCompose(schema, {
      services: {
        kryton: {
          environment: [
            "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET}",
            "APP_URL=${APP_URL:-http://localhost:3000}",
          ],
        },
      },
    });
    expect(findings).toEqual([]);
  });

  it("flags missing required secret", () => {
    const findings = checkCompose(schema, {
      services: {
        kryton: {
          environment: ["APP_URL=${APP_URL:-http://localhost:3000}"],
        },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe("BETTER_AUTH_SECRET");
    expect(findings[0].message).toContain("missing");
    expect(findings[0].fix).toContain("${BETTER_AUTH_SECRET:?");
  });

  it("flags secret used with a default interpolation", () => {
    const findings = checkCompose(schema, {
      services: {
        kryton: {
          environment: [
            "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-fallback}",
            "APP_URL=${APP_URL:-http://localhost:3000}",
          ],
        },
      },
    });
    // Two findings: not required-interp, and has-default-interp.
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.message.includes("required-interpolation"))).toBe(true);
  });

  it("flags orphan env keys not in schema", () => {
    const findings = checkCompose(schema, {
      services: {
        kryton: {
          environment: [
            "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?x}",
            "APP_URL=${APP_URL:-http://localhost:3000}",
            "MYSTERY=42",
          ],
        },
      },
    });
    expect(findings.some((f) => f.field === "MYSTERY")).toBe(true);
  });

  it("flags bare interpolation on required non-secret", () => {
    const findings = checkCompose(schema, {
      services: {
        kryton: {
          environment: [
            "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?x}",
            "APP_URL=${APP_URL}",
          ],
        },
      },
    });
    expect(findings.some((f) => f.field === "APP_URL")).toBe(true);
  });
});

describe("extractTemplateKeys", () => {
  it("finds .Values.env.KEY references", () => {
    const tpl = `
data:
  APP_URL: {{ .Values.env.APP_URL | quote }}
stringData:
  BETTER_AUTH_SECRET: {{ .Values.env.secret.BETTER_AUTH_SECRET | quote }}
`;
    const keys = extractTemplateKeys(tpl);
    expect(keys.has("APP_URL")).toBe(true);
    expect(keys.has("BETTER_AUTH_SECRET")).toBe(true);
  });
});

describe("checkHelm", () => {
  const baseInputs: HelmInputs = {
    values: {
      env: {
        APP_URL: "http://localhost:3000",
        secret: { BETTER_AUTH_SECRET: "" },
      },
    },
    valuesSchema: { properties: { env: {} } },
    configmapTemplate: `
data:
  APP_URL: {{ .Values.env.APP_URL | quote }}
`,
    secretTemplate: `
stringData:
  BETTER_AUTH_SECRET: {{ .Values.env.secret.BETTER_AUTH_SECRET | quote }}
`,
  };

  it("passes when secrets are in secret template and non-secrets in configmap", () => {
    expect(checkHelm(schema, baseInputs)).toEqual([]);
  });

  it("flags a secret leaked into configmap", () => {
    const findings = checkHelm(schema, {
      ...baseInputs,
      configmapTemplate: `
data:
  APP_URL: {{ .Values.env.APP_URL | quote }}
  BETTER_AUTH_SECRET: {{ .Values.env.BETTER_AUTH_SECRET | quote }}
`,
    });
    expect(findings.some((f) => f.field === "BETTER_AUTH_SECRET" && /configmap/.test(f.message))).toBe(true);
  });

  it("flags a required secret missing from secret template and values", () => {
    const findings = checkHelm(schema, {
      ...baseInputs,
      values: { env: { APP_URL: "http://localhost:3000" } },
      secretTemplate: "stringData: {}",
    });
    expect(findings.some((f) => f.field === "BETTER_AUTH_SECRET")).toBe(true);
  });

  it("flags a required non-secret missing from values and configmap", () => {
    const findings = checkHelm(schema, {
      ...baseInputs,
      values: { env: { secret: { BETTER_AUTH_SECRET: "" } } },
      configmapTemplate: "data: {}",
    });
    expect(findings.some((f) => f.field === "APP_URL")).toBe(true);
  });

  it("returns empty when chart inputs are absent (skip silently)", () => {
    expect(checkHelm(schema, {})).toEqual([]);
  });
});

describe("checkCrd", () => {
  const valuesSchema = {
    properties: { env: {}, ingress: {} },
  };

  it("passes when CRD spec.values has x-kubernetes-preserve-unknown-fields", () => {
    const findings = checkCrd(valuesSchema, {
      spec: {
        versions: [
          {
            schema: {
              openAPIV3Schema: {
                properties: {
                  spec: {
                    properties: {
                      values: { "x-kubernetes-preserve-unknown-fields": true },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });
    expect(findings).toEqual([]);
  });

  it("passes when CRD spec.values is a superset", () => {
    const findings = checkCrd(valuesSchema, {
      spec: {
        versions: [
          {
            schema: {
              openAPIV3Schema: {
                properties: {
                  spec: {
                    properties: {
                      values: {
                        properties: {
                          env: {},
                          ingress: {},
                          extra: {},
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });
    expect(findings).toEqual([]);
  });

  it("flags missing properties in CRD spec.values", () => {
    const findings = checkCrd(valuesSchema, {
      spec: {
        versions: [
          {
            schema: {
              openAPIV3Schema: {
                properties: {
                  spec: {
                    properties: { values: { properties: { env: {} } } },
                  },
                },
              },
            },
          },
        ],
      },
    });
    expect(findings.some((f) => f.field === "ingress")).toBe(true);
  });

  it("returns empty when either side is absent (skip silently)", () => {
    expect(checkCrd(undefined, undefined)).toEqual([]);
    expect(checkCrd(valuesSchema, undefined)).toEqual([]);
  });
});

describe("checkDeploymentSync (integration over fixture tree)", () => {
  it("skips silently when no artifacts present", () => {
    const root = tmpRepo();
    const result = checkDeploymentSync({ root, runTools: false });
    expect(result.findings).toEqual([]);
    expect(result.surfacesPresent.schema).toBe(false);
  });

  it("passes when compose matches schema (helm/crd absent)", () => {
    const root = tmpRepo();
    writeFile(
      root,
      "packages/server/config-schema.json",
      JSON.stringify(schema),
    );
    writeFile(
      root,
      "docker-compose.prod.yml",
      `services:
  kryton:
    environment:
      - BETTER_AUTH_SECRET=\${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET}
      - APP_URL=\${APP_URL:-http://localhost:3000}
`,
    );
    const result = checkDeploymentSync({ root, runTools: false });
    expect(result.findings).toEqual([]);
  });

  it("detects drift across surfaces", () => {
    const root = tmpRepo();
    writeFile(
      root,
      "packages/server/config-schema.json",
      JSON.stringify(schema),
    );
    writeFile(
      root,
      "docker-compose.prod.yml",
      `services:
  kryton:
    environment:
      - APP_URL=\${APP_URL:-http://localhost:3000}
`,
    );
    const result = checkDeploymentSync({ root, runTools: false });
    expect(result.findings.some((f) => f.field === "BETTER_AUTH_SECRET")).toBe(true);
  });
});
