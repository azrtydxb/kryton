# packaging/

Templates, feed renderer, and assets for the Kryton self-hosted NAS
package sources (Synology Package Center + QNAP App Center).

See the design document for full architecture, decisions, and phasing:

- `kryton/docs/design/nas-package-stores.md`

## Layout

```
packaging/
├── README.md                  # this file
├── synology/
│   ├── INFO.tmpl              # SPK manifest template
│   └── .gitkeep               # Phase 2: build.sh, scripts/, WIZARD_UIFILES/, keys/
├── qnap/
│   ├── qpkg.cfg.tmpl          # QPKG config template
│   └── .gitkeep               # Phase 3: build.sh, shared/, package_routines, icons/
├── feeds/
│   ├── index.json.tmpl        # Synology feed template (DSM Package Center)
│   ├── packages.xml.tmpl      # QNAP feed template (QTS App Center)
│   ├── render.mjs             # renderer (Node 24, no deps) → site/public/
│   └── render.test.mjs        # node --test self-test
└── assets/
    ├── icons/                 # PNGs at 72/80/100/120/256 (from logos/kryton_icon.svg)
    └── screenshots/           # Phase 5: real screenshots
```

## Phase 1 scope (this commit)

- Templates + renderer + a manual-dispatch workflow that renders
  `site/public/synology/index.json` and `site/public/qnap/packages.xml`.
- No real `.spk` / `.qpkg` artifacts are produced in Phase 1.
- Feed entries reference release URLs that Phase 2/3 will populate; size,
  md5, and signature fields are zero/empty/null placeholders until Phase 4
  wires the renderer into `release.yml`.

## Rendering feeds locally

```sh
node packaging/feeds/render.mjs --config <path-to-config.json>
node --test packaging/feeds/render.test.mjs
```

The renderer writes deterministic output (stable key order, 2-space JSON
indent, LF line endings). Output paths are fixed:

- `site/public/synology/index.json`
- `site/public/qnap/packages.xml`

Both files pass through `site/` (Astro 6.3 + Starlight) into `site/dist/`
unchanged — see Phase 0 in the design doc.

## Phase 3 scope (QPKG build)

`packaging/qnap/` now ships a deterministic build script (`build.sh`), a
POSIX-sh service script (`source-template/shared/kryton.sh`), QNAP
lifecycle hooks (`source-template/package_routines`), and an operator
runbook for the X.509 code-signing cert (`keys/README.md`). See
`packaging/qnap/README.md` for build commands, signing flow, and QTS VM
testing notes.
