#!/usr/bin/env bash
# packaging/qnap/build.sh — produce a Kryton QPKG for one QNAP platform.
#
# Phase 3 of docs/design/nas-package-stores.md.
#
# Required env:
#   KRYTON_VERSION   e.g. 1.4.2
#   KRYTON_PLATFORM  one of: X86_64 | ARM_64
#   KRYTON_IMAGE     e.g. ghcr.io/azrtydxb/kryton/kryton:1.4.2
#   OUT_DIR          absolute path; build.sh writes the .qpkg here
#
# Optional env:
#   QDK_VERSION              upstream QDK release tag, default v2.5.0
#   QPKG_SIGNING_CERT        path to PEM cert; if set with KEY, produce
#                            a sibling .qpkg.codesigning openssl CMS signature
#   QPKG_SIGNING_KEY         path to PEM private key
#   QPKG_AUTHOR              QPKG_AUTHOR field, default "Kryton"
#   QPKG_DESCRIPTION         QPKG_SUMMARY field, default "Local-first notes & knowledge base..."
#   QPKG_REQUIRE_CS_VERSION  Container Station minimum, default 3.0.0
#
# Behaviour: deterministic except for the signature. Same inputs → byte-identical
# .qpkg payload (signature, if any, is computed last).
#
# Exit non-zero with "BUILD FAILED: <reason>" on any error.

set -euo pipefail

die() {
    echo "BUILD FAILED: $*" >&2
    exit 1
}

# ---------- 1. Validate inputs --------------------------------------------------

: "${KRYTON_VERSION:?KRYTON_VERSION is required}"
: "${KRYTON_PLATFORM:?KRYTON_PLATFORM is required (X86_64 or ARM_64)}"
: "${KRYTON_IMAGE:?KRYTON_IMAGE is required}"
: "${OUT_DIR:?OUT_DIR is required}"

case "${KRYTON_PLATFORM}" in
    X86_64|ARM_64) ;;
    *) die "KRYTON_PLATFORM must be X86_64 or ARM_64, got ${KRYTON_PLATFORM}" ;;
esac

QDK_VERSION="${QDK_VERSION:-v2.5.0}"
QPKG_AUTHOR="${QPKG_AUTHOR:-Kryton}"
QPKG_DESCRIPTION="${QPKG_DESCRIPTION:-Local-first notes & knowledge base with real-time collaboration.}"
QPKG_REQUIRE_CS_VERSION="${QPKG_REQUIRE_CS_VERSION:-3.0.0}"

# qbuild caps QPKG_VER at 10 characters and only accepts digits + dots.
# Compress semver-style pre/rc suffixes (e.g. "4.6.5-pre.8" -> "4.6.5.8")
# so the cfg field validates. The full KRYTON_VERSION is still used for
# the artifact filename so users can tell pre-releases apart on disk.
QPKG_NUMERIC_VERSION="$(printf '%s' "${KRYTON_VERSION}" | sed -E 's/-[a-zA-Z]+(\.|$)/./g; s/\.+$//')"
if [ "${#QPKG_NUMERIC_VERSION}" -gt 10 ]; then
    die "computed QPKG_VER '${QPKG_NUMERIC_VERSION}' exceeds 10 chars (qbuild limit). Source version: ${KRYTON_VERSION}"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR}/source-template"
ASSETS_DIR="${REPO_ROOT}/packaging/assets/icons"

[ -d "${TEMPLATE_DIR}" ] || die "source-template missing at ${TEMPLATE_DIR}"
[ -f "${SCRIPT_DIR}/qpkg.cfg.tmpl" ] || die "qpkg.cfg.tmpl missing"
[ -d "${ASSETS_DIR}" ] || die "icons missing at ${ASSETS_DIR}"

mkdir -p "${OUT_DIR}"
OUT_DIR="$(cd "${OUT_DIR}" && pwd)"

# Lowercased platform per QPKG filename convention.
case "${KRYTON_PLATFORM}" in
    X86_64) PLATFORM_LOWER="x86_64" ;;
    ARM_64) PLATFORM_LOWER="arm_64" ;;
esac

# ---------- 2. Stage the build dir ---------------------------------------------

WORK_DIR="$(mktemp -d -t kryton-qpkg-XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

BUILD_ROOT="${WORK_DIR}/src"
mkdir -p "${BUILD_ROOT}"
cp -R "${TEMPLATE_DIR}/." "${BUILD_ROOT}/"

