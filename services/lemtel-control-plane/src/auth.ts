import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function extractBearer(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer ([A-Za-z0-9_\-.~+/=]{32,512})$/.exec(header);
  return m ? m[1] : null;
}

export function makeServiceGuard(expected: string) {
  return async function guard(req: FastifyRequest, reply: FastifyReply) {
    const token = extractBearer(req.headers.authorization);
    if (!token || !constantTimeEqual(token, expected)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}
