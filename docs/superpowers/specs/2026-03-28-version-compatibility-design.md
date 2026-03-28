# Version Display & Mobile Compatibility

**Date**: 2026-03-28
**Status**: Approved

## Problem

No version information is visible in the UI. The mobile app can connect to any server version, risking data corruption if sync protocols have breaking changes between major versions.

## Design

### Version Source of Truth

- **Version**: Root `package.json` `version` field (e.g. `4.1.0`)
- **Commit**: `git rev-parse --short HEAD` captured at server startup
- **Major version**: Parsed from the version string (e.g. `4`)
- No version stored in the database — it's a runtime property

### Server: `GET /api/version` Endpoint

New unauthenticated endpoint returning:

```json
{
  "version": "4.1.0",
  "commit": "f780f8d",
  "majorVersion": 4
}
```

The existing `GET /api/health` endpoint also gains `version`, `commit`, and `majorVersion` fields.

Version and commit are resolved once at startup and cached.

### Web Client: Status Bar

The existing bottom status bar (line:col, word count) displays the version on the right side:

```
Ln 42, Col 18 · 1,234 words                          v4.1.0 · f780f8d
```

Fetched once on app load from `GET /api/version`. If the fetch fails, nothing is shown (graceful degradation for older servers).

### Mobile: Version Compatibility

**Compatibility rule**: Major version must match. Mobile 4.x works with server 4.x. Mobile 4.x does NOT work with server 5.x or 3.x.

**Mobile version source**: `app.json` version field + commit hash baked in via Expo `extra` config at build time.

**When checks run**:
- At app launch (after login, when auth context initializes)
- Before every sync operation (pull and push)

**On mismatch — hard block**:
- Full-screen error preventing all sync
- Message varies:
  - Server newer: "Server version (v5.x) is incompatible with this app (v4.x). Please update your app."
  - Server older: "Server version (v3.x) is incompatible with this app (v4.x). Please contact your admin to update the server."

**The mobile is the gatekeeper** — it checks the server version before connecting. The server does not need to check mobile versions, keeping it simple.

### New `api.ts` Method (Mobile)

```typescript
getServerVersion(): Promise<{ version: string; commit: string; majorVersion: number }>
```

Calls `GET /api/version` (unauthenticated, no API key needed).

## Changes Summary

| Area | Change |
|------|--------|
| Server | New `GET /api/version` endpoint (unauthenticated) |
| Server `/api/health` | Add version, commit, majorVersion to response |
| Client status bar | Fetch + display `v4.1.0 · f780f8d` on the right |
| Mobile `api.ts` | New `getServerVersion()` method |
| Mobile `AuthContext` | Version check after login, hard block on mismatch |
| Mobile `sync.ts` | Version check before every sync |
| Mobile `app.json` | Commit hash in Expo `extra` config |

## Not Changing

- No new DB tables or migrations
- No version negotiation protocol
- Server does not validate client versions
