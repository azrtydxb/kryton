#!/usr/bin/env node
// Generates TypeDoc markdown for the plugin client API (from the
// kryton-plugins repo) and the plugin server API (from this repo). Both
// outputs land in the Starlight content tree and overwrite their previous
// generation. Adds Starlight frontmatter to every emitted .md file.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "..");
const repoRoot = resolve(siteRoot, "..");

const PLUGINS_REPO_DIR = "/tmp/kryton-plugins-docs";
const PLUGINS_REPO_URL = "https://github.com/azrtydxb/kryton-plugins.git";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${res.status ?? "(null)"}`,
    );
  }
}

function ensurePluginsRepo() {
  if (!existsSync(PLUGINS_REPO_DIR)) {
    console.log(`[gen:plugin-api] cloning ${PLUGINS_REPO_URL} -> ${PLUGINS_REPO_DIR}`);
    run("git", ["clone", "--depth=1", PLUGINS_REPO_URL, PLUGINS_REPO_DIR]);
    return;
  }
  console.log(`[gen:plugin-api] updating ${PLUGINS_REPO_DIR}`);
  try {
    run("git", ["-C", PLUGINS_REPO_DIR, "fetch", "--depth=1", "origin"]);
    run("git", ["-C", PLUGINS_REPO_DIR, "reset", "--hard", "origin/HEAD"]);
  } catch (err) {
    console.warn(
      `[gen:plugin-api] fetch failed (${err.message}); using existing checkout`,
    );
  }
}

function locateClientEntry() {
  const candidates = [
    join(PLUGINS_REPO_DIR, "types/client.d.ts"),
    join(PLUGINS_REPO_DIR, "packages/types/client.d.ts"),
    join(PLUGINS_REPO_DIR, "types/index.d.ts"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function locateServerEntry() {
  const candidates = [
    resolve(repoRoot, "packages/server/src/plugins/types.ts"),
    resolve(
      repoRoot,
      "packages/server/src/modules/plugins/services/types.ts",
    ),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function runTypeDoc({ entry, outDir, name }) {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });

  // Write a throwaway tsconfig that explicitly includes the entry point.
  const tsconfigPath = resolve(siteRoot, `.typedoc-${name}.tsconfig.json`);
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      allowJs: false,
      declaration: true,
      types: [],
    },
    include: [entry],
  };
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

  console.log(`[gen:plugin-api] typedoc (${name}): ${entry} -> ${outDir}`);
  try {
    run(
      "npx",
      [
        "--yes",
        "typedoc",
        "--plugin",
        "typedoc-plugin-markdown",
        "--tsconfig",
        tsconfigPath,
        "--out",
        outDir,
        "--readme",
        "none",
        "--hideBreadcrumbs",
        "--excludeExternals",
        "--githubPages",
        "false",
        "--skipErrorChecking",
        entry,
      ],
      { cwd: siteRoot },
    );
  } finally {
    if (existsSync(tsconfigPath)) rmSync(tsconfigPath, { force: true });
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function titleize(filePath, outDir) {
  const rel = relative(outDir, filePath).replace(/\\/g, "/");
  if (rel === "README.md" || rel === "index.md") return "Overview";
  const base = rel.replace(/\.md$/, "");
  const last = base.split("/").pop() || base;
  return last.replace(/^[A-Z]/, (c) => c) || last;
}

function addFrontmatter(outDir, sectionTitle) {
  if (!existsSync(outDir)) return 0;
  let count = 0;
  for (const file of walk(outDir)) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(file, "utf8");
    if (raw.startsWith("---\n")) continue;
    const title = titleize(file, outDir);
    const fm = [
      "---",
      `title: ${JSON.stringify(title)}`,
      `description: ${JSON.stringify(`${sectionTitle} (auto-generated reference).`)}`,
      "---",
      "",
    ].join("\n");
    writeFileSync(file, fm + raw);
    count++;
  }
  // Rename README.md to index.md if present (so Starlight slug is the folder).
  for (const file of walk(outDir)) {
    if (file.endsWith("/README.md")) {
      const idx = file.replace(/README\.md$/, "index.md");
      if (!existsSync(idx)) {
        const content = readFileSync(file, "utf8");
        writeFileSync(idx, content);
        rmSync(file);
      }
    }
  }
  return count;
}

function removePlaceholder(p) {
  if (existsSync(p)) {
    rmSync(p, { force: true });
    console.log(`[gen:plugin-api] removed placeholder ${p}`);
  }
}

async function main() {
  // Remove flat placeholders so directories can own the slugs.
  removePlaceholder(
    resolve(siteRoot, "src/content/docs/advanced/plugins/client-api.md"),
  );
  removePlaceholder(
    resolve(siteRoot, "src/content/docs/advanced/plugins/server-api.md"),
  );

  ensurePluginsRepo();

  const clientEntry = locateClientEntry();
  const clientOut = resolve(
    siteRoot,
    "src/content/docs/advanced/plugins/client-api",
  );
  if (clientEntry) {
    runTypeDoc({ entry: clientEntry, outDir: clientOut, name: "client" });
    const n = addFrontmatter(clientOut, "Plugin client API");
    console.log(`[gen:plugin-api] client-api: added frontmatter to ${n} files`);
  } else {
    console.warn(
      "[gen:plugin-api] could not find kryton-plugins client.d.ts entry; skipping client API",
    );
  }

  const serverEntry = locateServerEntry();
  const serverOut = resolve(
    siteRoot,
    "src/content/docs/advanced/plugins/server-api",
  );
  if (serverEntry) {
    runTypeDoc({ entry: serverEntry, outDir: serverOut, name: "server" });
    const n = addFrontmatter(serverOut, "Plugin server API");
    console.log(`[gen:plugin-api] server-api: added frontmatter to ${n} files`);
  } else {
    console.warn(
      "[gen:plugin-api] could not find server-side plugin types; skipping server API",
    );
  }
}

main().catch((err) => {
  console.error(`[gen:plugin-api] ${err.message}`);
  process.exit(1);
});
