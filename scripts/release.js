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
];

for (const file of packageFiles) {
  const path = resolve(file);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = newVersion;
  if (pkg.peerDependencies?.["@kryton/core"]) {
    pkg.peerDependencies["@kryton/core"] = newVersion;
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`bumped ${file} → ${newVersion}`);
}

exec("npm install");
exec(`git add ${packageFiles.join(" ")} package-lock.json`);
exec(`git commit -m "chore(release): v${newVersion}"`);
exec(`git tag v${newVersion}`);

console.log(`\nv${newVersion} ready. Push with: git push origin master --tags`);
