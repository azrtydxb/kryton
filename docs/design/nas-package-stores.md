# NAS Package Stores — Self-Hosted Source for Synology & QNAP

## Status

Draft — awaiting approval before implementation.

## Goal

Let users install Kryton on a Synology or QNAP NAS from the device's native app
store (Package Center / App Center), with auto-update on every `v*` release,
**without** relying on SynoCommunity, Qnapclub.eu, or any partnership with the
NAS vendors.

We publish our own package source from the Kryton GitHub repository. Users add
one URL per NAS once; new releases appear automatically.

## Non-goals

- Submission to the official Synology Package Center or QNAP Store (both
  require vendor partnership; out of scope).
- Submission to SynoCommunity / Qnapclub.eu (possible later as an additional
  distribution channel; not blocking).
- Native (non-Docker) builds. Kryton on NAS runs the existing server image via
  the device's container runtime — we ship a thin SPK/QPKG that wraps
  `docker-compose.prod.yml`.

## Architecture overview

```
   v* tag push
        │
        ▼
  release.yml ── builds ──▶ kryton_<ver>_<arch>.spk      ┐
                         ▶ kryton_<ver>_<arch>.qpkg     │
                                                         │  upload as
                                                         │  GitHub Release
                                                         │  assets
                                                         ▼
                                      github.com/<org>/kryton/releases/...
                                                         ▲
                                                         │  redirects
                                                         │  followed by
                                                         │  DSM / QTS
                                                         │
   release.yml ── renders feeds ──▶ commits to master    │
                                    site/public/synology/index.json
                                    site/public/qnap/packages.xml
                                            │
                                            ▼  triggers pages.yml (path filter)
                                            │
                            existing Pages deploy
        ┌──────────────────────────────────────────────┐
        │  https://azrtydxb.github.io/kryton/                          │  (docs — UNCHANGED)
        │  https://azrtydxb.github.io/kryton/start/                    │  (docs — UNCHANGED)
        │  https://azrtydxb.github.io/kryton/synology                  │─┐
        │  https://azrtydxb.github.io/kryton/qnap/packages.xml         │─┤
        │  https://azrtydxb.github.io/kryton/assets/nas/icons/*.png    │ │
        └──────────────────────────────────────────────┘ │
                                                         │  HTTPS GET
                          ┌──────────────────────────────┴──────────────────┐
                          │                                                  │
                 Synology DSM                                         QNAP QTS
                 (Package Center)                                  (App Center)
```

Critically: there is no separate `gh-pages` branch. The existing
`.github/workflows/pages.yml` builds `site/dist` and deploys it as the Pages
artifact, serving the docs site at `https://azrtydxb.github.io/kryton/` (custom domain).
Package-source feeds are emitted into `site/public/{synology,qnap}/` so they
ship inside the **same** Pages artifact as the docs — docs and feeds live on
one origin, one TLS cert, one deploy. The docs build must not strip
unrecognised files from `site/public/`; this is verified in Phase 1.

Release artifacts (SPK, QPKG) live on GitHub Releases (CDN-backed, no Pages
storage limits). Only the feed JSON/XML and icon PNGs sit on Pages.

## URLs

| Purpose | URL |
| --- | --- |
| Synology source (user adds this) | `https://azrtydxb.github.io/kryton/synology/index.json` |
| QNAP source (user adds this) | `https://azrtydxb.github.io/kryton/qnap/packages.xml` |
| Synology install guide | `https://azrtydxb.github.io/kryton/docs/install/synology` |
| QNAP install guide | `https://azrtydxb.github.io/kryton/docs/install/qnap` |

The Pages site serves at `https://azrtydxb.github.io/kryton/`. A future custom-domain switch (e.g. moving to `kryton.ai`) only changes the public host — the path layout under `site/public/` is identical. The feed
endpoints live as additional paths under that same origin. No new DNS or
CNAME is required.

