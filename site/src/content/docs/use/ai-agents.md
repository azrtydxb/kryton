---
title: AI agents
description: What your Claude, Cursor, or Codex can do once it's connected to your Kryton.
---

Kryton speaks **MCP** (Model Context Protocol), a standard way for AI agents to talk to apps. Once you've wired your favourite AI tool to Kryton, that tool can read and write your notes on your behalf — using your account, with your permissions.

In practice this means you can say things like:

- *"Pull up everything I wrote about Project Aurora last week and summarise it."*
- *"Take these meeting notes, file them under `/work/standups`, and tag them `#standup`."*
- *"Find any note with a TODO and turn each one into a tagged task."*

The agent does the searching, reading, and writing through Kryton's API. You see the results in real time.

## Get this set up

You need two things:

1. A running Kryton — see [Install with Docker](/kryton/start/install/docker/).
2. The `kryton-init` command — see [Connect your AI](/kryton/start/connect-ai/).

After those two steps, ask your AI agent anything that involves your notes and it'll know what to do.

## Going deeper

If you want to know exactly which tools your agent has, or you're building your own agent integration, head to the [MCP tools reference](/kryton/advanced/api/mcp-tools/) under Advanced.
