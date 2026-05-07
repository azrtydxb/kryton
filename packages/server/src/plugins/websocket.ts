import fp from "fastify-plugin";
import websocket from "@fastify/websocket";

export const websocketPlugin = fp(async (app) => {
  await app.register(websocket, {
    options: {
      maxPayload: 10 * 1024 * 1024, // 10 MB
    },
  });
}, { name: "websocket" });
