import { describe, it, expect } from "vitest";
import { publishSdk } from "../release-sdk.js";

describe("release SDK publish step", () => {
  it("invokes npm publish with --access public for @azrtydxb/sdk", async () => {
    const calls: string[] = [];
    const fakeExec = (cmd: string) => {
      calls.push(cmd);
      return "";
    };
    await publishSdk({ exec: fakeExec, dryRun: false });
    expect(calls).toContain("npm publish --access public --workspace=packages/sdk");
  });

  it("uses --dry-run when dryRun is true", async () => {
    const calls: string[] = [];
    const fakeExec = (cmd: string) => {
      calls.push(cmd);
      return "";
    };
    await publishSdk({ exec: fakeExec, dryRun: true });
    expect(calls).toContain("npm publish --access public --dry-run --workspace=packages/sdk");
  });
});
