#!/usr/bin/env bash
#
# Smoke test for packaging/synology/build.sh — unsigned path only.
# Verifies the resulting SPK is a real tar archive with the expected
# top-level layout, and that package.tgz contains a substituted compose file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_OUT="/tmp/spk-test"
EXTRACT_DIR="/tmp/spk-test-extract"

cleanup() { rm -rf "$TEST_OUT" "$EXTRACT_DIR"; }
trap cleanup EXIT

rm -rf "$TEST_OUT" "$EXTRACT_DIR"
mkdir -p "$TEST_OUT" "$EXTRACT_DIR"

export OUT_DIR="$TEST_OUT"
export KRYTON_VERSION="0.0.0-test"
export KRYTON_ARCH="x86_64"
export KRYTON_IMAGE="ghcr.io/test/kryton:0.0.0-test"
unset GPG_KEY_ID GPG_KEYRING_DIR || true

echo "==> Running build.sh (unsigned path)"
"$SCRIPT_DIR/build.sh"

SPK="$TEST_OUT/kryton_${KRYTON_VERSION}-0001_${KRYTON_ARCH}.spk"

# Assert 1: SPK exists.
[ -f "$SPK" ] || { echo "FAIL: SPK not produced at $SPK"; exit 1; }

# Assert 2: SPK is a tar archive (NOT gzip).
FILE_OUT="$(file "$SPK")"
echo "file output: $FILE_OUT"
case "$FILE_OUT" in
  *gzip*) echo "FAIL: SPK is gzipped — must be plain tar"; exit 1 ;;
  *tar*|*USTAR*|*POSIX*) ;;
  *) echo "FAIL: SPK is not a tar archive: $FILE_OUT"; exit 1 ;;
esac

# Assert 3: Extract and check top-level layout.
tar -xf "$SPK" -C "$EXTRACT_DIR"
for required in INFO package.tgz scripts WIZARD_UIFILES PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG conf LICENSE; do
  if [ ! -e "$EXTRACT_DIR/$required" ]; then
    echo "FAIL: SPK missing $required"
    echo "Contents:"
    ls -la "$EXTRACT_DIR"
    exit 1
  fi
done

# Assert 4: INFO has correct fields.
if ! grep -q '^package="kryton"' "$EXTRACT_DIR/INFO"; then
  echo "FAIL: INFO missing package=\"kryton\""; cat "$EXTRACT_DIR/INFO"; exit 1
fi
if ! grep -q '^version="0.0.0-test-0001"' "$EXTRACT_DIR/INFO"; then
  echo "FAIL: INFO missing version=\"0.0.0-test-0001\""; cat "$EXTRACT_DIR/INFO"; exit 1
fi
if ! grep -q '^arch="x86_64"' "$EXTRACT_DIR/INFO"; then
  echo "FAIL: INFO missing arch=\"x86_64\""; cat "$EXTRACT_DIR/INFO"; exit 1
fi

# Assert 5: package.tgz extracts and contains a substituted compose file.
mkdir -p "$EXTRACT_DIR/pkg"
tar -xzf "$EXTRACT_DIR/package.tgz" -C "$EXTRACT_DIR/pkg"
[ -f "$EXTRACT_DIR/pkg/docker-compose.yml" ] || { echo "FAIL: package.tgz missing docker-compose.yml"; exit 1; }
if ! grep -q "ghcr.io/test/kryton:0.0.0-test" "$EXTRACT_DIR/pkg/docker-compose.yml"; then
  echo "FAIL: compose file did not get image substitution"
  grep -E '^\s*image:' "$EXTRACT_DIR/pkg/docker-compose.yml"
  exit 1
fi
if grep -q "__KRYTON_IMAGE__" "$EXTRACT_DIR/pkg/docker-compose.yml"; then
  echo "FAIL: compose file still contains __KRYTON_IMAGE__ placeholder"
  exit 1
fi

echo "==> ALL ASSERTIONS PASSED"
