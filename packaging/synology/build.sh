#!/usr/bin/env bash
#
# Build a (optionally signed) Synology SPK wrapping the Kryton compose stack.
#
# Required env vars:
#   KRYTON_VERSION   e.g. 1.4.2
#   KRYTON_ARCH      one of: x86_64, armv8
#   KRYTON_IMAGE     e.g. ghcr.io/azrtydxb/kryton:1.4.2
#   OUT_DIR          directory where the final .spk is dropped
#
# Optional env vars:
#   GPG_KEY_ID       sign with this key (skipped if unset; build is unsigned)
#   GPG_KEYRING_DIR  path to a pre-imported gnupg homedir (used iff GPG_KEY_ID set)
#
# Phase 2 of docs/design/nas-package-stores.md — Phase 4 will wire this into
# release.yml. Determinism note: same inputs produce a byte-identical SPK
# except for the embedded GPG signature, which is non-deterministic by design.

set -euo pipefail

fail() {
  printf 'BUILD FAILED: %s\n' "$1" >&2
  exit 1
}

# ---- validate inputs -------------------------------------------------------

: "${KRYTON_VERSION:?BUILD FAILED: KRYTON_VERSION not set}"
: "${KRYTON_ARCH:?BUILD FAILED: KRYTON_ARCH not set}"
: "${KRYTON_IMAGE:?BUILD FAILED: KRYTON_IMAGE not set}"
: "${OUT_DIR:?BUILD FAILED: OUT_DIR not set}"

case "$KRYTON_ARCH" in
  x86_64|armv8) ;;
  *) fail "KRYTON_ARCH must be x86_64 or armv8 (got: $KRYTON_ARCH)" ;;
esac

for bin in tar gzip file sha256sum md5sum sed cp mkdir; do
  command -v "$bin" >/dev/null 2>&1 || fail "required tool not found: $bin"
done

# Detect tar flavor — GNU tar supports --mtime / --owner / --group for
# deterministic output; bsdtar (macOS default) does not. CI runs GNU tar
# inside node:24, so determinism flags are active there. On bsdtar we fall
# back to a tar invocation without those flags (still produces a valid SPK,
# just not byte-identical across hosts).
if tar --version 2>/dev/null | head -1 | grep -qi 'gnu tar'; then
  TAR_DETERMINISTIC=1
else
  TAR_DETERMINISTIC=0
fi

if [ -n "${GPG_KEY_ID:-}" ]; then
  command -v gpg >/dev/null 2>&1 || fail "GPG_KEY_ID set but gpg binary not found"
  : "${GPG_KEYRING_DIR:?BUILD FAILED: GPG_KEY_ID set but GPG_KEYRING_DIR not set}"
  [ -d "$GPG_KEYRING_DIR" ] || fail "GPG_KEYRING_DIR does not exist: $GPG_KEYRING_DIR"
fi

# ---- locate sources --------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ICONS_DIR="$REPO_ROOT/packaging/assets/icons"

[ -f "$SCRIPT_DIR/INFO.tmpl" ] || fail "missing $SCRIPT_DIR/INFO.tmpl"
[ -d "$SCRIPT_DIR/package" ] || fail "missing $SCRIPT_DIR/package"
[ -d "$SCRIPT_DIR/scripts" ] || fail "missing $SCRIPT_DIR/scripts"
[ -d "$SCRIPT_DIR/conf" ] || fail "missing $SCRIPT_DIR/conf"
[ -d "$SCRIPT_DIR/WIZARD_UIFILES" ] || fail "missing $SCRIPT_DIR/WIZARD_UIFILES"
[ -f "$SCRIPT_DIR/LICENSE" ] || fail "missing $SCRIPT_DIR/LICENSE"
[ -f "$ICONS_DIR/kryton-72.png" ] || fail "missing $ICONS_DIR/kryton-72.png"
[ -f "$ICONS_DIR/kryton-256.png" ] || fail "missing $ICONS_DIR/kryton-256.png"

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# ---- stage -----------------------------------------------------------------

STAGE="$(mktemp -d -t kryton-spk.XXXXXX)"
PKG_STAGE="$(mktemp -d -t kryton-spk-pkg.XXXXXX)"
trap 'rm -rf "$STAGE" "$PKG_STAGE"' EXIT

# Constants pinned by spec.
FIRMWARE="7.2-64570"
MAINTAINER="Kryton"
DISPLAY_NAME="Kryton"
PACKAGE_ID="kryton"
DESCRIPTION="Local-first notes & knowledge base with real-time collaboration."

# ---- package/ payload (gets tarred into package.tgz) ----------------------

cp -R "$SCRIPT_DIR/package/." "$PKG_STAGE/"

# Substitute ${KRYTON_IMAGE} placeholder in the compose file. The compose file
# in the repo uses a literal __KRYTON_IMAGE__ token so the source-tree file is
# itself not a runnable compose unless built through this script.
if [ ! -f "$PKG_STAGE/docker-compose.yml" ]; then
  fail "package/docker-compose.yml missing after stage"
