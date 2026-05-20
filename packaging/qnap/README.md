# Kryton QPKG (QNAP App Center package)

Phase 3 of `docs/design/nas-package-stores.md`. Produces a `.qpkg` wrapping
Kryton's `docker-compose.prod.yml`. Container Station is the runtime; the
QPKG itself is glue (lifecycle scripts + manifest).

## Layout

```
packaging/qnap/
├── README.md                 # this file
├── build.sh                  # bash, deterministic, signs last
├── build.test.sh             # smoke test (no signing creds needed)
├── qpkg.cfg.tmpl             # manifest template (Phase 1)
├── keys/                     # operator runbook only — private key never committed
│   ├── README.md
│   ├── .gitignore
│   └── .gitkeep
└── source-template/
    ├── package_routines      # install/uninstall hooks, POSIX sh
    ├── icons/                # populated at build time from packaging/assets/icons/
    └── shared/
        ├── kryton.sh         # service control: start|stop|restart|status|log|remove
        ├── docker-compose.yml
        ├── .env.template
        └── README.txt
```

## Prerequisites

- bash 4+ (build.sh)
- curl, ar, tar, gzip (qbuild bootstrap)
- openssl (signing + verify)
- file, sha256sum/shasum, md5sum/md5 (reporting)
- ImageMagick (`magick` or `convert`) for the grayscale icon — optional;
  build.sh falls back to a colour copy with a warning when absent.
- Docker is **not** required to build the QPKG (only to test the resulting
  compose on a NAS).

`qbuild` itself is fetched on demand by `build.sh` from
[`github.com/qnap-dev/QDK`](https://github.com/qnap-dev/QDK). Default pin is
`QDK_VERSION=v2.5.0`. The `.deb` is extracted via `ar` + `tar`, so no `dpkg`
is needed and the build works on macOS too.

## Building

Unsigned (development / smoke):

```sh
KRYTON_VERSION=1.4.2 \
KRYTON_PLATFORM=X86_64 \
KRYTON_IMAGE=ghcr.io/azrtydxb/kryton/kryton:1.4.2 \
OUT_DIR=/tmp/kryton-qpkg \
bash packaging/qnap/build.sh
```

Signed:

```sh
KRYTON_VERSION=1.4.2 \
KRYTON_PLATFORM=X86_64 \
KRYTON_IMAGE=ghcr.io/azrtydxb/kryton/kryton:1.4.2 \
OUT_DIR=/tmp/kryton-qpkg \
QPKG_SIGNING_CERT=/path/to/kryton-codesign.crt \
QPKG_SIGNING_KEY=/path/to/kryton-codesign.key \
bash packaging/qnap/build.sh
```

Output: `kryton_<ver>_<arch_lower>.qpkg` plus optional
`kryton_<ver>_<arch_lower>.qpkg.codesigning`.

## Signed vs unsigned

The QPKG itself contains no signature in either case — `qbuild --sign` is GPG
signing, which is not what the design doc specifies. Code signing in App
Center is a separate sibling file (`<qpkg>.codesigning`) that the feed XML
references via its `<signature>` element. `build.sh` produces this file
directly with `openssl cms -sign -outform DER` over the QPKG bytes when both
`QPKG_SIGNING_CERT` and `QPKG_SIGNING_KEY` are provided.

See `keys/README.md` for cert generation and rotation. The private key is
**never** committed; CI consumes it via the `QNAP_CODESIGN_KEY` secret.

## Testing on a QTS VM

QNAP publishes a QTS 5.x VM image
(<https://www.qnap.com/en/download?model=ts-x53>). Boot the VM, install
Container Station from the App Center, then:

1. App Center → cog → App Repository → Add → point at a local HTTPS server
   serving a single-entry `packages.xml` that links to your built QPKG.
2. Or: App Center → cog → Install Manually → upload the `.qpkg` directly.
3. Verify Kryton starts (`/etc/init.d/kryton.sh status`) and the web UI is
   reachable at `http://<nas>:3000/`.
4. Uninstall → confirm the data directory at
   `/share/<volume>/Kryton/` is left intact.

Manual verification is the gate before tagging a release in Phase 4. CI
cannot exercise the App Center install path.

## Determinism

Same `(KRYTON_VERSION, KRYTON_PLATFORM, KRYTON_IMAGE, source-template
contents)` produces a byte-identical `.qpkg` payload. The signature, if any,
is computed last and verified afterwards. CI uploads both files as a single
artifact.
