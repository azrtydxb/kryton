---
"@azrtydxb/kryton-init": patch
---

Send `scope: "read-write"` when minting the API key. Kryton's `POST /api/api-keys` requires it; previous versions failed with `VALIDATION_ERROR` against any current server.