fi
sed -i.bak "s|__KRYTON_IMAGE__|${KRYTON_IMAGE}|g" "$PKG_STAGE/docker-compose.yml"
rm -f "$PKG_STAGE/docker-compose.yml.bak"

# Deterministic tar where possible: sorted file list, fixed mtime/owner.
(
  cd "$PKG_STAGE"
  if [ "$TAR_DETERMINISTIC" = "1" ]; then
    # shellcheck disable=SC2046
    find . -mindepth 1 -print0 \
      | LC_ALL=C sort -z \
      | tar --null --no-recursion -T - \
            --mtime='2020-01-01 00:00:00 UTC' \
            --owner=0 --group=0 --numeric-owner \
            -cf - \
      | gzip -n > "$STAGE/package.tgz"
  else
    tar -cf - . | gzip -n > "$STAGE/package.tgz"
  fi
)

# ---- INFO ------------------------------------------------------------------

# Escape ampersand for sed replacement.
esc() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }

sed \
  -e "s/{{VERSION}}/$(esc "${KRYTON_VERSION}-0001")/g" \
  -e "s/{{ARCH}}/$(esc "$KRYTON_ARCH")/g" \
  -e "s/{{FIRMWARE}}/$(esc "$FIRMWARE")/g" \
  -e "s/{{MAINTAINER}}/$(esc "$MAINTAINER")/g" \
  -e "s/{{DESCRIPTION}}/$(esc "$DESCRIPTION")/g" \
  -e "s/{{DISPLAY_NAME}}/$(esc "$DISPLAY_NAME")/g" \
  -e "s/{{PACKAGE_ID}}/$(esc "$PACKAGE_ID")/g" \
  "$SCRIPT_DIR/INFO.tmpl" > "$STAGE/INFO"

# Convert to LF line endings just in case.
sed -i.bak 's/\r$//' "$STAGE/INFO" && rm -f "$STAGE/INFO.bak"

# ---- icons -----------------------------------------------------------------

cp "$ICONS_DIR/kryton-72.png"  "$STAGE/PACKAGE_ICON.PNG"
cp "$ICONS_DIR/kryton-256.png" "$STAGE/PACKAGE_ICON_256.PNG"

# ---- scripts/ conf/ WIZARD_UIFILES/ LICENSE --------------------------------

cp -R "$SCRIPT_DIR/scripts"          "$STAGE/scripts"
cp -R "$SCRIPT_DIR/conf"             "$STAGE/conf"
cp -R "$SCRIPT_DIR/WIZARD_UIFILES"   "$STAGE/WIZARD_UIFILES"
cp    "$SCRIPT_DIR/LICENSE"          "$STAGE/LICENSE"

# Scripts must be executable in the SPK.
chmod 0755 "$STAGE/scripts/"*

# ---- sign ------------------------------------------------------------------

if [ -n "${GPG_KEY_ID:-}" ]; then
  echo "Signing package.tgz with key $GPG_KEY_ID ..."
  gpg --homedir "$GPG_KEYRING_DIR" \
      --batch --yes \
      --armor --detach-sign \
      --local-user "$GPG_KEY_ID" \
      -o "$STAGE/syno_signature.asc" \
      "$STAGE/package.tgz" \
    || fail "gpg signing failed"

  gpg --homedir "$GPG_KEYRING_DIR" \
      --batch \
      --verify "$STAGE/syno_signature.asc" "$STAGE/package.tgz" \
    || fail "gpg signature verification failed after signing"
  echo "Signature verified."
else
  echo "WARN: GPG_KEY_ID not set — building UNSIGNED SPK." >&2
fi

# ---- assemble SPK (tar, NOT gz) -------------------------------------------

SPK_NAME="kryton_${KRYTON_VERSION}-0001_${KRYTON_ARCH}.spk"
SPK_PATH="$OUT_DIR/$SPK_NAME"

# Deterministic, sorted file order where supported.
(
  cd "$STAGE"
  if [ "$TAR_DETERMINISTIC" = "1" ]; then
    # shellcheck disable=SC2046
    find . -mindepth 1 -print0 \
      | LC_ALL=C sort -z \
      | tar --null --no-recursion -T - \
            --mtime='2020-01-01 00:00:00 UTC' \
            --owner=0 --group=0 --numeric-owner \
            -cf "$SPK_PATH"
  else
    tar -cf "$SPK_PATH" .
  fi
)

# ---- report ----------------------------------------------------------------

SPK_SIZE="$(wc -c < "$SPK_PATH" | tr -d ' ')"
SPK_SHA256="$(sha256sum "$SPK_PATH" | awk '{print $1}')"
SPK_MD5="$(md5sum "$SPK_PATH" | awk '{print $1}')"

printf 'SPK: %s\n' "$SPK_PATH"
printf 'size: %s bytes\n' "$SPK_SIZE"
printf 'sha256: %s\n' "$SPK_SHA256"
printf 'md5: %s\n' "$SPK_MD5"
if [ -n "${GPG_KEY_ID:-}" ]; then
  printf 'signed: yes (key=%s)\n' "$GPG_KEY_ID"
else
  printf 'signed: no\n'
fi
