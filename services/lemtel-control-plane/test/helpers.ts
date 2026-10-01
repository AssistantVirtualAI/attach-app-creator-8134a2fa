import { buildApp } from "../src/app.js";
import type { AuditInput, AuditStore, Pingable } from "../src/db.js";

export const TOKEN = "Lc7vQ2mZr9TpX4kW8nB3hJ6yF1sD5gA0uE";
export const ok: Pingable = { ping: async () => undefined };
export const down: Pingable = { ping: async () => { throw new Error("ECONNREFUSED 10.0.0.1"); } };
export const hang: Pingable = { ping: () => new Promise(() => undefined) };

export class MemoryAudit implements AuditStore {
  rows: { action: string; requestId?: string; source: string }[] = [];
  async recordAudit(e: AuditInput) {
    if (e.requestId && this.rows.some((r) => r.requestId === e.requestId)) return { duplicate: true };
    this.rows.push({ ...e, source: "internal_test" }); return { duplicate: false };
  }
}

export function app(over: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({ token: TOKEN, db: ok, redis: ok, audit: new MemoryAudit(), logLevel: "silent", readyTimeoutMs: 100, ...over });
}
