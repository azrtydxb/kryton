#!/usr/bin/env node
// Generated. Do not edit the output by hand — re-run via `npm run gen:mcp`.
//
// Parses kryton/packages/server/src/modules/agents/mcp/tools.ts and emits a
// single markdown reference page with one section per registered MCP tool.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "..");
const repoRoot = resolve(siteRoot, "..");
const toolsFile = resolve(
  repoRoot,
  "packages/server/src/modules/agents/mcp/tools.ts",
);
const outFile = resolve(
  siteRoot,
  "src/content/docs/advanced/api/mcp-tools.md",
);

const source = readFileSync(toolsFile, "utf8");

// Locate getToolDefinitions() body and extract each top-level tool object.
const fnIdx = source.indexOf("getToolDefinitions");
if (fnIdx === -1) {
  console.error("[gen:mcp] could not find getToolDefinitions() in tools.ts");
  process.exit(1);
}
const returnIdx = source.indexOf("return [", fnIdx);
if (returnIdx === -1) {
  console.error("[gen:mcp] could not find `return [` after getToolDefinitions");
  process.exit(1);
}
const arrayStart = source.indexOf("[", returnIdx);
if (arrayStart === -1) {
  console.error("[gen:mcp] could not find array literal after getToolDefinitions");
  process.exit(1);
}

