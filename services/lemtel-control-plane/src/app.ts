import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { AuditStore, Pingable } from "./db.js";
import type { LogLevel } from "./config.js";
import { loggerOptions } from "./logger.js";
import { healthRoutes } from "./routes/health.js";
import { internalRoutes } from "./routes/internal.js";

export type AppDeps = { token: string; db: Pingable; redis: Pingable; audit: AuditStore; logLevel?: LogLevel | "silent"; readyTimeoutMs?: number };

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logLevel === "silent" || !deps.logLevel ? false : loggerOptions(deps.logLevel),
    bodyLimit: 4096,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
  });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-request-id", req.id);
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    reply.removeHeader("x-powered-by");
    return payload;
  });

  app.setErrorHandler((err: { statusCode?: number }, _req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(code).send({ error: code === 500 ? "internal_error" : code === 413 ? "payload_too_large" : code === 415 ? "unsupported_media_type" : "bad_request" });
  });
  app.setNotFoundHandler((_req, reply) => { reply.code(404).send({ error: "not_found" }); });

  app.register(async (s) => healthRoutes(s, { db: deps.db, redis: deps.redis, timeoutMs: deps.readyTimeoutMs }));
  app.register(async (s) => internalRoutes(s, { token: deps.token, audit: deps.audit }));
  return app;
}
