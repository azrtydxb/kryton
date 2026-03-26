# Mass Upload Plugin — Design Spec

## Overview

A server+client plugin for Mnemo that lets users bulk-import `.md` files via a modal dialog. Files are uploaded to the server, validated, and presented for review before being committed as notes.

## Plugin Structure

```
packages/server/plugins/mass-upload/
├── manifest.json
├── server/
│   └── index.ts
└── client/
    └── index.ts
```

### Manifest

```json
{
  "id": "mass-upload",
  "name": "Mass Upload",
  "version": "1.0.0",
  "description": "Bulk import .md files with validation and duplicate detection",
  "author": "Mnemo",
  "minMnemoVersion": "3.0.0",
  "client": "client/index.js",
  "server": "server/index.js",
  "settings": [
    {
      "key": "maxFileSize",
      "type": "number",
      "default": 1048576,
      "label": "Max file size (bytes)",
      "perUser": false
    }
  ]
}
```

## Server API — Two-Phase Flow

### Phase 1: Upload & Validate

`POST /api/plugins/mass-upload/validate`

- Accepts `multipart/form-data` with multiple `.md` files
- Query params: `?targetFolder=Projects&preserveStructure=true`
- Reads each file, runs all validation checks, detects duplicates
- Stores files temporarily in `api.plugin.dataDir/sessions/{userId}/{sessionId}/`
- Server verifies `req.user.id` matches the session owner on all subsequent requests
- Returns validation report — nothing is written to user notes yet
- Multer configured with `limits.fileSize` matching the `maxFileSize` setting so oversized files are rejected during streaming, not after buffering

**Response:**

```json
{
  "sessionId": "abc123",
  "targetFolder": "Projects",
  "preserveStructure": true,
  "files": [
    {
      "index": 0,
      "originalName": "todo.md",
      "resolvedPath": "Projects/todo.md",
      "size": 2048,
      "status": "valid",
      "errors": []
    },
    {
      "index": 1,
      "originalName": "ideas.md",
      "resolvedPath": "Projects/ideas.md",
      "size": 512,
      "status": "duplicate",
      "errors": [],
      "existingNote": true
    },
    {
      "index": 2,
      "originalName": "broken.md",
      "resolvedPath": "Projects/broken.md",
      "size": 0,
      "status": "invalid",
      "errors": ["File is empty"]
    }
  ]
}
```

Session metadata (file list with resolved paths and statuses) is stored alongside the temp files. The server is the source of truth for paths — the client cannot override them.

### Phase 2: Confirm & Create

`POST /api/plugins/mass-upload/confirm`

**Request:**

```json
{
  "sessionId": "abc123",
  "files": [
    { "index": 0, "action": "create" },
    { "index": 1, "action": "overwrite" }
  ]
}
```

- Server verifies `req.user.id` owns the session
- Files are identified by `index` (from Phase 1 response), not by client-supplied paths — the server looks up the resolved path from stored session metadata
- Only `valid`, `duplicate`, and `warning` files can be confirmed; `invalid` indices are rejected
- `action: "create"` calls `api.notes.create(userId, path, content)`
- `action: "overwrite"` calls `api.notes.update(userId, path, content)`
- Files not included in the request are skipped
- Cleans up the temp session directory after processing

**Response:**

```json
{
  "created": 1,
  "overwritten": 1,
  "errors": []
}
```

### Session Cleanup

`DELETE /api/plugins/mass-upload/session/:sessionId`

- Cancels an upload, removes temp files
- Server verifies `req.user.id` owns the session
- Sessions also auto-expire after 30 minutes
- Max 5 concurrent sessions per user; Phase 1 returns `409 Conflict` if exceeded

## Validation Rules

All checks run for every file (no short-circuiting) so the user sees the full list of issues at once:

1. **Extension** — must be `.md`; reject otherwise
2. **Size** — max 1MB (configurable via `maxFileSize` setting), reject empty files
3. **Binary detection** — scan for null bytes; reject non-text
4. **Encoding** — must be valid UTF-8
5. **Path safety** — sanitize filename (strip `..`, leading `/`, control chars, Windows-reserved names)
6. **Title heading** — warn (not reject) if file doesn't start with `# Heading`
7. **Duplicate detection** — check resolved path against existing user notes via `api.notes.list()`

### File Statuses

| Status | Meaning | Can confirm? |
|--------|---------|-------------|
| `valid` | Passes all checks | Yes |
| `duplicate` | Valid content, path exists | Yes (skip or overwrite) |
| `warning` | Passes but has soft issues | Yes |
| `invalid` | Fails a hard check | No |

## Client UI — Modal Workflow

Triggered by a toolbar button (upload icon) registered via `api.ui.registerEditorToolbarButton()`.

The upload uses `FormData` via `api.api.fetch('/validate', { method: 'POST', body: formData })`. `Content-Type` must not be set manually — the browser sets the multipart boundary automatically.

### Step 1: Select Files

- Drag-and-drop zone + file picker button
- Accepts `.md` files and folders (via `webkitdirectory`)
- Target folder input (text field, defaults to root `/`)
- Checkbox: "Preserve folder structure"
- "Upload & Validate" button sends files to server

### Step 2: Review

- Table listing all files: filename, resolved path, size, status, action
- Status badges: green (valid), yellow (warning/duplicate), red (invalid)
- Invalid files greyed out with error messages
- Duplicate files have a dropdown: "Skip" or "Overwrite"
- Warning files show warning text, are selectable
- "Select All / Deselect All" toggle
- Summary line: "12 valid, 2 duplicates, 1 warning, 3 invalid"

### Step 3: Confirm & Results

- Progress bar during note creation
- Summary: "Created 10, Overwritten 2"
- Per-file errors listed if any creates failed
- "Done" button closes the modal

## Error Handling & Edge Cases

- **Session expiry** — temp files cleaned after 30 minutes; confirming expired session returns `410 Gone`
- **Session limit** — max 5 concurrent sessions per user; returns `409 Conflict` if exceeded
- **Partial failure** — successfully created notes are kept; per-file errors returned in response
- **Concurrent uploads** — each upload gets unique `sessionId`; no interference
- **Large batches** — multer limits: 500 files max, 500MB total, per-file limit matches `maxFileSize` setting
- **Auth** — all routes require `req.user`; session files stored under `{userId}/{sessionId}`; ownership verified on every request
- **Disk cleanup** — `deactivate()` waits for in-flight confirm operations to complete before cleaning remaining temp sessions

## Dependencies

- `multer` — multipart/form-data parsing (installed in the plugin, not globally)
- No other external dependencies

## Not In Scope

- Non-markdown file types (images, PDFs, etc.)
- Merge/diff for duplicate content
- Scheduled/automated imports
