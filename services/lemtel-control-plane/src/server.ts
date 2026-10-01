import { loadConfig } from "./config.js";
import { ConfigError } from "./lib/errors.js";
import { buildApp } from "./app.js";
import { createPool, PgStore } from "./db.js";
import { createRedisPing } from "./redis.js";

async function main() {
  let cfg;
  try { cfg = loadConfig(); }
  catch (e) {
    process.stderr.write(`${e instanceof ConfigError ? e.message : "config_invalid"}\n`);
    process.exit(1);
  }
  const pool = createPool(cfg.databaseUrl);
  const store = new PgStore(pool);
  const redis = createRedisPing(cfg.redisUrl);
  const app = buildApp({ token: cfg.serviceToken, db: store, redis, audit: store, logLevel: cfg.logLevel });
  const stop = async () => { await app.close(); await pool.end(); await redis.close(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  await app.listen({ host: "0.0.0.0", port: cfg.port });
}

void main();
