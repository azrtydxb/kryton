import { loadEnv } from "./config/index.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadEnv();
  const app = await buildApp({ config });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (err) {
    app.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

void main();
