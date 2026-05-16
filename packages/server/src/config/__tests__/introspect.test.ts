/**
 * Unit tests for the env-schema introspector + dumper. Covers:
 *   - type mapping (string / number / boolean / enum)
 *   - default + optional + transform wrapping
 *   - secret / userFacing / description round-trip
 *   - dumper serializes with sorted per-field keys and trailing newline
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withMeta } from "../meta.js";
import { introspectField, introspectSchema, serializeSchema } from "../introspect.js";
import { envSchema } from "../env.js";

const serialize = (): string => serializeSchema(envSchema);

describe("introspectField", () => {
  it("maps a plain string with default to type:string + default", () => {
    const f = introspectField(
      "FOO",
      withMeta(z.string().default("bar"), {
        secret: false,
        userFacing: true,
        description: "foo",
      }),
    );
    expect(f).toMatchObject({
      name: "FOO",
      type: "string",
      required: false,
      secret: false,
      userFacing: true,
      default: "bar",
      description: "foo",
    });
    expect(f.values).toBeUndefined();
  });

  it("maps z.coerce.number().int().positive().default(N) to type:number", () => {
    const f = introspectField(
      "PORT",
      withMeta(z.coerce.number().int().positive().default(3001), {
        secret: false,
        userFacing: true,
      }),
    );
    expect(f.type).toBe("number");
    expect(f.required).toBe(false);
    expect(f.default).toBe(3001);
  });

  it("maps z.boolean() to type:boolean", () => {
    const f = introspectField(
      "FLAG",
      withMeta(z.boolean(), { secret: false, userFacing: true }),
    );
    expect(f.type).toBe("boolean");
    expect(f.required).toBe(true);
  });

  it("maps z.enum(...) with default to type:enum + values", () => {
    const f = introspectField(
      "LEVEL",
      withMeta(z.enum(["info", "debug", "trace"]).default("info"), {
        secret: false,
        userFacing: false,
      }),
    );
    expect(f.type).toBe("enum");
    expect(f.values).toEqual(["info", "debug", "trace"]);
    expect(f.default).toBe("info");
    expect(f.required).toBe(false);
  });

  it("marks .optional() fields as not required and emits no default", () => {
    const f = introspectField(
      "MAYBE",
      withMeta(z.string().optional(), { secret: false, userFacing: true }),
    );
    expect(f.required).toBe(false);
    expect("default" in f).toBe(false);
  });

  it("marks fields with neither default nor optional as required", () => {
    const f = introspectField(
      "MUST",
      withMeta(z.string().min(32), { secret: true, userFacing: true }),
    );
    expect(f.required).toBe(true);
    expect(f.secret).toBe(true);
  });

  it("unwraps .transform() (pipe) to expose the input-side type + default", () => {
    const f = introspectField(
      "BOOL_STR",
      withMeta(
        z
          .string()
          .default("true")
          .transform((s) => s !== "false"),
        { secret: false, userFacing: false },
      ),
    );
    expect(f.type).toBe("string");
    expect(f.default).toBe("true");
    expect(f.required).toBe(false);
  });

  it("throws when a field has no withMeta annotation", () => {
    expect(() => introspectField("NAKED", z.string())).toThrow(/no deployment metadata/);
  });
});

describe("introspectSchema", () => {
  it("preserves declaration order of fields", () => {
    const schema = z.object({
      Z: withMeta(z.string().default("z"), { secret: false, userFacing: false }),
      A: withMeta(z.string().default("a"), { secret: false, userFacing: false }),
      M: withMeta(z.string().default("m"), { secret: false, userFacing: false }),
    });
    const desc = introspectSchema(schema);
    expect(desc.fields.map((f) => f.name)).toEqual(["Z", "A", "M"]);
  });
});

describe("dump-config-schema serialize", () => {
  it("emits valid JSON ending with a trailing newline", () => {
    const out = serialize();
    expect(out.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("emits per-field keys in sorted order", () => {
    const out = serialize();
    const parsed = JSON.parse(out) as { fields: Record<string, unknown>[] };
    for (const field of parsed.fields) {
      const keys = Object.keys(field);
      const sorted = [...keys].sort();
      expect(keys).toEqual(sorted);
    }
  });

  it("includes the audited env vars from the real schema", () => {
    const parsed = JSON.parse(serialize()) as {
      fields: { name: string; secret: boolean; type: string }[];
    };
    const names = parsed.fields.map((f) => f.name);
    expect(names).toContain("NODE_ENV");
    expect(names).toContain("BETTER_AUTH_SECRET");
    expect(names).toContain("POSTGRES_URL");
    // Sanity: secret-classification audit holds.
    const secret = parsed.fields.find((f) => f.name === "BETTER_AUTH_SECRET")!;
    expect(secret.secret).toBe(true);
    const port = parsed.fields.find((f) => f.name === "PORT")!;
    expect(port.type).toBe("number");
    expect(port.secret).toBe(false);
    const oauthId = parsed.fields.find((f) => f.name === "GOOGLE_CLIENT_ID")!;
    expect(oauthId.secret).toBe(false);
    const oauthSecret = parsed.fields.find((f) => f.name === "GOOGLE_CLIENT_SECRET")!;
    expect(oauthSecret.secret).toBe(true);
  });
});
