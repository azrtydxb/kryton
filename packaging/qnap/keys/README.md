# Kryton QPKG code-signing key

This directory documents the X.509 code-signing material for QNAP QPKGs. The
**private key is never committed**. Only this runbook lives here.

## What gets signed

`packaging/qnap/build.sh` produces, alongside the `.qpkg`, a sibling
`<file>.qpkg.codesigning` containing an `openssl cms`-format detached
signature (DER-encoded, binary mode) over the QPKG bytes. The feed's
`<signature>` element points to this sibling. QTS App Center verifies it on
install via `openssl cms -verify`.

> **Deviation from the design doc:** QDK's `qbuild --sign` is **GPG** signing,
> not X.509. QDK's X.509 path (`--add-code-signing`) requires posting the
> package to QNAP's centralised codesigning server, which we cannot use as an
> external publisher. `build.sh` therefore produces the `.codesigning` file
> directly with `openssl cms`, using the same DER-CMS wire format App Center
> accepts. The user-visible behaviour matches the design doc; only the
> producer changes.

## Generating the keypair (one-time)

Use a workstation that is **not** the build server. Never paste the resulting
private key into a chat, log, terminal recording, or commit message.

```sh
# Unencrypted key — store ONLY in GitHub Actions secrets (encrypted at rest)
# OR in a hardware-backed secret manager. Do not commit, ever.
openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout kryton-codesign.key \
    -out    kryton-codesign.crt \
    -days   3650 \
    -subj   "/CN=Kryton Packaging/O=Kryton/C=BE"

# Verify the cert
openssl x509 -in kryton-codesign.crt -noout -text | head -20
```

If you prefer an encrypted private key (omit `-nodes`), you must also pass
the passphrase to `build.sh` via `QPKG_SIGNING_PASSPHRASE`. The current
`build.sh` does not implement passphrase prompting — add it before enabling
encrypted keys, or stick with `-nodes` and rely on Actions-secret encryption.

## Storing in GitHub Actions

Add the two PEM blobs as repository secrets:

| Secret name | Contents |
| --- | --- |
| `QNAP_CODESIGN_CERT` | The full `kryton-codesign.crt` PEM (`-----BEGIN CERTIFICATE-----` ... `-----END CERTIFICATE-----`) |
| `QNAP_CODESIGN_KEY`  | The full `kryton-codesign.key` PEM (`-----BEGIN PRIVATE KEY-----` ... `-----END PRIVATE KEY-----`) |

`.github/workflows/nas-packages.yml` (and, post Phase 4, `release.yml`) writes
each to a temp file under `${RUNNER_TEMP}` only when both secrets are
defined; otherwise the build proceeds unsigned with a warning.

## Rotation

The certificate is self-signed, so there is no CA to coordinate with. Rotate
when:

- The cert is within 12 months of its 10-year expiry, or
- The private key is suspected compromised, or
- A team-member rotation policy requires it.

Procedure:

1. Generate a new keypair (`kryton-codesign-v2.{crt,key}`) following the
   command above. Use a higher version suffix in `CN=Kryton Packaging vN` if
   you want App Center to surface the change.
2. Replace `QNAP_CODESIGN_CERT` / `QNAP_CODESIGN_KEY` in Actions secrets.
3. Cut a new patch release (`vX.Y.(Z+1)-pre.1`). The new QPKG and
   `.codesigning` ship under the new cert.
4. **Already-published older QPKGs cannot be re-signed retroactively** —
   users who hold the previous fingerprint trust the old cert until they
   upgrade. This is acceptable for self-signed signing; the cert is just an
   integrity check, not a public-CA chain.
5. App Center surfaces the new fingerprint on the next install. Mention the
   change in the release notes so operators are not surprised.

## Recovery

If the private key is irretrievably lost:

1. Generate fresh keypair (as above).
2. Update Actions secrets.
3. Cut a new patch release; the new QPKG carries the new cert fingerprint.
4. The old `.codesigning` files referenced from already-published feed
   entries can be regenerated and re-uploaded **only if** you still have the
   exact original `.qpkg` bytes (Releases keeps them). For each historical
   version: download the `.qpkg`, run `openssl cms -sign` with the new key,
   upload the new `.codesigning` next to the existing `.qpkg`. Users who
   already installed see no change; users installing the old version after
   rotation see the new fingerprint.

## Strict warnings

- **Never** commit `kryton-codesign.key` or any file containing a private
  key. `.gitignore` rules in this repo already exclude `*.key` under
  `packaging/qnap/keys/`, but do not rely on that — be explicit.
- **Never** print the private key in CI logs, chat, terminal recordings, or
  bug reports. If you accidentally do, rotate immediately.
- **Never** reuse the GPG key used for git commit signing or release
  signing. This key is dedicated to QPKG code signing.
- The cert (`.crt`) public part is embedded in the `.codesigning` signature
  itself (CMS includes the signer cert by default). There is no separate
  publication step for the cert — App Center reads it from each signature.
