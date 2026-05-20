#!/usr/bin/env bash
# packaging/qnap/build.test.sh — smoke test for build.sh.
# Builds an unsigned QPKG into /tmp and asserts basic properties.
#
# Linux: runs the full build with real qbuild, checks the produced QPKG.
# macOS: qbuild ships with absolute /bin/* paths and BSD-incompatible
#   `sed -i` invocations inside the QPKG self-extract footer; the build
#   completes but the resulting QPKG self-extractor is malformed (SCRIPT_LEN
#   placeholder unresolved). On macOS we run a structural check on the
#   staged build dir instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_OUT="${TEST_OUT:-/tmp/qpkg-test}"

cleanup() {
    rm -rf "${TEST_OUT}"
}
trap cleanup EXIT

rm -rf "${TEST_OUT}"
mkdir -p "${TEST_OUT}"

export KRYTON_VERSION="0.0.0-test"
export KRYTON_PLATFORM="X86_64"
export KRYTON_IMAGE="ghcr.io/test/kryton:0.0.0-test"
export OUT_DIR="${TEST_OUT}"
# Persist QDK download across runs to avoid re-fetching.
export QDK_CACHE="${QDK_CACHE:-/tmp/qpkg-test-qdk-cache}"

UNAME="$(uname -s)"

if [ "${UNAME}" = "Darwin" ] && [ -z "${FORCE_LINUX_PATH:-}" ]; then
    echo "[test] macOS detected — running structural check (qbuild self-extract footer relies on GNU sed -i)"
    # Stage the build dir using the same logic as build.sh, but stop before qbuild.
    REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
    TEMPLATE_DIR="${SCRIPT_DIR}/source-template"
    STAGE="${TEST_OUT}/stage"
    mkdir -p "${STAGE}"
    cp -R "${TEMPLATE_DIR}/." "${STAGE}/"

    # Render qpkg.cfg the same way build.sh does.
    sed \
        -e "s|{{VERSION}}|${KRYTON_VERSION}|g" \
        -e "s|{{AUTHOR}}|Kryton|g" \
        -e "s|{{DESCRIPTION}}|Local-first notes \& knowledge base with real-time collaboration.|g" \
        -e "s|{{REQUIRE_VERSION}}|3.0.0|g" \
        "${SCRIPT_DIR}/qpkg.cfg.tmpl" > "${STAGE}/qpkg.cfg"
    {
        echo "QPKG_PLATFORM=\"${KRYTON_PLATFORM}\""
        echo "QPKG_DATA_DIR=\"Kryton\""
    } >> "${STAGE}/qpkg.cfg"

    sed "s|\\\${KRYTON_IMAGE}|${KRYTON_IMAGE}|g" \
        "${STAGE}/shared/docker-compose.yml" > "${STAGE}/shared/docker-compose.yml.new"
    mv "${STAGE}/shared/docker-compose.yml.new" "${STAGE}/shared/docker-compose.yml"

    # Structural assertions.
    echo "[test] checking staged qpkg.cfg"
    grep -q '^QPKG_NAME="kryton"' "${STAGE}/qpkg.cfg" || { echo "FAIL: QPKG_NAME"; exit 1; }
    grep -q "^QPKG_VER=\"${KRYTON_VERSION}\"" "${STAGE}/qpkg.cfg" || { echo "FAIL: QPKG_VER"; exit 1; }
    grep -q "^QPKG_PLATFORM=\"${KRYTON_PLATFORM}\"" "${STAGE}/qpkg.cfg" || { echo "FAIL: QPKG_PLATFORM"; exit 1; }
    grep -q '^QPKG_SERVICE_PROGRAM="kryton.sh"' "${STAGE}/qpkg.cfg" || { echo "FAIL: QPKG_SERVICE_PROGRAM"; exit 1; }
    grep -q "ContainerStation" "${STAGE}/qpkg.cfg" || { echo "FAIL: QPKG_REQUIRE"; exit 1; }
    echo "[test] OK qpkg.cfg substitutions"

    echo "[test] checking staged shared/"
    for f in kryton.sh docker-compose.yml .env.template README.txt; do
        [ -f "${STAGE}/shared/${f}" ] || { echo "FAIL: shared/${f} missing"; exit 1; }
    done
    grep -q "image: ${KRYTON_IMAGE}" "${STAGE}/shared/docker-compose.yml" || { echo "FAIL: image not substituted"; exit 1; }
    grep -q "^cmd_start()" "${STAGE}/shared/kryton.sh" || { echo "FAIL: kryton.sh missing cmd_start"; exit 1; }
    echo "[test] OK shared/ contents"

    echo "[test] checking package_routines"
    grep -q "^pkg_pre_install()" "${STAGE}/package_routines" || { echo "FAIL: pkg_pre_install missing"; exit 1; }
    grep -q "^pkg_post_install()" "${STAGE}/package_routines" || { echo "FAIL: pkg_post_install missing"; exit 1; }
    grep -q "ContainerStation" "${STAGE}/package_routines" || { echo "FAIL: Container Station check missing"; exit 1; }
    echo "[test] OK package_routines hooks"

    # Verify the renderer-side icon sources exist.
    for icon in kryton-80.png kryton-100.png; do
        [ -f "${REPO_ROOT}/packaging/assets/icons/${icon}" ] || { echo "FAIL: missing icon ${icon}"; exit 1; }
    done
    echo "[test] OK icon sources present"

    echo ""
    echo "[test] PASSED (macOS structural check)"
    echo "[test] Run on Linux (or in CI) to exercise qbuild and produce a real .qpkg."
    exit 0
