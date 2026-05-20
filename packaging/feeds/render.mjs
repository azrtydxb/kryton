#!/usr/bin/env node
// Renders Synology and QNAP NAS feed files from templates.
//
// Inputs : JSON config (stdin or --config <path>)
// Outputs: site/public/synology/index.json
//          site/public/qnap/packages.xml
//
// Deterministic: stable key order, 2-space JSON indent, LF line endings.
// No npm dependencies — Node 24 built-ins only.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// --- helpers --------------------------------------------------------------

function xmlEscape(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// Stable key order for JSON.stringify by passing a custom replacer that
// rebuilds objects with sorted-but-actually-specified key order.
function orderedStringify(value, indent = 2) {
  return JSON.stringify(value, null, indent).replaceAll("\r\n", "\n");
}

// Ordered factories: explicit construction guarantees field order in output.

function synologyEntry(cfg, arch) {
  // Per design doc, this is the exact field set/order DSM expects.
  const obj = {};
  obj.package = "kryton";
  obj.version = cfg.version;
  obj.dname = "Kryton";
  obj.desc =
    "Local-first notes & knowledge base with real-time collaboration.";
  obj.price = 0;
  obj.download_count = 0;
  obj.recent_download_count = 0;
  obj.link = `${cfg.releaseAssetBaseUrl}/kryton_${cfg.version}_${arch}.spk`;
  obj.size = cfg.spkSizes?.[arch] ?? 0;
  obj.md5 = cfg.spkMd5?.[arch] ?? "";
  obj.thumbnail = [
    `${cfg.iconBaseUrl}/kryton-72.png`,
    `${cfg.iconBaseUrl}/kryton-120.png`,
  ];
  obj.snapshot = [`${cfg.screenshotBaseUrl}/editor.png`];
  obj.qinst = false;
  obj.qupgrade = false;
  obj.qstart = false;
  obj.depsers = "ContainerManager";
  obj.deppkgs = "ContainerManager";
  obj.conflictpkgs = "";
  obj.start = true;
  obj.maintainer = "Kryton";
  obj.maintainer_url = "https://kryton.app";
  obj.distributor = "Kryton";
  obj.distributor_url = "https://kryton.app";
  obj.changelog = cfg.changelogUrl;
  obj.thirdparty = true;
  obj.category = 0;
  obj.subcategory = 0;
  obj.type = 0;
  obj.silent_install = false;
  obj.silent_uninstall = false;
  obj.silent_upgrade = false;
  obj.beta = false;
  obj.arch = arch;
  return obj;
}

function qnapItemXml(cfg) {
  // Phase 1: a single <item> with one <platform> per QNAP arch.
  const platforms = cfg.qnapPlatforms
    .map((pid) => {
      const archSlug = pid === "X86_64" ? "x86_64" : "arm_64";
      const loc = `${cfg.releaseAssetBaseUrl}/kryton_${cfg.version}_${archSlug}.qpkg`;
      const sig = cfg.qpkgSigs?.[pid] ?? null;
      const sigEl = sig
        ? `      <signature>${xmlEscape(sig)}</signature>\n`
        : "";
      return [
        "    <platform>",
        `      <platformID>${xmlEscape(pid)}</platformID>`,
        `      <location>${xmlEscape(loc)}</location>`,
        sigEl ? sigEl.trimEnd() : null,
        "    </platform>",
      ]
        .filter((l) => l !== null)
        .join("\n");
    })
    .join("\n");

  const lines = [
    "  <item>",
    `    <name>Kryton</name>`,
    `    <internalName>kryton</internalName>`,
    `    <category>Productivity</category>`,
    `    <type>QPKG</type>`,
    `    <changeLog>${xmlEscape(cfg.changelogUrl)}</changeLog>`,
    `    <version>${xmlEscape(cfg.version)}</version>`,
    `    <description>${xmlEscape(
      "Local-first notes & knowledge base with real-time collaboration."
    )}</description>`,
    `    <maintainer>Kryton</maintainer>`,
    `    <developer>Kryton</developer>`,
    `    <forumLink>https://github.com/azrtydxb/kryton/discussions</forumLink>`,
    `    <publishedDate>${xmlEscape(cfg.publishedDate)}</publishedDate>`,
    `    <icon80>${xmlEscape(cfg.iconBaseUrl)}/kryton-80.png</icon80>`,
    `    <icon100>${xmlEscape(cfg.iconBaseUrl)}/kryton-100.png</icon100>`,
    `    <language>English</language>`,
    `    <fwVersion>5.0.0</fwVersion>`,
    `    <tutorialLink>https://kryton.ai/docs/install/qnap</tutorialLink>`,
    `    <bannerImg>${xmlEscape(cfg.screenshotBaseUrl)}/banner.png</bannerImg>`,
    `    <snapshot>${xmlEscape(cfg.screenshotBaseUrl)}/editor.png</snapshot>`,
    platforms,
    "  </item>",
  ];
  return lines.join("\n");
}

// --- main render ---------------------------------------------------------

// Strict-mode validation: required real-release values.
//
// Used by release.yml (Phase 4) so a misconfigured release cannot silently
// emit a feed with zero sizes / empty md5 / no signatures. Manual-dispatch
// (nas-packages.yml) continues to call render without --strict for smoke
// testing with placeholders.
function validateStrict(cfg) {
  const problems = [];
  for (const arch of cfg.synologyArchs) {
    const sz = cfg.spkSizes?.[arch];
    if (!Number.isInteger(sz) || sz <= 0) {
      problems.push(`spkSizes.${arch} must be a positive integer (got ${sz})`);
    }
    const md5 = cfg.spkMd5?.[arch];
    if (typeof md5 !== "string" || !/^[a-f0-9]{32}$/i.test(md5)) {
      problems.push(`spkMd5.${arch} must be a 32-char hex string (got ${JSON.stringify(md5)})`);
    }
  }
  // Keyring is required in strict mode iff at least one SPK was actually
  // signed; we can't introspect that here, so require it unconditionally:
  // an unsigned release should not ship via the strict path.
  if (typeof cfg.synologyKeyring !== "string" || cfg.synologyKeyring.trim() === "") {
    problems.push("synologyKeyring must be a non-empty ASCII-armored public key");
  }
  // qpkgSigs: strict mode requires each platform entry to be a non-empty
  // URL string. (Some platforms may legitimately ship unsigned, but for
  // v1 we sign both — enforce.)
  for (const pid of cfg.qnapPlatforms) {
    const sig = cfg.qpkgSigs?.[pid];
    if (typeof sig !== "string" || sig.trim() === "") {
      problems.push(`qpkgSigs.${pid} must be a non-empty URL (got ${JSON.stringify(sig)})`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      "render.mjs --strict validation failed:\n  - " + problems.join("\n  - ")
    );
  }
}

async function render(cfg, { strict = false } = {}) {
  if (strict) validateStrict(cfg);

  const indexTmpl = await readFile(
    join(HERE, "index.json.tmpl"),
    "utf8"
  );
  const xmlTmpl = await readFile(
    join(HERE, "packages.xml.tmpl"),
    "utf8"
  );

  // Synology: one entry per arch.
  const packages = cfg.synologyArchs.map((a) => synologyEntry(cfg, a));
  // Phase 4: embed the GPG public key into the `keyrings` array when the
  // release job supplies one. Backwards-compatible: missing key → [].
  const keyrings =
    typeof cfg.synologyKeyring === "string" && cfg.synologyKeyring.trim() !== ""
      ? [cfg.synologyKeyring]
      : [];

  // Substitute tokens. The template is a JSON shell with two named tokens.
  const packagesJson = orderedStringify(packages, 2);
  const keyringsJson = orderedStringify(keyrings, 2);

  // Indent inner blocks by 2 spaces to keep the outer object valid 2-space
  // pretty-printed JSON.
  const indent = (s, n) =>
    s
      .split("\n")
      .map((line, i) => (i === 0 ? line : " ".repeat(n) + line))
      .join("\n");

  const indexJson =
    indexTmpl
      .replace("__PACKAGES_JSON__", indent(packagesJson, 2))
      .replace("__KEYRINGS_JSON__", indent(keyringsJson, 2))
      .replaceAll("\r\n", "\n")
      .trimEnd() + "\n";

  // Sanity: it must parse.
  JSON.parse(indexJson);

  // QNAP
  const cachechk = String(Math.floor(Date.parse(cfg.publishedDate) / 1000));
  const itemsXml = qnapItemXml(cfg);
  const packagesXml =
    xmlTmpl
      .replace("{{CACHECHK}}", cachechk)
      .replace("__ITEMS_XML__", itemsXml)
      .replaceAll("\r\n", "\n")
      .trimEnd() + "\n";

  return { indexJson, packagesXml };
}

// --- CLI -----------------------------------------------------------------

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "out-dir": { type: "string" },
      strict: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(
      "Usage: render.mjs --config <path> [--dry-run] [--strict] [--out-dir <dir>]\n" +
        "       cat config.json | render.mjs [--dry-run] [--strict] [--out-dir <dir>]\n"
    );
    return;
  }

  const raw = values.config
    ? await readFile(values.config, "utf8")
    : await readStdin();
  const cfg = JSON.parse(raw);

  const { indexJson, packagesXml } = await render(cfg, { strict: values.strict });

  if (values["dry-run"]) {
    process.stdout.write("=== synology/index.json ===\n");
    process.stdout.write(indexJson);
    process.stdout.write("\n=== qnap/packages.xml ===\n");
    process.stdout.write(packagesXml);
    return;
  }

  const outRoot = values["out-dir"]
    ? resolve(values["out-dir"])
    : join(REPO_ROOT, "site", "public");
  const synDir = join(outRoot, "synology");
  const qnapDir = join(outRoot, "qnap");
  await mkdir(synDir, { recursive: true });
  await mkdir(qnapDir, { recursive: true });
  await writeFile(join(synDir, "index.json"), indexJson, "utf8");
  await writeFile(join(qnapDir, "packages.xml"), packagesXml, "utf8");

  process.stdout.write(`wrote ${join(synDir, "index.json")}\n`);
  process.stdout.write(`wrote ${join(qnapDir, "packages.xml")}\n`);
}

// Export for tests
export { render };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(String(err?.stack || err) + "\n");
    process.exit(1);
  });
}
