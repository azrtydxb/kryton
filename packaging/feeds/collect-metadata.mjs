#!/usr/bin/env node
// Phase 4 helper: builds the renderer config JSON from per-arch metadata
// emitted by the nas-build-spk / nas-build-qpkg jobs in release.yml.
//
// Inputs (all under a single directory passed via --meta-dir):
//   spk-meta-<arch>/spk-meta-<arch>.json
//     { arch, filename, size, md5 }
//   qpkg-meta-<platform>/qpkg-meta-<platform>.json
//     { platform, filename, size, md5, has_signature }
//   synology-pubkey/kryton.gpg     (optional, ASCII-armored)
//
// Plus the standard environment values:
//   --version    Kryton version (e.g. "1.4.2")
//   --repo       GitHub "owner/repo"  (e.g. "azrtydxb/kryton")
//   --pub-date   YYYY-MM-DD
//   --meta-dir   directory holding the *-meta-* subdirs (download-artifact root)
//   --out        write config JSON to this path (omit → stdout)
//
// Output: JSON suitable for `render.mjs --strict --config <out>`.

import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    repo: { type: "string" },
    "pub-date": { type: "string" },
    "meta-dir": { type: "string" },
    out: { type: "string" },
  },
  allowPositionals: false,
});

function die(msg) {
  process.stderr.write(`collect-metadata: ${msg}\n`);
  process.exit(1);
}

for (const k of ["version", "repo", "pub-date", "meta-dir"]) {
  if (!values[k]) die(`--${k} is required`);
}

const VERSION = values.version;
const REPO = values.repo;
const PUB_DATE = values["pub-date"];
const META_DIR = values["meta-dir"];

async function readJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// Walk META_DIR for spk-meta-*/spk-meta-*.json and qpkg-meta-*/qpkg-meta-*.json.
// download-artifact@v4 with pattern: "spk-meta-*" lays out one dir per artifact.
const entries = await readdir(META_DIR, { withFileTypes: true });

const spkMeta = {}; // arch → {filename,size,md5}
const qpkgMeta = {}; // platform → {filename,size,md5,has_signature}

for (const ent of entries) {
  if (!ent.isDirectory()) continue;
  const dir = join(META_DIR, ent.name);
  if (ent.name.startsWith("spk-meta-")) {
    // expected: spk-meta-<arch>/spk-meta-<arch>.json
    const arch = ent.name.slice("spk-meta-".length);
    const file = join(dir, `spk-meta-${arch}.json`);
    if (!(await exists(file))) die(`missing ${file}`);
    spkMeta[arch] = await readJson(file);
  } else if (ent.name.startsWith("qpkg-meta-")) {
    const platform = ent.name.slice("qpkg-meta-".length);
    const file = join(dir, `qpkg-meta-${platform}.json`);
    if (!(await exists(file))) die(`missing ${file}`);
    qpkgMeta[platform] = await readJson(file);
  }
}

const synologyArchs = Object.keys(spkMeta).sort();
const qnapPlatforms = Object.keys(qpkgMeta).sort();

if (synologyArchs.length === 0) die("no spk-meta-* artifacts found");
if (qnapPlatforms.length === 0) die("no qpkg-meta-* artifacts found");

const spkSizes = {};
const spkMd5 = {};
const spkFilenames = {};
for (const arch of synologyArchs) {
  spkSizes[arch] = spkMeta[arch].size;
  spkMd5[arch] = spkMeta[arch].md5;
  spkFilenames[arch] = spkMeta[arch].filename;
}

// QPKG signatures appear as the sibling .codesigning file URL on the
// GitHub Release. The build job emits has_signature=true when build.sh
// actually produced the .codesigning sibling.
const qpkgSigs = {};
const releaseBase = `https://github.com/${REPO}/releases/download/v${VERSION}`;
for (const pid of qnapPlatforms) {
  const m = qpkgMeta[pid];
  qpkgSigs[pid] = m.has_signature ? `${releaseBase}/${m.filename}.codesigning` : null;
}

// Optional synology public keyring (ASCII-armored).
let synologyKeyring = null;
const pubkeyDir = join(META_DIR, "synology-pubkey");
if (await exists(pubkeyDir)) {
  for (const f of await readdir(pubkeyDir)) {
    if (f.endsWith(".gpg") || f.endsWith(".asc") || f === "kryton.gpg") {
      synologyKeyring = await readFile(join(pubkeyDir, f), "utf8");
      break;
    }
  }
}

const cfg = {
  version: VERSION,
  publishedDate: PUB_DATE,
  changelogUrl: `https://github.com/${REPO}/releases/tag/v${VERSION}`,
  iconBaseUrl: "https://azrtydxb.github.io/kryton/assets/nas/icons",
  screenshotBaseUrl: "https://azrtydxb.github.io/kryton/assets/nas/screenshots",
  releaseAssetBaseUrl: releaseBase,
  synologyArchs,
  qnapPlatforms,
  spkSizes,
  spkMd5,
  spkFilenames,
  qpkgSigs,
  ...(synologyKeyring ? { synologyKeyring } : {}),
};

const json = JSON.stringify(cfg, null, 2) + "\n";
if (values.out) {
  await writeFile(values.out, json, "utf8");
  process.stderr.write(`wrote ${values.out}\n`);
} else {
  process.stdout.write(json);
}
