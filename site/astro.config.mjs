// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://azrtydxb.github.io",
  base: "/kryton",
  integrations: [
    starlight({
      title: "Kryton",
      logo: { src: "./public/logo.svg", replacesTitle: true },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/azrtydxb/kryton" }],
      customCss: ["./src/styles/tokens.css", "./src/styles/custom.css"],
      sidebar: [
        {
          label: "Get Started",
          items: [
            { label: "Overview", slug: "start" },
            { label: "Install with Docker", slug: "start/install/docker" },
            { label: "Connect your AI", slug: "start/connect-ai" },
            { label: "Your first notes", slug: "start/first-notes" },
          ],
        },
        {
          label: "Use",
          items: [
            { label: "Overview", slug: "use" },
            { label: "Editor", slug: "use/editor" },
            { label: "Linking and graph", slug: "use/linking-and-graph" },
            { label: "Search and tags", slug: "use/search-and-tags" },
            { label: "Sharing", slug: "use/sharing" },
            { label: "Mobile", slug: "use/mobile" },
            { label: "Plugins", slug: "use/plugins" },
            { label: "AI agents", slug: "use/ai-agents" },
          ],
        },
        {
          label: "Advanced",
          collapsed: true,
          items: [
            { label: "Overview", slug: "advanced" },
            {
              label: "Deployment",
              collapsed: true,
              items: [
                { label: "Docker Compose", slug: "advanced/deployment/docker-compose" },
                { label: "Helm chart", slug: "advanced/deployment/helm" },
                { label: "Kubernetes Operator", slug: "advanced/deployment/operator" },
                { label: "Free-tier self-host", slug: "advanced/deployment/free-tier-self-host" },
                { label: "Backups and restore", slug: "advanced/deployment/backups-restore" },
                { label: "Upgrades and migrations", slug: "advanced/deployment/upgrades-and-migrations" },
              ],
            },
            {
              label: "Security",
              collapsed: true,
              items: [
                { label: "Auth providers", slug: "advanced/security/auth-providers" },
                { label: "API keys and MCP", slug: "advanced/security/api-keys-and-mcp" },
                { label: "Reverse proxy and TLS", slug: "advanced/security/reverse-proxy-and-tls" },
              ],
            },
            {
              label: "API",
              collapsed: true,
              items: [
                { label: "REST", slug: "advanced/api/rest" },
                { label: "MCP tools", slug: "advanced/api/mcp-tools" },
                { label: "Yjs WebSocket", slug: "advanced/api/yjs-websocket" },
              ],
            },
            {
              label: "Plugins",
              collapsed: true,
              items: [
                { label: "Overview", slug: "advanced/plugins/overview" },
                { label: "Quickstart", slug: "advanced/plugins/quickstart" },
                { label: "Client API", slug: "advanced/plugins/client-api" },
                { label: "Server API", slug: "advanced/plugins/server-api" },
                { label: "UI slots", slug: "advanced/plugins/ui-slots" },
                { label: "Code-fence renderers", slug: "advanced/plugins/code-fence-renderers" },
                { label: "Testing and publishing", slug: "advanced/plugins/testing-and-publishing" },
              ],
            },
            {
              label: "Contributing",
              collapsed: true,
              items: [
                { label: "Dev setup", slug: "advanced/contributing/dev-setup" },
                { label: "Commit conventions", slug: "advanced/contributing/commit-conventions" },
                { label: "Release process", slug: "advanced/contributing/release-process" },
              ],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [
                { label: "Environment variables", slug: "advanced/reference/env-vars" },
                { label: "Configuration", slug: "advanced/reference/configuration" },
                { label: "CLI", slug: "advanced/reference/cli" },
                { label: "Changelog", slug: "advanced/reference/changelog" },
              ],
            },
          ],
        },
      ],
    }),
  ],
});
