#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const expected = root.version;

const packages = [
  "packages/core/package.json",
  "packages/core-react/package.json",
  "packages/ui/package.json",
];

const mismatches = [];
for (const pkgPath of packages) {
  const pkg = JSON.parse(readFileSync(resolve(pkgPath), "utf8"));
  if (pkg.version !== expected) {
    mismatches.push({ pkgPath, name: pkg.name, version: pkg.version });
  }
}

if (mismatches.length > 0) {
  console.error(`Version mismatch: root is ${expected}.`);
  for (const m of mismatches) {
    console.error(`  ${m.name} (${m.pkgPath}) is ${m.version}`);
  }
  process.exit(1);
}

console.log(`All workspace versions match root: ${expected}`);
