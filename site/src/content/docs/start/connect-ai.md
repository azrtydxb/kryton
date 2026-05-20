---
title: Connect your AI
description: One command wires Kryton into Claude, Cursor, Codex, and the other AI tools already on your machine.
---

Once Kryton is running, you'll want your AI assistants to be able to read and write your notes. There's a single command that takes care of every tool it can find on your machine.

## The one command

```sh
npx @azrtydxb/kryton-init
```

That's it. `npx` ships with Node.js — if you don't have Node, grab the LTS installer from [nodejs.org](https://nodejs.org/) first.

## What it does

When you run it, the installer will:

1. **Ask for your Kryton server URL.** Press Enter to accept `https://kryton.ai`, or type your own (for example `http://localhost:3000` if you installed via Docker).
2. **Sign you in.** It prompts for your email and password — the same credentials you used to register in Kryton.
3. **Mint an API key.** A new key named `kryton-init-<your-hostname>-<timestamp>` is created on the server. You don't have to copy it anywhere.
4. **Detect your AI tools.** It scans your machine for every supported host.
5. **Write the right config to each.** Existing settings stay intact; previous Kryton entries are replaced cleanly (a backup is saved next to each file).

Re-running the command is safe. It updates rather than duplicates.

## Supported AI tools

| Host | How it talks to Kryton |
|---|---|
| Claude Code | HTTP (stdio fallback) |
| Cursor | HTTP (stdio fallback) |
| Claude Desktop | stdio |
| Codex | HTTP (stdio fallback) |
| OpenCode | stdio |
| Cline (VS Code) | stdio |
| Continue | stdio |
| KiloCode | stdio |
| RooCode | stdio |

macOS and Linux only for the first release. Windows support is coming.

## Try it

Open your AI tool and ask:

> List my recent Kryton notes.

You should see real titles from your Kryton.

## Other commands

```sh
npx @azrtydxb/kryton-init status      # which tools are currently wired
npx @azrtydxb/kryton-init detect      # list detected tools without changing anything
npx @azrtydxb/kryton-init uninstall   # remove Kryton entries everywhere
```

If your favourite AI tool isn't on the list yet, run `kryton-init mcp --host claude-code` (or any other host) to print the JSON snippet you can paste into a config by hand.
