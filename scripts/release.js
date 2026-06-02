#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { publishSdk } from "./release-sdk.js";

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+(-\w+(\.\d+)?)?$/.test(newVersion)) {
  console.error("Usage: node scripts/release.js <version>");
  console.error("Example: node scripts/release.js 4.4.0");
  process.exit(1);
}

function exec(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const dirty = exec("git status --porcelain");
if (dirty) {
  console.error("Working tree is dirty. Commit or stash first.");
  process.exit(1);
}

const branch = exec("git rev-parse --abbrev-ref HEAD");
if (branch !== "master") {
  console.error(`Releases must be cut from master. Current branch: ${branch}`);
  process.exit(1);
}

// Some packages here (packages/core, packages/core-react) were removed by
// later refactors; skip any path that no longer exists rather than fail.
const packageFiles = [
  "package.json",
  "packages/core/package.json",
  "packages/core-react/package.json",
  "packages/ui/package.json",
  // The SDK is published to npm by the release step below, so its version must
  // track the release tag (otherwise it would publish a stale version).
  "packages/sdk/package.json",
].filter((f) => existsSync(resolve(f)));

const bumpedPackageFiles = [];
for (const file of packageFiles) {
  const path = resolve(file);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = newVersion;
  if (pkg.peerDependencies?.["@azrtydxb/core"]) {
    pkg.peerDependencies["@azrtydxb/core"] = newVersion;
  }
  if (pkg.peerDependencies?.["@azrtydxb/core-react"]) {
    pkg.peerDependencies["@azrtydxb/core-react"] = newVersion;
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  bumpedPackageFiles.push(file);
  console.log(`bumped ${file} → ${newVersion}`);
}

// Workspace consumers pin internal `@azrtydxb/*` packages to exact versions.
// Now that those packages are bumped above, sync every such pin to the new
// version so the `npm install` below resolves to the local workspace packages
// rather than trying to fetch the old (unpublished) versions from the registry.
const internalDepConsumers = ["packages/client/package.json", "packages/server/package.json"].filter(
  (f) => existsSync(resolve(f)),
);
for (const file of internalDepConsumers) {
  const path = resolve(file);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      // Only retarget exact internal pins (e.g. "4.6.5-pre.10"); leave ranges
      // and "workspace:*" / "*" specifiers alone.
      if (name.startsWith("@azrtydxb/") && /^\d/.test(deps[name]) && deps[name] !== newVersion) {
        deps[name] = newVersion;
        changed = true;
      }
    }
  }
  if (changed) {
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
    bumpedPackageFiles.push(file);
    console.log(`synced internal @azrtydxb/* deps in ${file} → ${newVersion}`);
  }
}

const sourceConstantUpdates = [
  { file: "packages/core/src/index.ts", name: "KRYTON_CORE_VERSION" },
  { file: "packages/core-react/src/index.ts", name: "KRYTON_CORE_REACT_VERSION" },
].filter(({ file }) => existsSync(resolve(file)));
const sourceFiles = [];
for (const { file, name } of sourceConstantUpdates) {
  const path = resolve(file);
  const src = readFileSync(path, "utf8");
  const updated = src.replace(
    new RegExp(`export const ${name} = "[^"]+";`),
    `export const ${name} = "${newVersion}";`,
  );
  if (updated !== src) {
    writeFileSync(path, updated);
    sourceFiles.push(file);
    console.log(`updated ${file} ${name} → ${newVersion}`);
  }
}

exec("npm install");
exec(`git add ${bumpedPackageFiles.join(" ")} ${sourceFiles.join(" ")} package-lock.json`);
exec(`git commit -m "chore(release): v${newVersion}"`);
exec(`git tag v${newVersion}`);

// Publish @azrtydxb/sdk to public npm.
const dryRun = process.argv.includes("--dry-run");
await publishSdk({ dryRun });
console.log(`✓ Published @azrtydxb/sdk`);

console.log(`\nv${newVersion} ready. Push with: git push origin master --tags`);
