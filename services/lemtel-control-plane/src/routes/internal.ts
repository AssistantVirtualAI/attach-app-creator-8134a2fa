import type { FastifyInstance } from "fastify";
import type { AuditStore } from "../db.js";
import { makeServiceGuard } from "../auth.js";

export const ACTION_RE = /^control_plane\.[a-z0-9_.]{1,64}$/;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function internalRoutes(app: FastifyInstance, deps: { token: string; audit: AuditStore }) {
  app.addHook("onRequest", makeServiceGuard(deps.token));

  app.get("/v1/internal/status", async () => ({
    controlPlane: "foundation", edge: "disabled", fusionPbx: "disabled", push: "disabled",
  }));

  app.post("/v1/internal/audit", async (req, reply) => {
    const ct = String(req.headers["content-type"] ?? "");
    if (!/^application\/json(\s*;.*)?$/i.test(ct)) return reply.code(415).send({ error: "unsupported_media_type" });
    const b = req.body as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b)) return reply.code(400).send({ error: "invalid_body" });
    const keys = Object.keys(b);
    if (keys.some((k) => k !== "action" && k !== "requestId")) return reply.code(400).send({ error: "unknown_field" });
    if (typeof b.action !== "string" || !ACTION_RE.test(b.action)) return reply.code(400).send({ error: "invalid_action" });
    if (b.requestId !== undefined && (typeof b.requestId !== "string" || !REQUEST_ID_RE.test(b.requestId))) return reply.code(400).send({ error: "invalid_request_id" });
    try {
      await deps.audit.recordAudit({ action: b.action, requestId: b.requestId as string | undefined });
    } catch {
      return reply.code(500).send({ error: "internal_error" });
    }
    return { ok: true };
  });
}
