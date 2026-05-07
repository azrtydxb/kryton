import fp from "fastify-plugin";
import multipart from "@fastify/multipart";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export const multipartPlugin = fp(async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1,
    },
    attachFieldsToBody: false,
  });
}, { name: "multipart" });
