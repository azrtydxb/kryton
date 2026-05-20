---
title: AI agents
description: What an MCP-connected agent can do with your Kryton vault.
---

Once you've run `npx @azrtydxb/kryton-init` (see [Connect your AI](/kryton/start/connect-ai/)), any wired host gets a `kryton` MCP server exposing **33 tools** scoped read-only or read-write per call.

What an agent can do:

- **Read** — `list_notes`, `read_note`, `list_folders`, `list_recent_notes`, `get_note_metadata`, `list_daily_notes`, `list_templates`, `list_tags`, `list_favorites`
- **Write** — `create_note`, `update_note`, `append_to_note`, `delete_note`, `rename_note`, `create_folder`, `rename_folder`, `delete_folder`, `create_note_from_template`, `write_daily_note`, `get_daily_note`
- **Search and traverse** — `search`, `list_notes_by_tag`, `get_backlinks`, `get_graph`
- **Stars and trash** — `add_favorite`, `remove_favorite`, `list_trash`, `restore_from_trash`, `empty_trash`
- **Sharing** — `list_shares`, `list_shares_with_me`, `share_note`, `unshare_note`

For setup, see [Connect your AI](/kryton/start/connect-ai/). For the full tool reference with schemas, see [MCP tools](/kryton/advanced/api/mcp-tools/).
