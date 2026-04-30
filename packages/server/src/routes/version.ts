import { Router } from "express";
import { APP_VERSION, APP_COMMIT, APP_MAJOR_VERSION } from "../lib/version.js";

const syncApiVersion = "2.0.0";
const schemaVersion = "4.4.0";
const supportedClientRange = ">=4.4.0 <5.0.0";

export function createVersionRouter(): Router {
  const r = Router();

  r.get("/sync-version", (_req, res) => {
    res.json({
      apiVersion: syncApiVersion,
      schemaVersion,
      supportedClientRange,
      serverVersion: APP_VERSION,
      serverCommit: APP_COMMIT,
      serverMajorVersion: APP_MAJOR_VERSION,
    });
  });

  return r;
}
