import type { FastifyInstance } from "fastify";
import type { Pingable } from "../db.js";

export const SERVICE = "lemtel-control-plane";
export const VERSION = "0.1.0";

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(() => { clearTimeout(t); resolve(); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function healthRoutes(app: FastifyInstance, deps: { db: Pingable; redis: Pingable; timeoutMs?: number }) {
  app.get("/health/live", async () => ({ service: SERVICE, version: VERSION, status: "live" }));
  app.get("/health/ready", async (_req, reply) => {
    const ms = deps.timeoutMs ?? 1500;
    try {
      await Promise.all([withTimeout(deps.db.ping(), ms), withTimeout(deps.redis.ping(), ms)]);
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });
}
