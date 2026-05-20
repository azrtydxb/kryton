# Synology SPK build

Build a Synology DSM package (`.spk`) that wraps the Kryton compose stack.
The SPK is glue: it ships `docker-compose.yml`, lifecycle hooks, and a DSM
install wizard. The real application runs from `${KRYTON_IMAGE}` (pulled
from GHCR by Container Manager on first start).

Phase 2 of `docs/design/nas-package-stores.md`. Phase 4 wires this build
into `release.yml` — until then, the build is operator-invoked via the
manual `nas-packages` workflow.

## Prerequisites

- Bash 4+
- `tar`, `gzip`, `file`, `sed`, `sha256sum`, `md5sum`
- `gpg` 2.x (only required if signing)
- Read access to `packaging/assets/icons/kryton-{72,256}.png`

On macOS, `sha256sum` / `md5sum` are not present by default — install via
`brew install coreutils md5sha1sum`, or run the build inside the same
`node:24` container CI uses.

## Build

```bash
export KRYTON_VERSION=1.4.2
export KRYTON_ARCH=x86_64           # or armv8
export KRYTON_IMAGE=ghcr.io/azrtydxb/kryton:1.4.2
export OUT_DIR=./build/synology

# Unsigned (testing only — DSM will warn the user):
./packaging/synology/build.sh

# Signed (production):
export GPG_KEY_ID=ABCDEF0123456789ABCDEF0123456789ABCDEF01
export GPG_KEYRING_DIR=/path/to/prepared/gnupg/homedir
./packaging/synology/build.sh
```

Output: `${OUT_DIR}/kryton_${KRYTON_VERSION}-0001_${KRYTON_ARCH}.spk`. The
script prints final size, sha256, and md5 to stdout — record these in the
feed renderer for Phase 4.

## Signed vs unsigned

| Mode | When | DSM behaviour |
| --- | --- | --- |
| Signed | Production releases | DSM verifies signature against keyring pulled from feed; no scary prompt |
| Unsigned | Local development, smoke tests | DSM shows "publisher could not be verified"; install only after explicit confirmation |

CI for `v*` tags must always sign. The smoke test (`build.test.sh`) deliberately
exercises the unsigned path so the script keeps working without secrets.

## Local install testing on a DSM VM

1. SSH into the DSM VM (`Control Panel → Terminal & SNMP → Enable SSH`).
2. `scp kryton_*.spk admin@dsm-vm:/tmp/`.
3. Package Center → "Manual Install" → upload the SPK from `/tmp/`.
4. Walk through the wizard; verify `wizard_*` env vars produce a valid
   `.env` at `/var/packages/kryton/target/.env` and matching data dirs
   under `/volume1/kryton/`.
5. `start-stop-status start` should bring up the compose stack; check
   `docker compose ps` and `tail /tmp/kryton-start.log`.

## Reading the build output

```
SPK: /tmp/spk-test/kryton_0.0.0-test-0001_x86_64.spk
size: 12345 bytes
sha256: <hex>
md5: <hex>
signed: yes (key=ABCDEF01...)
```

The `size` and `md5` lines are what the feed renderer consumes. Capture them
in `feed-config.json` under `spkSizes` and `spkMd5` so DSM has accurate
metadata.

## Smoke test

```bash
bash packaging/synology/build.test.sh
```

Builds an unsigned test SPK at `/tmp/spk-test/`, extracts it, and asserts
the layout + INFO + compose substitution. Trap auto-cleans `/tmp/spk-test`.

## See also

- `packaging/synology/keys/README.md` — GPG key generation, rotation, and
  revocation procedures.
- `docs/design/nas-package-stores.md` — full Phase plan.
