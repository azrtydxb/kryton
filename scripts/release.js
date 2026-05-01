#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

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

const packageFiles = [
  "package.json",
  "packages/core/package.json",
  "packages/core-react/package.json",
  "packages/ui/package.json",
];

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
  console.log(`bumped ${file} → ${newVersion}`);
}

const sourceConstantUpdates = [
  { file: "packages/core/src/index.ts", name: "KRYTON_CORE_VERSION" },
  { file: "packages/core-react/src/index.ts", name: "KRYTON_CORE_REACT_VERSION" },
];
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
exec(`git add ${packageFiles.join(" ")} ${sourceFiles.join(" ")} package-lock.json`);
exec(`git commit -m "chore(release): v${newVersion}"`);
exec(`git tag v${newVersion}`);

console.log(`\nv${newVersion} ready. Push with: git push origin master --tags`);
