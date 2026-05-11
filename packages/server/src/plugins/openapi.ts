import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
} from "fastify-type-provider-zod";
import type { AppConfig } from "../config/index.js";
import { APP_VERSION } from "../lib/version.js";
import { sharedSchemaRegistry } from "../shared-schemas/index.js";

/**
 * Kryton-themed Swagger UI overrides. Inlines the dark-theme tokens from
 * `packages/client/src/styles/tokens.css` (the swagger UI is served from a
 * stand-alone HTML shell, so it doesn't inherit our client's CSS variables).
 * Also hides the upstream `.topbar` (which carries the Fastify logo by
 * default) — the operation list already has its own info header.
 */
const KRYTON_SWAGGER_THEME = `
:root, .swagger-ui {
  --bg: oklch(0.18 0.012 280);
  --bg-1: oklch(0.205 0.014 280);
  --bg-2: oklch(0.235 0.016 282);
  --bg-3: oklch(0.27 0.018 282);
  --bg-input: oklch(0.225 0.014 282);
  --bg-hover: oklch(0.255 0.018 285 / 0.6);
  --line: oklch(0.32 0.012 280 / 0.6);
  --line-strong: oklch(0.4 0.014 280 / 0.7);
  --fg: oklch(0.96 0.005 280);
  --fg-1: oklch(0.85 0.01 280);
  --fg-2: oklch(0.65 0.012 280);
  --fg-3: oklch(0.5 0.012 280);
  --accent: oklch(0.72 0.18 295);
  --accent-soft: oklch(0.72 0.18 295 / 0.18);
  --accent-fg: oklch(0.18 0.02 280);
  --accent-2: oklch(0.78 0.14 200);
  --accent-warn: oklch(0.82 0.16 75);
  --accent-good: oklch(0.78 0.16 155);
  --accent-danger: oklch(0.7 0.2 25);
  --font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}

/* Hide the Fastify-branded topbar wholesale. */
.swagger-ui .topbar { display: none !important; }

html, body { background: var(--bg) !important; }
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }

.swagger-ui, .swagger-ui .info, .swagger-ui .scheme-container,
.swagger-ui .opblock-tag, .swagger-ui .opblock,
.swagger-ui .opblock .opblock-summary, .swagger-ui .opblock .opblock-body,
.swagger-ui .responses-wrapper, .swagger-ui .response-col_description__inner,
.swagger-ui .models, .swagger-ui .model,
.swagger-ui select, .swagger-ui input, .swagger-ui textarea {
  color: var(--fg);
}

.swagger-ui .info .title,
.swagger-ui .info h1, .swagger-ui .info h2, .swagger-ui .info h3,
.swagger-ui .opblock-tag,
.swagger-ui section.models h4,
.swagger-ui .model-title {
  color: var(--fg) !important;
}

.swagger-ui .info .title small,
.swagger-ui .info .title small pre,
.swagger-ui .info p, .swagger-ui .info li,
.swagger-ui .opblock-tag small,
.swagger-ui .opblock-description-wrapper p,
.swagger-ui .response-col_description__inner div.markdown p,
.swagger-ui .parameter__name, .swagger-ui .parameter__type,
.swagger-ui .parameter__in, .swagger-ui table thead tr th,
.swagger-ui table thead tr td, .swagger-ui .response-col_status,
.swagger-ui .opblock .opblock-section-header h4,
.swagger-ui .opblock .opblock-section-header > label {
  color: var(--fg-2) !important;
}

.swagger-ui .scheme-container {
  background: var(--bg-1) !important;
  border-bottom: 1px solid var(--line) !important;
  box-shadow: none !important;
}

.swagger-ui .info {
  margin: 24px 0 16px 0;
}

.swagger-ui .opblock-tag {
  border-bottom: 1px solid var(--line) !important;
}

.swagger-ui .opblock {
  background: var(--bg-1) !important;
  border: 1px solid var(--line) !important;
  box-shadow: none !important;
  border-radius: 8px !important;
  margin: 0 0 12px 0 !important;
}

.swagger-ui .opblock .opblock-summary {
  border-bottom: 1px solid var(--line) !important;
}

.swagger-ui .opblock .opblock-summary-method {
  font-family: var(--font-mono);
  text-shadow: none !important;
  background: var(--bg-2) !important;
  color: var(--fg) !important;
  border: 1px solid var(--line) !important;
  border-radius: 5px !important;
  min-width: 80px !important;
}

.swagger-ui .opblock-get .opblock-summary-method     { background: oklch(0.4 0.12 230 / 0.4) !important; color: var(--accent-2) !important; border-color: oklch(0.4 0.12 230 / 0.5) !important; }
.swagger-ui .opblock-post .opblock-summary-method    { background: oklch(0.4 0.16 155 / 0.4) !important; color: var(--accent-good) !important; border-color: oklch(0.4 0.16 155 / 0.5) !important; }
.swagger-ui .opblock-put .opblock-summary-method     { background: oklch(0.4 0.16 75 / 0.4)  !important; color: var(--accent-warn) !important; border-color: oklch(0.4 0.16 75 / 0.5)  !important; }
.swagger-ui .opblock-delete .opblock-summary-method  { background: oklch(0.4 0.2 25 / 0.4)   !important; color: var(--accent-danger) !important; border-color: oklch(0.4 0.2 25 / 0.5)   !important; }
.swagger-ui .opblock-patch .opblock-summary-method   { background: oklch(0.4 0.18 295 / 0.4) !important; color: var(--accent) !important; border-color: oklch(0.4 0.18 295 / 0.5) !important; }

.swagger-ui .opblock .opblock-summary-path,
.swagger-ui .opblock .opblock-summary-path a,
.swagger-ui .opblock .opblock-summary-path__deprecated,
.swagger-ui .opblock .opblock-summary-path__deprecated a {
  font-family: var(--font-mono);
  color: var(--fg) !important;
}

.swagger-ui input[type=text], .swagger-ui input[type=password],
.swagger-ui input[type=search], .swagger-ui input[type=email],
.swagger-ui textarea, .swagger-ui select {
  background: var(--bg-input) !important;
  color: var(--fg) !important;
  border: 1px solid var(--line) !important;
  border-radius: 5px !important;
  box-shadow: none !important;
  font-family: var(--font-mono);
  font-size: 12px;
}

.swagger-ui textarea.body-param__text {
  font-family: var(--font-mono);
  min-height: 150px;
}

.swagger-ui .btn {
  background: var(--bg-2) !important;
  color: var(--fg) !important;
  border: 1px solid var(--line) !important;
  border-radius: 5px !important;
  box-shadow: none !important;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
}
.swagger-ui .btn:hover { background: var(--bg-3) !important; }

.swagger-ui .btn.execute,
.swagger-ui .btn.authorize {
  background: var(--accent) !important;
  color: var(--accent-fg) !important;
  border-color: var(--accent) !important;
}
.swagger-ui .btn.authorize svg { fill: var(--accent-fg) !important; }

.swagger-ui .btn.cancel { background: transparent !important; color: var(--accent-danger) !important; border-color: var(--accent-danger) !important; }

.swagger-ui .response, .swagger-ui .responses-wrapper {
  background: transparent !important;
}
.swagger-ui table tbody tr td,
.swagger-ui table thead tr td, .swagger-ui table thead tr th {
  background: transparent !important;
  border-color: var(--line) !important;
}
.swagger-ui .response-col_status { font-family: var(--font-mono); }

.swagger-ui pre, .swagger-ui .microlight,
.swagger-ui .highlight-code,
.swagger-ui .body-param__text,
.swagger-ui .markdown code, .swagger-ui .renderedMarkdown code {
  background: var(--bg) !important;
  color: var(--fg) !important;
  border: 1px solid var(--line) !important;
  border-radius: 6px !important;
  font-family: var(--font-mono);
  font-size: 12px;
}

.swagger-ui .opblock-description-wrapper, .swagger-ui .opblock-external-docs-wrapper, .swagger-ui .opblock-title_normal {
  background: transparent !important;
}

.swagger-ui section.models {
  background: var(--bg-1) !important;
  border: 1px solid var(--line) !important;
  border-radius: 8px !important;
}
.swagger-ui section.models.is-open h4 { border-bottom: 1px solid var(--line) !important; }

.swagger-ui .model-box { background: var(--bg-2) !important; border: 1px solid var(--line) !important; }
.swagger-ui .model, .swagger-ui .model-toggle::after { color: var(--fg) !important; }
.swagger-ui .prop-type { color: var(--accent-2) !important; }
.swagger-ui .prop-format { color: var(--fg-3) !important; }

.swagger-ui .auth-wrapper, .swagger-ui .dialog-ux .modal-ux {
  background: var(--bg-1) !important;
  border: 1px solid var(--line) !important;
  color: var(--fg) !important;
}
.swagger-ui .dialog-ux .modal-ux-content,
.swagger-ui .dialog-ux .modal-ux-header h3,
.swagger-ui .dialog-ux .modal-ux-content h4 { color: var(--fg) !important; }

.swagger-ui svg { fill: var(--fg-2); }
.swagger-ui .arrow { fill: var(--fg-2) !important; }

a, .swagger-ui a { color: var(--accent) !important; }
`;

interface OpenApiOptions {
  config: AppConfig;
}

export const openapiPlugin = fp<OpenApiOptions>(async (app, { config }) => {
  if (!config.OPENAPI_ENABLED) return;

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Kryton API",
        description: "Kryton server API",
        version: APP_VERSION,
      },
      servers: [{ url: config.BETTER_AUTH_URL }],
      tags: [
        { name: "platform", description: "Health, version, admin, settings" },
        { name: "identity", description: "Auth, users, API keys" },
        { name: "notes", description: "Notes, folders, attachments, canvas" },
        { name: "knowledge", description: "Search, graph" },
        { name: "collab", description: "Shares, sync, realtime" },
        { name: "agents", description: "Agents and MCP" },
        { name: "plugins", description: "Plugin runtime" },
      ],
    },
    transform: createJsonSchemaTransform({ schemaRegistry: sharedSchemaRegistry }),
    transformObject: createJsonSchemaTransformObject({ schemaRegistry: sharedSchemaRegistry }),
  });

  await app.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
    staticCSP: true,
    theme: {
      title: "Kryton API",
      css: [{ filename: "kryton-theme.css", content: KRYTON_SWAGGER_THEME }],
    },
  });
}, { name: "openapi" });
