---
"@azrtydxb/kryton-init": patch
---

Drop the fake `https://kryton.ai` default server URL — Kryton is self-hosted and that domain doesn't resolve, so users who accepted the default hit a confusing "server unreachable" failure that looked like a network issue. The interactive prompt now has no default (the user must enter a URL, or the installer reuses the prior install's server if any). The `--yes` non-interactive path now errors out clearly if neither `--server`, `KRYTON_SERVER`, nor prior state provides a URL, instead of silently using the fake default.

Also adds a README covering the install/uninstall/status/detect/mcp commands, every supported AI agent host with its config-file path and chosen transport, the state-file location and contents, and the env vars.