There is no dedicated landing page at the feed URLs — humans land on the
install guides in the docs instead.

## Synology feed schema

DSM Package Center POSTs to the source URL with form fields describing the NAS
(arch, DSM major version, language, etc.) and expects a JSON response. For a
static feed we ignore the POST body and return the full catalog; DSM
client-side filters on `arch` and `firmware`.

`/synology/index.json`:

```jsonc
{
  "packages": [
    {
      "package": "kryton",
      "version": "1.4.2-0001",
      "dname": "Kryton",
      "desc": "Local-first notes & knowledge base with real-time collaboration.",
      "price": 0,
      "download_count": 0,
      "recent_download_count": 0,
      "link": "https://github.com/<org>/kryton/releases/download/v1.4.2/kryton_1.4.2-0001_x86_64.spk",
      "size": 0,
      "md5": "<computed at release time>",
      "thumbnail": [
        "https://azrtydxb.github.io/kryton/assets/nas/icons/kryton-72.png",
        "https://azrtydxb.github.io/kryton/assets/nas/icons/kryton-120.png"
      ],
      "snapshot": [
        "https://azrtydxb.github.io/kryton/assets/nas/screenshots/editor.png"
      ],
      "qinst": false,
      "qupgrade": false,
      "qstart": false,
      "depsers": "ContainerManager",
      "deppkgs": "ContainerManager",
      "conflictpkgs": "",
      "start": true,
      "maintainer": "Kryton",
      "maintainer_url": "https://kryton.app",
      "distributor": "Kryton",
      "distributor_url": "https://kryton.app",
      "changelog": "See https://github.com/<org>/kryton/releases/tag/v1.4.2",
      "thirdparty": true,
      "category": 0,
      "subcategory": 0,
      "type": 0,
      "silent_install": false,
      "silent_uninstall": false,
      "silent_upgrade": false,
      "beta": false
    }
    // …one entry per (arch, dsm_min) variant
  ],
  "keyrings": []
}
```

Per-arch variants ship as separate entries with different `link` and `arch`
strings (DSM filters using a top-level `arch` field on each entry).

**Supported architectures (v1): `x86_64` and `armv8` only.**

Rationale: Kryton runs as a Docker container; the wrapping SPK is identical
across CPU families. `x86_64` covers all Intel/AMD Synology models from the
last decade; `armv8` covers all 64-bit ARM models (DS220+, DS224+, RS422+,
etc.). Older 32-bit ARM models are end-of-life and not targeted. Additional
arch variants can be added later by extending the build matrix — they reuse
the same template, same SPK contents, just a different manifest field.

> **Note:** DSM versions <7.2 do not have "Container Manager" — they have
> "Docker." We target DSM ≥ 7.2 (`firmware: "7.2-64570"`) only. Older DSMs
> are unsupported in v1.

## QNAP feed schema

QTS App Center GETs the source URL and parses an XML document. Per-package
entries are siblings under `<plugins>`.