# Normalise file permissions deterministically.
find "${BUILD_ROOT}" -type d -exec chmod 755 {} +
find "${BUILD_ROOT}" -type f -exec chmod 644 {} +
chmod 755 "${BUILD_ROOT}/package_routines"
chmod 755 "${BUILD_ROOT}/shared/kryton.sh"

# ---------- 3. Render qpkg.cfg --------------------------------------------------

RENDERED_CFG="${BUILD_ROOT}/qpkg.cfg"
# shellcheck disable=SC2002
sed \
    -e "s|{{VERSION}}|${QPKG_NUMERIC_VERSION}|g" \
    -e "s|{{AUTHOR}}|${QPKG_AUTHOR}|g" \
    -e "s|{{DESCRIPTION}}|${QPKG_DESCRIPTION}|g" \
    -e "s|{{REQUIRE_VERSION}}|${QPKG_REQUIRE_CS_VERSION}|g" \
    "${SCRIPT_DIR}/qpkg.cfg.tmpl" > "${RENDERED_CFG}"

# Append fields the Phase 1 template does not include but qbuild needs.
{
    echo "QPKG_PLATFORM=\"${KRYTON_PLATFORM}\""
    echo "QPKG_DATA_DIR=\"Kryton\""
} >> "${RENDERED_CFG}"

# Sanity-check the rendered cfg.
grep -q "^QPKG_NAME=\"kryton\"" "${RENDERED_CFG}" || die "rendered qpkg.cfg missing QPKG_NAME"
grep -q "^QPKG_VER=\"${QPKG_NUMERIC_VERSION}\"" "${RENDERED_CFG}" || die "rendered qpkg.cfg has wrong QPKG_VER"
grep -q "^QPKG_PLATFORM=\"${KRYTON_PLATFORM}\"" "${RENDERED_CFG}" || die "rendered qpkg.cfg missing QPKG_PLATFORM"

# ---------- 4. Substitute image into docker-compose.yml ------------------------

COMPOSE="${BUILD_ROOT}/shared/docker-compose.yml"
# Replace the literal "${KRYTON_IMAGE}" placeholder line. We bake the image at
# QPKG build time so the deployed compose has no external substitution risk.
# Use a temp file + mv to keep this portable (GNU/BSD sed in-place differs).
sed "s|\\\${KRYTON_IMAGE}|${KRYTON_IMAGE}|g" "${COMPOSE}" > "${COMPOSE}.tmp"
mv "${COMPOSE}.tmp" "${COMPOSE}"

grep -q "image: ${KRYTON_IMAGE}" "${COMPOSE}" || die "image substitution into compose failed"

# Similarly substitute KRYTON_IMAGE into .env.template so operators can see the pinned image.
ENV_TMPL="${BUILD_ROOT}/shared/.env.template"
sed "s|\\\${KRYTON_IMAGE}|${KRYTON_IMAGE}|g" "${ENV_TMPL}" > "${ENV_TMPL}.tmp"
mv "${ENV_TMPL}.tmp" "${ENV_TMPL}"

# ---------- 5. Icons ------------------------------------------------------------

ICON_DIR="${BUILD_ROOT}/icons"
mkdir -p "${ICON_DIR}"

# QDK on-disk contract: .gif extensions. Recent QTS accepts PNG bytes renamed
# to .gif — documented QDK workaround.
cp "${ASSETS_DIR}/kryton-80.png"  "${ICON_DIR}/kryton.gif"
cp "${ASSETS_DIR}/kryton-100.png" "${ICON_DIR}/kryton_80.gif"

if command -v magick >/dev/null 2>&1; then
    magick "${ASSETS_DIR}/kryton-80.png" -colorspace Gray "${ICON_DIR}/kryton_gray.gif"
elif command -v convert >/dev/null 2>&1; then
    convert "${ASSETS_DIR}/kryton-80.png" -colorspace Gray "${ICON_DIR}/kryton_gray.gif"
else
    echo "WARN: ImageMagick not available; using colour icon for kryton_gray.gif (TODO: convert to grayscale)" >&2
    cp "${ASSETS_DIR}/kryton-80.png" "${ICON_DIR}/kryton_gray.gif"
fi

# ---------- 6. Locate / install qbuild -----------------------------------------

QBUILD=""
if command -v qbuild >/dev/null 2>&1; then
    QBUILD="$(command -v qbuild)"
