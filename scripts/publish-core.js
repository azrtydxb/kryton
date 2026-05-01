#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function exec(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { encoding: "utf8", stdio: "inherit", ...opts });
}

const dryRun = process.argv.includes("--dry-run");
const root = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const isPrerelease = root.version.includes("-");
const tagFlag = isPrerelease ? "--tag next" : "";

console.log("Step 1/5: verify versions match");
exec("node scripts/verify-versions.js");

console.log("Step 2/5: build core packages");
exec("npm run build:core");

console.log("Step 3/5: typecheck and test");
exec("npm run typecheck --workspace=packages/core --workspace=packages/core-react");
exec("npm run test:core");

console.log(`Step 4/5: publish (version=${root.version}, prerelease=${isPrerelease}${tagFlag ? `, tag=${tagFlag}` : ""})`);
const baseCmd = `npm publish --workspace=packages/core --workspace=packages/core-react --workspace=packages/ui ${tagFlag}`.trim();
const publishCmd = dryRun ? `${baseCmd} --dry-run` : baseCmd;
exec(publishCmd);

console.log(dryRun ? "Dry run complete." : "Publish complete.");