// Walk balanced brackets to find the array end.
function findMatching(text, openIdx, openCh, closeCh) {
  let depth = 0;
  let inString = null; // '"' | "'" | "`"
  let escape = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const arrayEnd = findMatching(source, arrayStart, "[", "]");
if (arrayEnd === -1) {
  console.error("[gen:mcp] unbalanced array literal in tools.ts");
  process.exit(1);
}

const arrayBody = source.slice(arrayStart + 1, arrayEnd);

// Walk arrayBody and extract each top-level {...} block.
const toolBlocks = [];
{
  let i = 0;
  while (i < arrayBody.length) {
    if (arrayBody[i] === "{") {
      const end = findMatching(arrayBody, i, "{", "}");
      if (end === -1) break;
      toolBlocks.push(arrayBody.slice(i, end + 1));
      i = end + 1;
    } else {
      i++;
    }
  }
}

function unquote(str) {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function extractStringField(block, field) {
  // Match  field: "..."  or  field: '...'  at top level (good enough since
  // descriptions don't contain `: ` followed by a quote in this file).
  const re = new RegExp(`${field}\\s*:\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`);
  const m = block.match(re);
  return m ? unquote(m[2]) : null;
}

function extractInputSchemaProps(block) {
  const idx = block.indexOf("inputSchema");
  if (idx === -1) return { props: [], required: [] };
  const braceStart = block.indexOf("{", idx);
  if (braceStart === -1) return { props: [], required: [] };
  const braceEnd = findMatching(block, braceStart, "{", "}");
  if (braceEnd === -1) return { props: [], required: [] };
  const schema = block.slice(braceStart, braceEnd + 1);

  // Find the properties: { ... } block within schema.
  const propsIdx = schema.indexOf("properties");
  if (propsIdx === -1) return { props: [], required: [] };
  const propsBraceStart = schema.indexOf("{", propsIdx);
  if (propsBraceStart === -1) return { props: [], required: [] };
  const propsBraceEnd = findMatching(schema, propsBraceStart, "{", "}");
  if (propsBraceEnd === -1) return { props: [], required: [] };
  const propsBody = schema.slice(propsBraceStart + 1, propsBraceEnd);

  // Each property starts with `name: {` at depth 0 within propsBody.
  const props = [];
  let i = 0;
  while (i < propsBody.length) {
    // Skip whitespace and commas
    while (i < propsBody.length && /[\s,]/.test(propsBody[i])) i++;
    if (i >= propsBody.length) break;
    // Read identifier or quoted key
    let nameMatch;
    if (propsBody[i] === '"' || propsBody[i] === "'") {
      const q = propsBody[i];
      const end = propsBody.indexOf(q, i + 1);
      if (end === -1) break;
      nameMatch = propsBody.slice(i + 1, end);
      i = end + 1;
    } else {
      const m = /^([A-Za-z_$][\w$]*)/.exec(propsBody.slice(i));
      if (!m) break;
      nameMatch = m[1];
      i += m[1].length;
    }
    // Skip to `:` then to `{`
    while (i < propsBody.length && propsBody[i] !== ":") i++;
    i++;
    while (i < propsBody.length && /\s/.test(propsBody[i])) i++;
    if (propsBody[i] !== "{") {
      // Skip until next comma at depth 0
      let depth = 0;
      while (i < propsBody.length) {
        const c = propsBody[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === "," && depth === 0) break;
        i++;
      }
      props.push({ name: nameMatch, type: null, description: null });
      continue;
    }
    const propEnd = findMatching(propsBody, i, "{", "}");
    if (propEnd === -1) break;
    const propBody = propsBody.slice(i, propEnd + 1);
    const type = extractStringField(propBody, "type");
    const description = extractStringField(propBody, "description");
    props.push({ name: nameMatch, type, description });
    i = propEnd + 1;
  }

  // Extract required: [...]
  const required = [];
  const reqIdx = schema.indexOf("required");
  if (reqIdx !== -1) {
    const reqArrStart = schema.indexOf("[", reqIdx);
    if (reqArrStart !== -1) {
      const reqArrEnd = findMatching(schema, reqArrStart, "[", "]");
      if (reqArrEnd !== -1) {
        const reqBody = schema.slice(reqArrStart + 1, reqArrEnd);
        const items = reqBody.match(/['"]([^'"]+)['"]/g) || [];
        for (const it of items) required.push(it.slice(1, -1));
      }
    }
  }

  return { props, required };
}

const tools = toolBlocks
  .map((block) => {
    const name = extractStringField(block, "name");
    const description = extractStringField(block, "description");
    if (!name) return null;
    const scope = extractStringField(block, "scope");
    const { props, required } = extractInputSchemaProps(block);
    return { name, description: description || "", scope, props, required };
  })
  .filter(Boolean);

if (tools.length === 0) {
  console.error("[gen:mcp] no tools extracted — bailing out");
  process.exit(1);
}

tools.sort((a, b) => a.name.localeCompare(b.name));

const lines = [];
lines.push("---");
lines.push("title: MCP tools");
lines.push(
  "description: Reference for every Model Context Protocol tool the Kryton server exposes.",
);
lines.push("---");
lines.push("");
lines.push(
  "> Generated from `packages/server/src/modules/agents/mcp/tools.ts`. Re-run via `npm run gen:mcp` (also runs as part of `npm run prebuild`). Do not edit by hand.",
);
lines.push("");
lines.push(
  `Kryton's MCP server exposes ${tools.length} tools. Each is invocable by any AI agent that has been issued a Kryton API key with the appropriate scope.`,
);
lines.push("");

for (const tool of tools) {
  lines.push(`## ${tool.name}`);
  lines.push("");
  if (tool.description) {
    lines.push(tool.description);
    lines.push("");
  }
  if (tool.scope) {
    lines.push(`**Scope:** \`${tool.scope}\``);
    lines.push("");
  }
  if (tool.props.length === 0) {
    lines.push("**Parameters:** none.");
    lines.push("");
  } else {
    lines.push("**Parameters:**");
    lines.push("");
    lines.push("| Name | Type | Required | Description |");
    lines.push("| --- | --- | --- | --- |");
    for (const p of tool.props) {
      const req = tool.required.includes(p.name) ? "yes" : "no";
      const type = p.type ? `\`${p.type}\`` : "—";
      const desc = (p.description || "").replace(/\|/g, "\\|");
      lines.push(`| \`${p.name}\` | ${type} | ${req} | ${desc} |`);
    }
    lines.push("");
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n"));
console.log(`[gen:mcp] wrote ${tools.length} tools to ${outFile}`);