`/qnap/packages.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plugins>
  <cachechk>1716200000</cachechk>
  <item>
    <name>Kryton</name>
    <internalName>kryton</internalName>
    <category>Productivity</category>
    <type>QPKG</type>
    <changeLog>https://github.com/&lt;org&gt;/kryton/releases/tag/v1.4.2</changeLog>
    <version>1.4.2</version>
    <description>Local-first notes &amp; knowledge base with real-time collaboration.</description>
    <maintainer>Kryton</maintainer>
    <developer>Kryton</developer>
    <forumLink>https://github.com/&lt;org&gt;/kryton/discussions</forumLink>
    <publishedDate>2026-05-20</publishedDate>
    <icon80>https://azrtydxb.github.io/kryton/assets/nas/icons/kryton-80.png</icon80>
    <icon100>https://azrtydxb.github.io/kryton/assets/nas/icons/kryton-100.png</icon100>
    <language>English</language>
    <fwVersion>5.0.0</fwVersion>
    <tutorialLink>https://azrtydxb.github.io/kryton/docs/install/qnap</tutorialLink>
    <bannerImg>https://azrtydxb.github.io/kryton/assets/nas/screenshots/banner.png</bannerImg>
    <snapshot>https://azrtydxb.github.io/kryton/assets/nas/screenshots/editor.png</snapshot>
    <platform>
      <platformID>X86_64</platformID>
      <location>https://github.com/&lt;org&gt;/kryton/releases/download/v1.4.2/kryton_1.4.2_x86_64.qpkg</location>
      <signature>https://github.com/&lt;org&gt;/kryton/releases/download/v1.4.2/kryton_1.4.2_x86_64.qpkg.codesigning</signature>
    </platform>
    <platform>
      <platformID>ARM_64</platformID>
      <location>https://github.com/&lt;org&gt;/kryton/releases/download/v1.4.2/kryton_1.4.2_arm_64.qpkg</location>
    </platform>
  </item>
</plugins>
```

Supported `platformID`s in v1: `X86_64`, `ARM_64`. (32-bit ARM QNAPs are
end-of-life and not targeted.)

## SPK package layout (Synology)

