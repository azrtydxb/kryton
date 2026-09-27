#!/usr/bin/env python3
"""Render one desired directory to a mode-0600 file; never print Secret values."""
import os
from pathlib import Path
import subprocess
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: render-private.py <desired-directory> <private-output-file>")
base = Path(__file__).resolve().parent
source = (base / sys.argv[1]).resolve()
if source.parent != base or source.name not in ("kw", "operator") or not source.is_dir():
    raise SystemExit("expected a kw or operator desired directory in deploy/kuvryn-sync")
out = Path(sys.argv[2]).expanduser().resolve()
repo = base.parent.parent
if out == repo or repo in out.parents:
    raise SystemExit("private render must be outside the repository")
chunks = []
for file in sorted(source.glob("*.yaml")):
    if ".sops." in file.name:
        result = subprocess.run(["sops", "decrypt", str(file)], capture_output=True)
        if result.returncode:
            raise SystemExit("SOPS decryption failed; check SOPS_AGE_KEY_FILE")
        chunks.append(result.stdout)
    else:
        chunks.append(file.read_bytes())
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb") as stream:
    stream.write(b"\n---\n".join(chunks))
print("Private render written; validate it without logging its contents.")
