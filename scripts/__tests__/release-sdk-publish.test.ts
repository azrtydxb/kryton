import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { publishSdk } from "../release-sdk.js";

// publishSdk chooses the dist-tag from the SDK's own version: prereleases
// (a `-pre.N` suffix) publish under `next`, stable versions under `latest`.
// Mirror that here so the test stays correct as the SDK version changes.
const sdkVersion: string = JSON.parse(
  readFileSync(new URL("../../packages/sdk/package.json", import.meta.url), "utf8"),
).version;
const tag = sdkVersion.includes("-") ? "next" : "latest";

describe("release SDK publish step", () => {
  it("publishes @azrtydxb/kryton-sdk with --access public and the right dist-tag", async () => {
    const calls: string[] = [];
    const fakeExec = (cmd: string) => {
      calls.push(cmd);
      return "";
    };
    await publishSdk({ exec: fakeExec, dryRun: false });
    expect(calls).toContain(`npm publish --access public --tag ${tag} --workspace=packages/sdk`);
  });

  it("uses --dry-run when dryRun is true", async () => {
    const calls: string[] = [];
    const fakeExec = (cmd: string) => {
      calls.push(cmd);
      return "";
    };
    await publishSdk({ exec: fakeExec, dryRun: true });
    expect(calls).toContain(
      `npm publish --access public --tag ${tag} --dry-run --workspace=packages/sdk`,
    );
  });
});
