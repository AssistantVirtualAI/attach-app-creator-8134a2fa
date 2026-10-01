import { createClient } from "redis";
import type { Pingable } from "./db.js";

export function createRedisPing(redisUrl: string): Pingable & { close(): Promise<void> } {
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 2000, reconnectStrategy: false } });
  client.on("error", () => { /* surfaced through readiness only */ });
  return {
    async ping() {
      if (!client.isOpen) await client.connect();
      await client.ping();
    },
    async close() { if (client.isOpen) await client.quit(); },
  };
}
