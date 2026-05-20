#!/usr/bin/env node
// Renders the server's OpenAPI spec into a standalone HTML page via Redocly.
// If the spec isn't on disk, log a warning and exit 0 — don't break the build.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "..");
const repoRoot = resolve(siteRoot, "..");

const candidates = [
  resolve(repoRoot, "packages/server/openapi.json"),
  resolve(repoRoot, "packages/server/dist/openapi.json"),
  resolve(repoRoot, "packages/server/openapi.snapshot.json"),
];

let specPath = null;
for (const c of candidates) {
  if (existsSync(c)) {
    specPath = c;
    break;
  }
}

const outFile = resolve(siteRoot, "public/api/rest.html");
const wrapperFile = resolve(
  siteRoot,
  "src/content/docs/advanced/api/rest.md",
);

if (!specPath) {
  console.warn(
    `[gen:rest] OpenAPI JSON not found in any of: ${candidates.join(", ")}.`,
  );
  console.warn(
    "[gen:rest] Skipping REST reference generation (build will continue).",
  );
  console.warn(
    "[gen:rest] To populate: run the server's openapi dump, or commit packages/server/openapi.json.",
  );
  process.exit(0);
}

mkdirSync(dirname(outFile), { recursive: true });

console.log(`[gen:rest] rendering ${specPath} -> ${outFile}`);
const res = spawnSync(
  "npx",
  ["--yes", "@redocly/cli", "build-docs", specPath, "--output", outFile],
  { stdio: "inherit", cwd: siteRoot },
);
if (res.status !== 0) {
  console.error(`[gen:rest] redocly build-docs exited ${res.status}`);
  process.exit(res.status ?? 1);
}

// Write/update the Starlight wrapper page that points at the static HTML.
const baseHref = "/kryton/api/rest.html";
const wrapper = `---
title: REST API
description: Full OpenAPI reference for the Kryton server's REST API.
---

> Generated from \`packages/server/openapi.snapshot.json\` via Redocly. Re-run via \`npm run gen:rest\`.

The complete REST reference is rendered as a standalone Redoc page.

<p><a href="${baseHref}" target="_blank" rel="noopener">Open the full REST reference in a new tab →</a></p>

<iframe
  src="${baseHref}"
  title="Kryton REST API reference"
  style="width: 100%; height: 80vh; border: 1px solid var(--sl-color-hairline); border-radius: 8px;"
></iframe>
`;

mkdirSync(dirname(wrapperFile), { recursive: true });
writeFileSync(wrapperFile, wrapper);
console.log(`[gen:rest] wrote wrapper ${wrapperFile}`);
