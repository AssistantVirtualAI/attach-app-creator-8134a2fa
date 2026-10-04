import { request } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { SERVICE } from "./routes/health.js";

const MAX_BYTES = 1024;
const DEADLINE_MS = 2000;

// Container liveness only. Full application readiness (Auth, Storage, Functions)
// belongs to the separately gated Lemtel API, not to this Control Plane.
export async function checkLiveness(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return new Promise((resolve) => {
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (live: boolean) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(live);
    };
    const req = request({ hostname: "127.0.0.1", port, path: "/health/live", method: "GET", timeout: DEADLINE_MS }, (res) => {
      const length = Number(res.headers["content-length"]);
      if (res.statusCode !== 200 || !/^application\/json(?:\s*;|$)/i.test(String(res.headers["content-type"] ?? "")) ||
          (Number.isFinite(length) && length > MAX_BYTES)) {
        finish(false);
        req.destroy();
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { finish(false); req.destroy(); return; }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (finished) return;
        try {
          const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          finish(typeof result === "object" && result !== null &&
            "service" in result && result.service === SERVICE &&
            "status" in result && result.status === "live");
        } catch { finish(false); }
      });
      res.on("error", () => finish(false));
    });
    timer = setTimeout(() => { finish(false); req.destroy(); }, DEADLINE_MS);
    req.on("timeout", () => { finish(false); req.destroy(); });
    req.on("error", () => finish(false));
    req.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    void checkLiveness(loadConfig().port).then((live) => { process.exitCode = live ? 0 : 1; });
  } catch { process.exitCode = 1; }
}
