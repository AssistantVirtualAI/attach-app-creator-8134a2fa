import { ConfigError } from "./lib/errors.js";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";
export type Config = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  redisUrl: string;
  serviceToken: string;
  logLevel: LogLevel;
};

const PLACEHOLDER = /(changeme|change-me|replace-me|replaceme|default|secret|password|example|placeholder|xxx)/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function req(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (v === undefined || v.trim() === "") throw new ConfigError(name, "missing");
  return v.trim();
}

export function validateToken(name: string, v: string): string {
  if (v.length < 32) throw new ConfigError(name, "too_short");
  if (PLACEHOLDER.test(v) || /^0+$/.test(v) || /^(.)\1+$/.test(v)) throw new ConfigError(name, "weak");
  if (!/^[A-Za-z0-9_\-.~+/=]+$/.test(v)) throw new ConfigError(name, "malformed");
  return v;
}

function validateUrl(name: string, v: string, schemes: string[], prod: boolean): string {
  let u: URL;
  try { u = new URL(v); } catch { throw new ConfigError(name, "malformed"); }
  if (!schemes.includes(u.protocol)) throw new ConfigError(name, "scheme_not_allowed");
  if (!u.hostname) throw new ConfigError(name, "malformed");
  const pw = decodeURIComponent(u.password || "");
  if (pw && (PLACEHOLDER.test(pw) || pw.length < 12)) throw new ConfigError(name, "weak_password");
  if (prod && (LOCAL_HOSTS.has(u.hostname) || !pw)) throw new ConfigError(name, "insecure_for_production");
  return v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = req(env, "NODE_ENV");
  if (!["development", "test", "production"].includes(nodeEnv)) throw new ConfigError("NODE_ENV", "malformed");
  const prod = nodeEnv === "production";
  const portRaw = req(env, "CONTROL_PLANE_PORT");
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) throw new ConfigError("CONTROL_PLANE_PORT", "malformed");
  const databaseUrl = validateUrl("CONTROL_PLANE_DATABASE_URL", req(env, "CONTROL_PLANE_DATABASE_URL"), ["postgres:", "postgresql:"], prod);
  const redisUrl = validateUrl("CONTROL_PLANE_REDIS_URL", req(env, "CONTROL_PLANE_REDIS_URL"), ["redis:", "rediss:"], prod);
  const serviceToken = validateToken("CONTROL_PLANE_SERVICE_TOKEN", req(env, "CONTROL_PLANE_SERVICE_TOKEN"));
  const logLevel = req(env, "CONTROL_PLANE_LOG_LEVEL") as LogLevel;
  if (!["fatal", "error", "warn", "info", "debug", "trace"].includes(logLevel)) throw new ConfigError("CONTROL_PLANE_LOG_LEVEL", "malformed");
  if (prod && (logLevel === "debug" || logLevel === "trace")) throw new ConfigError("CONTROL_PLANE_LOG_LEVEL", "debug_not_allowed_in_production");
  return { nodeEnv: nodeEnv as Config["nodeEnv"], port, databaseUrl, redisUrl, serviceToken, logLevel };
}