else
    QDK_CACHE="${QDK_CACHE:-${WORK_DIR}/qdk}"
    mkdir -p "${QDK_CACHE}"
    # Default to the .deb (Debian-based CI containers). On non-Debian systems
    # we fall back to extracting the .deb via ar+tar.
    QDK_URL="https://github.com/qnap-dev/QDK/releases/download/${QDK_VERSION}/qdk_${QDK_VERSION#v}_amd64.deb"
    QDK_DEB="${QDK_CACHE}/qdk.deb"
    if [ ! -f "${QDK_DEB}" ]; then
        echo "Downloading QDK ${QDK_VERSION} from ${QDK_URL}"
        curl -fsSL "${QDK_URL}" -o "${QDK_DEB}" \
            || die "failed to download QDK from ${QDK_URL}"
    fi

    # Extract the .deb without dpkg so the build works on macOS dev machines too.
    mkdir -p "${QDK_CACHE}/extracted"
    (cd "${QDK_CACHE}/extracted" && ar -x "${QDK_DEB}" && tar -xzf data.tar.gz) \
        || die "failed to extract QDK .deb"

    QBUILD="${QDK_CACHE}/extracted/usr/share/QDK/bin/qbuild"
    [ -x "${QBUILD}" ] || die "qbuild not found after extracting QDK"

    # qbuild hardcodes /bin/{grep,sed,tar,cat,rm,cp,mkdir,echo,cut,awk,ls,...}
    # absolute paths. Those exist on Debian/QTS but not on macOS dev machines
    # (which use /usr/bin/...). Patch the script to use the host's resolved
    # binaries. Idempotent — we mark the file once patched.
    PATCH_MARKER="# qbuild-patched-by-kryton-build"
    if ! grep -qF "${PATCH_MARKER}" "${QBUILD}"; then
        # Patch absolute-path tool references in tool-position only (after
        # whitespace, start of line, command-substitution, pipe, or semicolon)
        # so we don't accidentally rewrite the inside of comments/strings.
        # Process longer tool names first so e.g. /bin/uname is patched before
        # /bin/un... (none present, but safe).
        for tool in basename dirname mkdir touch chmod chown gzip bzip2 grep sed tar cat awk cut head tail wc cmp uniq sort find ls mv ln rm cp echo tr date od; do
            host_path="$(command -v "${tool}" 2>/dev/null || true)"
            if [ -n "${host_path}" ] && [ "${host_path}" != "/bin/${tool}" ]; then
                # Escape '/' for use in sed replacement.
                esc_path="$(printf '%s' "${host_path}" | sed 's|/|\\/|g')"
                sed -i.bak "s|/bin/${tool}|${host_path}|g" "${QBUILD}"
                rm -f "${QBUILD}.bak"
            fi
        done
        # qpkg_encrypt is a separate binary in the .deb's /usr/bin/. Symlink it
        # next to qbuild so PATH lookup finds it. NOTE: on macOS the binary is
        # ELF and won't execute — qbuild only invokes it for encryption, which
        # we are not doing. The "cannot execute" warning is harmless.
        local_qpkg_encrypt_src="${QDK_CACHE}/extracted/usr/bin/qpkg_encrypt"
        if [ -x "${local_qpkg_encrypt_src}" ]; then
            ln -sf "${local_qpkg_encrypt_src}" "${QDK_CACHE}/extracted/usr/share/QDK/bin/qpkg_encrypt" 2>/dev/null || true
        fi
        # Stamp the patched script so we don't re-patch on subsequent runs.
        # Insert as a comment on line 2 (after shebang).
        awk -v m="${PATCH_MARKER}" 'NR==1{print; print m; next} {print}' "${QBUILD}" > "${QBUILD}.new" && mv "${QBUILD}.new" "${QBUILD}"
        chmod +x "${QBUILD}"
    fi

    # qbuild looks up its scripts dir from $0; export an env var it also honours.
    export QDK_DIR="${QDK_CACHE}/extracted/usr/share/QDK"
    export QDK_SCRIPTS_DIR="${QDK_DIR}/scripts"
    export PATH="${QDK_DIR}/bin:${QDK_CACHE}/extracted/usr/bin:${PATH}"
fi

echo "Using qbuild at: ${QBUILD}"

# ---------- 7. Build the QPKG ---------------------------------------------------

# qbuild emits to <root>/build by default.
BUILD_OUT="${BUILD_ROOT}/build"
mkdir -p "${BUILD_OUT}"

# Force deterministic mtimes on inputs so the inner tarball is reproducible.
find "${BUILD_ROOT}" -exec touch -h -d "2020-01-01T00:00:00Z" {} + 2>/dev/null \
    || find "${BUILD_ROOT}" -exec touch -h -t 202001010000 {} + 2>/dev/null \
    || true

