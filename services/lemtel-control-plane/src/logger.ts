import type { FastifyServerOptions } from "fastify";
import type { LogLevel } from "./config.js";

export function loggerOptions(level: LogLevel): FastifyServerOptions["logger"] {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization", "req.headers.cookie", "req.headers[\"set-cookie\"]",
        "res.headers[\"set-cookie\"]", "*.password", "*.secret", "*.token", "*.credential",
        "*.api_key", "*.sip", "*.pbx", "*.databaseUrl", "*.redisUrl", "*.serviceToken",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      req: (r: { method?: string; url?: string; id?: string }) => ({ method: r.method, url: r.url, id: r.id }),
    },
  };
}