Built with [`spksrc`](https://github.com/SynoCommunity/spksrc) cross-toolchain
or hand-rolled (the format is just a tarball — for a Docker-wrapper package we
do not need spksrc's cross-compile machinery).

```
kryton-spk/
├── INFO                     # generated from INFO.tmpl at release time
├── package.tgz              # tarred contents of `package/`
├── scripts/
│   ├── start-stop-status    # docker compose up/down/ps
│   ├── installer            # pre/post install hooks (create data dir, port check)
│   ├── preinst
│   ├── postinst
│   ├── preuninst
│   └── postuninst
├── conf/
│   ├── resource             # declares shared folders, ports, firewall rules
│   └── privilege            # runs as `kryton` user, not root
├── WIZARD_UIFILES/
│   ├── install_uifile       # admin email/password, port, data path prompts
│   └── upgrade_uifile
└── package/
    ├── docker-compose.yml   # pinned to ghcr.io/<org>/kryton:<version>
    ├── .env.template
    └── ui/                  # static page DSM embeds for the app tile
```

`start-stop-status` shells out to `/usr/local/bin/docker compose` (the path
Container Manager exposes). All real lifting happens in the existing
`docker-compose.prod.yml` — the SPK is glue.

## QPKG package layout (QNAP)

Built with [`QDK`](https://github.com/qnap-dev/QDK) (`qbuild`).

```
kryton-qpkg/
├── qpkg.cfg                 # name, version, deps, web UI port
├── package_routines         # not used (we override in shared/)
├── icons/
│   ├── kryton.gif
│   ├── kryton_80.gif
│   └── kryton_gray.gif
├── shared/
│   ├── kryton.sh            # start/stop/restart/status (docker compose)
│   ├── docker-compose.yml
│   └── .env.template
└── package_routines         # hooks: install/uninstall/start/stop
```

`qpkg.cfg` declares `QPKG_REQUIRE="ContainerStation >= 3.0.0"` so App Center
refuses to install on a NAS without Container Station, and offers to install
it first.

## Data and configuration

Both packages need to decide where Kryton's persistent state lives. Synology
exposes shared-folder selection through `WIZARD_UIFILES`; QNAP does the same
through the `qpkg.cfg` `QPKG_VOLUME_REQUIRED` field. Default:

- Synology: `/volume1/kryton/{data,notes,postgres}`
- QNAP: `/share/<default volume>/Kryton/{data,notes,postgres}`

The compose file `bind`-mounts these. Upgrades preserve the directory; uninstall
asks (per the platform's standard uninstall dialog) whether to keep data.

## Release workflow integration

New `release.yml` jobs, added after `manifest` (server image is the input):

```
manifest ──┬── package-spk    ──┐
           └── package-qpkg   ──┤
                                ▼
                       upload-release-assets
                                │
                                ▼
                       publish-feeds   (commits to gh-pages)
```

- `package-spk` runs a matrix over Synology archs, templates `INFO`, calls
  `tar` to build `kryton_<ver>_<arch>.spk`, computes md5 + size, emits a JSON
  fragment per variant.
- `package-qpkg` runs `qbuild` for `x86_64` and `arm_64`, emits one QPKG each.
- `upload-release-assets` uses `gh release upload` against the `v*` tag.
- `publish-feeds` collects the per-variant JSON fragments, renders
  `index.json` and `packages.xml` from templates, and pushes to `gh-pages`.

The existing `mirror` job (mirrors to `harbor.kw.local`) is unaffected.

GHCR is the canonical image source for NAS installs — we do **not** point NAS
users at the internal zot. The compose file inside SPK/QPKG references
`ghcr.io/<org>/kryton:<version>`.

## User installation flow

**Synology:**

1. Package Center → Settings → Package Sources → Add → `https://packages.kryton.app/synology`
2. Community tab → Kryton → Install
3. Wizard: pick volume, admin email, port (default 3000), accept EULA
4. Container Manager auto-installed if missing
5. Kryton tile appears in DSM main menu, opens `http://<nas>:3000/`

**QNAP:**

1. App Center → cog → App Repository → Add → `https://packages.kryton.app/qnap/packages.xml`
2. Browse new repo → Kryton → Install
3. Container Station auto-installed if missing
4. Kryton tile appears, opens `http://<nas>:3000/`

## Security & signing

Both formats are signed from v1.

**Synology — GPG signing of SPKs:**

- A `kryton-packaging` GPG key (RSA 4096, no expiry, dedicated to package
  signing — never reused for git commits or releases) is generated once and
  the **private** half stored as a GitHub Actions secret
  (`SYNOLOGY_SIGNING_KEY`) plus passphrase (`SYNOLOGY_SIGNING_PASSPHRASE`).
- Public key is committed at `packaging/synology/keys/kryton.gpg` and
  rendered into the feed's top-level `keyrings` array.
- `build.sh` runs `gpg --detach-sign --armor` over `package.tgz` and embeds
  the signature as `syno_signature.asc` inside the SPK.
- DSM Package Center automatically verifies the signature against the keyring
  it pulled from our source URL. No "untrusted publisher" prompt for users.
- Key rotation procedure documented in `packaging/synology/keys/README.md`
  (regenerate, append new key to `keyrings` while keeping old key listed for
  one release cycle, then drop old key).

**QNAP — code signing via QDK:**

- QDK's `--sign` flag uses an X.509 code-signing key. We generate a
  self-signed cert (`CN=Kryton Packaging`, 10-year validity), store it as
  `QNAP_CODESIGN_CERT` + `QNAP_CODESIGN_KEY` secrets.
- `qbuild --sign` produces `kryton_<ver>_<arch>.qpkg` plus a sibling
  `kryton_<ver>_<arch>.qpkg.codesigning` containing the signature.
- Feed entries reference both files via `<location>` and `<signature>` (see
  XML schema above). App Center verifies on install.
- Self-signed is acceptable for QPKG signing — App Center surfaces the cert
  fingerprint to the user but does not require a public CA chain.

Feed and asset URLs are HTTPS-only (Pages enforces HSTS). Release assets on
GHCR / GitHub Releases are also HTTPS-only with TLS pinning at the CDN edge.

## Decisions (locked)

1. **Hosting** — feeds served from existing Pages site (`https://azrtydxb.github.io/kryton/`) as
   additional paths under `site/public/`. No separate domain, no `gh-pages`
   branch, no disruption to `https://azrtydxb.github.io/kryton/start/` /
   `https://azrtydxb.github.io/kryton/start/`.
2. **DSM 7.0 / 7.1** — dropped. v1 requires DSM ≥ 7.2 (Container Manager).
3. **Architectures** — v1 ships `x86_64` and `armv8` (Synology) plus
   `X86_64` and `ARM_64` (QNAP). Additional archs deferred.
4. **Signing** — v1 ships signed: GPG for SPKs, X.509 code-signing for QPKGs.
5. **Landing page** — none. Install guides live at
   `https://azrtydxb.github.io/kryton/docs/install/synology` and `.../qnap`, written as part
   of Phase 5.

## Phased implementation

> Per project workflow, implementation is split into phases with parallel
> agents. Phases are sequenced; tasks within a phase run in parallel.

**Phase 0 — Site integration probe (DONE)**

Verified `site/public/` passes through unmodified to `site/dist/`. Site is
Astro 6.3 + Starlight 0.39. The `base: "/kryton"` config in
`astro.config.mjs` affects HTML routing only; `public/` files land at the
custom domain root (`https://azrtydxb.github.io/kryton/<path>`). No content hashing, no
extension filtering, no HTML rewriting on passthrough. Pagefind ignores
non-HTML; sitemap output uses `sitemap-*.xml` so no collision with NAS feed
paths.

Confirmed output paths:

- `site/public/synology/index.json` → `https://azrtydxb.github.io/kryton/synology/index.json`
- `site/public/qnap/packages.xml`   → `https://azrtydxb.github.io/kryton/qnap/packages.xml`
- `site/public/assets/nas/icons/*`  → `https://azrtydxb.github.io/kryton/assets/nas/icons/*`

**Phase 1 — Skeleton & feeds (no real packages yet)**

- Create `packaging/synology/INFO.tmpl`, `packaging/qnap/qpkg.cfg.tmpl`
- Create `packaging/feeds/{index.json.tmpl,packages.xml.tmpl}`
- Create `packaging/assets/{icons,screenshots}/` (sourced from `kryton/logos/`)
- Wire feed renderer to write into `site/public/{synology,qnap}/` and
  `site/public/assets/nas/`
- New workflow `.github/workflows/nas-packages.yml` (manual trigger first,
  renders feed files only, commits to master under `site/public/...`, which
  triggers `pages.yml` via existing path filter)

**Phase 2 — SPK build + signing**

- `packaging/synology/build.sh` — templates INFO, tars `package.tgz`,
  GPG-signs, emits SPK
- `packaging/synology/scripts/{start-stop-status,installer,pre*,post*}`
- `packaging/synology/WIZARD_UIFILES/install_uifile` (port, volume, admin)
- Generate `kryton-packaging` GPG key, commit public key to
  `packaging/synology/keys/kryton.gpg`, store private + passphrase as
  Actions secrets, document rotation in `packaging/synology/keys/README.md`
- Inject public key into rendered `index.json` `keyrings` array
- Install-test on a real DSM 7.2 VM (manual): signature must verify

**Phase 3 — QPKG build + signing**

- `packaging/qnap/build.sh` — wraps `qbuild --sign`
- `packaging/qnap/shared/kryton.sh` lifecycle script
- `packaging/qnap/package_routines` hooks
- Generate `Kryton Packaging` self-signed code-signing cert, store as
  Actions secrets, document rotation
- Install-test on a real QTS 5.x VM (manual): signature must verify

**Phase 4 — Release wiring**

- Add `package-spk`, `package-qpkg`, `upload-release-assets`, `publish-feeds`
  jobs to `release.yml`
- Cut `v<next>-pre.1` tag, validate end-to-end against both NAS VMs
- Verify Package Center / App Center upgrade flow from `pre.1` → `pre.2`

**Phase 5 — Docs**

- `site/` pages: `docs/install/synology.md`, `docs/install/qnap.md` —
  copy-paste source URL, screenshots of "Add Package Source" / "Add App
  Repository", post-install steps
- Link both from existing install index in the docs site
- Mention in top-level `README.md` install section