(
    cd "${BUILD_ROOT}"
    "${QBUILD}" \
        --root "${BUILD_ROOT}" \
        --build-version "${QPKG_NUMERIC_VERSION}" \
        --build-arch "${PLATFORM_LOWER}" \
        --build-dir "${BUILD_OUT}" \
        --quiet
) || die "qbuild failed"

# qbuild produces files like: kryton_<ver>.qpkg or kryton_<ver>_<arch>.qpkg.
BUILT_QPKG=""
for candidate in \
    "${BUILD_OUT}/kryton_${KRYTON_VERSION}_${PLATFORM_LOWER}.qpkg" \
    "${BUILD_OUT}/kryton_${KRYTON_VERSION}.qpkg"; do
    if [ -f "${candidate}" ]; then
        BUILT_QPKG="${candidate}"
        break
    fi
done

if [ -z "${BUILT_QPKG}" ]; then
    # Fall back: pick the only .qpkg in the build dir.
    BUILT_QPKG="$(ls -1 "${BUILD_OUT}"/*.qpkg 2>/dev/null | head -1 || true)"
fi

[ -n "${BUILT_QPKG}" ] && [ -f "${BUILT_QPKG}" ] || die "qbuild did not produce a .qpkg"

# Move to OUT_DIR with the canonical lowercased-arch name.
FINAL_NAME="kryton_${KRYTON_VERSION}_${PLATFORM_LOWER}.qpkg"
FINAL_PATH="${OUT_DIR}/${FINAL_NAME}"
cp "${BUILT_QPKG}" "${FINAL_PATH}"

# ---------- 8. Optional: produce .codesigning detached signature ---------------

SIGNATURE_PATH=""
if [ -n "${QPKG_SIGNING_CERT:-}" ] && [ -n "${QPKG_SIGNING_KEY:-}" ]; then
    [ -f "${QPKG_SIGNING_CERT}" ] || die "QPKG_SIGNING_CERT does not exist: ${QPKG_SIGNING_CERT}"
    [ -f "${QPKG_SIGNING_KEY}"  ] || die "QPKG_SIGNING_KEY does not exist: ${QPKG_SIGNING_KEY}"

    SIGNATURE_PATH="${FINAL_PATH}.codesigning"
    # CMS detached signature, DER-encoded. Matches the verification path qbuild
    # uses (`openssl cms -verify -in <sig> -CAfile ...`). DER is what QNAP's
    # codesigning server returns, so App Center expects the same wire format.
    openssl cms -sign \
        -binary \
        -in "${FINAL_PATH}" \
        -signer "${QPKG_SIGNING_CERT}" \
        -inkey "${QPKG_SIGNING_KEY}" \
        -outform DER \
        -out "${SIGNATURE_PATH}" \
        || die "openssl cms signing failed"

    # Verify the signature we just produced (self-issued cert, so trust it).
    # -binary on verify must match the -binary used on sign, else CMS
    # canonicalises line endings and rejects.
    openssl cms -verify \
        -in "${SIGNATURE_PATH}" \
        -inform DER \
        -content "${FINAL_PATH}" \
        -binary \
        -CAfile "${QPKG_SIGNING_CERT}" \
        -purpose any \
        -no_check_time \
        -out /dev/null 2>/dev/null \
        || die "produced .codesigning failed self-verification"
else
    echo "WARN: QPKG_SIGNING_CERT/QPKG_SIGNING_KEY not set — building unsigned. App Center will warn the user on install." >&2
fi

# ---------- 9. Report ----------------------------------------------------------

SIZE="$(wc -c < "${FINAL_PATH}" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then
    SHA256="$(sha256sum "${FINAL_PATH}" | awk '{print $1}')"
else
    SHA256="$(shasum -a 256 "${FINAL_PATH}" | awk '{print $1}')"
fi
if command -v md5sum >/dev/null 2>&1; then
    MD5="$(md5sum "${FINAL_PATH}" | awk '{print $1}')"
else
    MD5="$(md5 -q "${FINAL_PATH}")"
fi

echo ""
echo "QPKG  : ${FINAL_PATH}"
echo "size  : ${SIZE} bytes"
echo "sha256: ${SHA256}"
echo "md5   : ${MD5}"
if [ -n "${SIGNATURE_PATH}" ]; then
    SIG_SIZE="$(wc -c < "${SIGNATURE_PATH}" | tr -d ' ')"
    echo "sig   : ${SIGNATURE_PATH} (${SIG_SIZE} bytes, CMS DER)"
else
    echo "sig   : (none — unsigned build)"
fi
