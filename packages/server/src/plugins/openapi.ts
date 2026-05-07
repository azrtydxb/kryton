import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import type { AppConfig } from "../config/index.js";
import { APP_VERSION } from "../lib/version.js";

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
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
    staticCSP: true,
  });
}, { name: "openapi" });
