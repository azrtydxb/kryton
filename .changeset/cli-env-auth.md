---
"@azrtydxb/kryton-init": minor
---

Add `KRYTON_EMAIL` + `KRYTON_PASSWORD` env-var support for non-interactive auth. Both required to skip the prompts; either one missing still prompts. Lets `kryton-init install --yes` run unattended in CI.