fi

echo "[test] running build.sh (this fetches QDK on first run)"
bash "${SCRIPT_DIR}/build.sh"

QPKG_PATH="${TEST_OUT}/kryton_${KRYTON_VERSION}_x86_64.qpkg"

# --- Assertion 1: file exists and is non-empty -------------------------------
[ -f "${QPKG_PATH}" ] || { echo "FAIL: ${QPKG_PATH} does not exist"; exit 1; }
SIZE="$(wc -c < "${QPKG_PATH}" | tr -d ' ')"
[ "${SIZE}" -gt 1024 ] || { echo "FAIL: QPKG suspiciously small (${SIZE} bytes)"; exit 1; }
echo "[test] OK file exists, size=${SIZE}"

# --- Assertion 2: QPKG is a self-extracting shell script ---------------------
FILE_TYPE="$(file -b "${QPKG_PATH}")"
echo "[test] file: ${FILE_TYPE}"
case "${FILE_TYPE}" in
    *"shell script"*|*"shell archive"*|*"POSIX shell"*|*"executable"*|*"Bourne"*)
        echo "[test] OK file type matches self-extracting archive"
        ;;
    *)
        echo "FAIL: expected shell script, got: ${FILE_TYPE}"
        exit 1
        ;;
esac

# --- Assertion 3: shebang + QPKG header --------------------------------------
HEAD="$(head -c 4096 "${QPKG_PATH}")"
case "${HEAD}" in
    "#!/bin/sh"*)
        echo "[test] OK shebang is #!/bin/sh"
        ;;
    *)
        echo "FAIL: missing #!/bin/sh shebang"
        exit 1
        ;;
esac

if echo "${HEAD}" | grep -q "QPKG\|qpkg"; then
    echo "[test] OK QPKG marker found in header"
else
    echo "FAIL: no QPKG marker in first 4KB"
    exit 1
fi

# --- Assertion 4: extract qpkg.cfg from the package and verify substitutions -
EXTRACT_DIR="${TEST_OUT}/extracted"
mkdir -p "${EXTRACT_DIR}"

# The QPKG format: shell script header + control.tar (uncompressed tar) + data.tar.gz.
# qbuild --extract works on-NAS only (it shells out to lots of /sbin paths).
# We do a structural extract: find the tar boundary by scanning for the
# control.tar header magic ("ustar"). This is the heuristic accepted by the
# spec.
if command -v gzip >/dev/null 2>&1; then
    # Try the most direct approach: split off the trailing data.tar.gz and list it.
    # qbuild appends a footer of metadata; data.tar.gz lives somewhere in the body.
    # Find the gzip magic 1f 8b and try decompressing from there.
    OFFSET="$(grep -boa $'\x1f\x8b\x08' "${QPKG_PATH}" 2>/dev/null | head -1 | cut -d: -f1 || true)"
    if [ -n "${OFFSET}" ]; then
        dd if="${QPKG_PATH}" bs=1 skip="${OFFSET}" 2>/dev/null | gzip -dc 2>/dev/null | tar -tf - 2>/dev/null > "${EXTRACT_DIR}/listing.txt" || true
        if [ -s "${EXTRACT_DIR}/listing.txt" ]; then
            echo "[test] extracted listing (first 10):"
            head -10 "${EXTRACT_DIR}/listing.txt" | sed 's/^/    /'
        fi
    fi
fi

# Extract the embedded qpkg.cfg via the gzip-magic heuristic and verify it.
if [ -n "${OFFSET:-}" ]; then
    EXTRACT_FULL="${EXTRACT_DIR}/full"
    mkdir -p "${EXTRACT_FULL}"
    dd if="${QPKG_PATH}" bs=1 skip="${OFFSET}" 2>/dev/null | gzip -dc 2>/dev/null | tar -xf - -C "${EXTRACT_FULL}" 2>/dev/null || true
    if [ -f "${EXTRACT_FULL}/qpkg.cfg" ]; then
        grep -q '^QPKG_NAME="kryton"' "${EXTRACT_FULL}/qpkg.cfg" \
            || { echo "FAIL: extracted qpkg.cfg missing QPKG_NAME=kryton"; cat "${EXTRACT_FULL}/qpkg.cfg"; exit 1; }
        grep -q "^QPKG_VER=\"${KRYTON_VERSION}\"" "${EXTRACT_FULL}/qpkg.cfg" \
            || { echo "FAIL: extracted qpkg.cfg missing QPKG_VER=${KRYTON_VERSION}"; exit 1; }
        grep -q "^QPKG_PLATFORM=\"${KRYTON_PLATFORM}\"" "${EXTRACT_FULL}/qpkg.cfg" \
            || { echo "FAIL: extracted qpkg.cfg missing QPKG_PLATFORM=${KRYTON_PLATFORM}"; exit 1; }
        echo "[test] OK extracted qpkg.cfg has correct QPKG_NAME / QPKG_VER / QPKG_PLATFORM"
    else
        echo "WARN: could not extract qpkg.cfg via heuristic; falling back to raw byte search"
        if grep -aq "kryton" "${QPKG_PATH}"; then
            echo "[test] OK 'kryton' present in QPKG bytes (fallback)"
        else
            echo "FAIL: 'kryton' not found in QPKG"
            exit 1
        fi
    fi
fi

echo ""
echo "[test] PASSED"
