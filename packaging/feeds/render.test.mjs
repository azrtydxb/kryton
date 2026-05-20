// Self-test for the feed renderer. Run with:
//   node --test packaging/feeds/render.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./render.mjs";

const FIXTURE = {
  version: "1.4.2",
  publishedDate: "2026-05-20",
  changelogUrl: "https://github.com/azrtydxb/kryton/releases/tag/v1.4.2",
  iconBaseUrl: "https://azrtydxb.github.io/kryton/assets/nas/icons",
  screenshotBaseUrl: "https://azrtydxb.github.io/kryton/assets/nas/screenshots",
  releaseAssetBaseUrl:
    "https://github.com/azrtydxb/kryton/releases/download/v1.4.2",
  synologyArchs: ["x86_64", "armv8"],
  qnapPlatforms: ["X86_64", "ARM_64"],
  spkSizes: { x86_64: 0, armv8: 0 },
  spkMd5: { x86_64: "", armv8: "" },
  qpkgSigs: { X86_64: null, ARM_64: null },
};

test("renders synology index.json with one entry per arch", async () => {
  const { indexJson } = await render(FIXTURE);
  const parsed = JSON.parse(indexJson);
  assert.equal(Array.isArray(parsed.packages), true);
  assert.equal(parsed.packages.length, 2);
  assert.deepEqual(parsed.keyrings, []);

  const archs = parsed.packages.map((p) => p.arch).sort();
  assert.deepEqual(archs, ["armv8", "x86_64"]);

  const x86 = parsed.packages.find((p) => p.arch === "x86_64");
  assert.equal(
    x86.link,
    "https://github.com/azrtydxb/kryton/releases/download/v1.4.2/kryton_1.4.2_x86_64.spk"
  );
  assert.equal(x86.depsers, "ContainerManager");
  assert.equal(x86.start, true);
  assert.equal(x86.thirdparty, true);
  assert.equal(x86.beta, false);
  assert.equal(x86.thumbnail.length, 2);
});

test("renders qnap packages.xml with expected items and locations", async () => {
  const { packagesXml } = await render(FIXTURE);
  assert.match(packagesXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(packagesXml, /<plugins>/);
  assert.match(packagesXml, /<\/plugins>\s*$/);

  // Exactly one <item> in Phase 1
  const itemCount = (packagesXml.match(/<item>/g) || []).length;
  assert.equal(itemCount, 1);

  // Two <platform> blocks (one per QNAP arch)
  const platformCount = (packagesXml.match(/<platform>/g) || []).length;
  assert.equal(platformCount, 2);

  // <cachechk> contains the unix timestamp for the publishedDate
  const expectedCachechk = String(
    Math.floor(Date.parse(FIXTURE.publishedDate) / 1000)
  );
  assert.ok(
    packagesXml.includes(`<cachechk>${expectedCachechk}</cachechk>`),
    "cachechk should match publishedDate timestamp"
  );

  // Expected <location> URLs for both QNAP platforms
  assert.ok(
    packagesXml.includes(
      "<location>https://github.com/azrtydxb/kryton/releases/download/v1.4.2/kryton_1.4.2_x86_64.qpkg</location>"
    ),
    "x86_64 qpkg URL must appear"
  );
  assert.ok(
    packagesXml.includes(
      "<location>https://github.com/azrtydxb/kryton/releases/download/v1.4.2/kryton_1.4.2_arm_64.qpkg</location>"
    ),
    "arm_64 qpkg URL must appear"
  );

  // Phase 1: no signatures yet
  assert.equal(packagesXml.includes("<signature>"), false);
});

test("output is deterministic (re-render produces identical bytes)", async () => {
  const a = await render(FIXTURE);
  const b = await render(FIXTURE);
  assert.equal(a.indexJson, b.indexJson);
  assert.equal(a.packagesXml, b.packagesXml);
});

test("output uses LF line endings", async () => {
  const { indexJson, packagesXml } = await render(FIXTURE);
  assert.equal(indexJson.includes("\r"), false);
  assert.equal(packagesXml.includes("\r"), false);
});

// --- Phase 4 extensions ----------------------------------------------------

const ARMORED_KEY =
  "-----BEGIN PGP PUBLIC KEY BLOCK-----\n" +
  "mDMEZkrytonBYJKwYBBAHaRw8BAQdAabcd1234fake==\n" +
  "-----END PGP PUBLIC KEY BLOCK-----\n";

const STRICT_FIXTURE = {
  ...FIXTURE,
  spkSizes: { x86_64: 12345, armv8: 23456 },
  spkMd5: {
    x86_64: "0123456789abcdef0123456789abcdef",
    armv8: "fedcba9876543210fedcba9876543210",
  },
  qpkgSigs: {
    X86_64:
      "https://github.com/azrtydxb/kryton/releases/download/v1.4.2/kryton_1.4.2_x86_64.qpkg.codesigning",
    ARM_64:
      "https://github.com/azrtydxb/kryton/releases/download/v1.4.2/kryton_1.4.2_arm_64.qpkg.codesigning",
  },
  synologyKeyring: ARMORED_KEY,
};

test("strict mode passes with full real-release values", async () => {
  const { indexJson, packagesXml } = await render(STRICT_FIXTURE, { strict: true });
  const parsed = JSON.parse(indexJson);
  const x86 = parsed.packages.find((p) => p.arch === "x86_64");
  assert.equal(x86.size, 12345);
  assert.equal(x86.md5, "0123456789abcdef0123456789abcdef");
  assert.equal(parsed.keyrings.length, 1);
  assert.equal(parsed.keyrings[0], ARMORED_KEY);

  // QPKG signatures appear as <signature> elements
  assert.match(packagesXml, /<signature>https:\/\/github\.com\/.*x86_64\.qpkg\.codesigning<\/signature>/);
  assert.match(packagesXml, /<signature>https:\/\/github\.com\/.*arm_64\.qpkg\.codesigning<\/signature>/);
});

test("strict mode rejects placeholder sizes", async () => {
  await assert.rejects(() => render(FIXTURE, { strict: true }), /spkSizes/);
});

test("strict mode rejects missing keyring", async () => {
  const noKey = { ...STRICT_FIXTURE };
  delete noKey.synologyKeyring;
  await assert.rejects(() => render(noKey, { strict: true }), /synologyKeyring/);
});

test("strict mode rejects empty qpkg signatures", async () => {
  const noSigs = { ...STRICT_FIXTURE, qpkgSigs: { X86_64: "", ARM_64: null } };
  await assert.rejects(() => render(noSigs, { strict: true }), /qpkgSigs/);
});

test("non-strict mode still accepts placeholder values (backwards compat)", async () => {
  // Original FIXTURE has size 0, empty md5, null sigs — must still render.
  const { indexJson, packagesXml } = await render(FIXTURE);
  const parsed = JSON.parse(indexJson);
  assert.equal(parsed.packages[0].size, 0);
  assert.deepEqual(parsed.keyrings, []);
  assert.equal(packagesXml.includes("<signature>"), false);
});

test("keyring is embedded when provided even without strict mode", async () => {
  const cfg = { ...FIXTURE, synologyKeyring: ARMORED_KEY };
  const { indexJson } = await render(cfg);
  const parsed = JSON.parse(indexJson);
  assert.equal(parsed.keyrings.length, 1);
  assert.equal(parsed.keyrings[0], ARMORED_KEY);
});
