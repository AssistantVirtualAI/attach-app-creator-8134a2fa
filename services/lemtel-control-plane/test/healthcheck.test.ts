import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { checkLiveness } from "../src/healthcheck.js";

async function withServer(handler: RequestListener, run: (port: number) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run((server.address() as AddressInfo).port); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("liveness checks the configured, non-default port and exact service JSON", async () => {
  await withServer((req, res) => {
    assert.equal(req.url, "/health/live");
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ service: "lemtel-control-plane", status: "live", version: "0.1.0" }));
  }, async (port) => assert.equal(await checkLiveness(port), true));
});

test("a parking page or unrelated JSON is not the Control Plane", async () => {
  for (const [status, type, body] of [
    [200, "text/html", "<h1>Parking</h1>"],
    [200, "application/json", '{"service":"other","status":"live"}'],
    [503, "application/json", '{"service":"lemtel-control-plane","status":"live"}'],
    [200, "application/jsonp", '{"service":"lemtel-control-plane","status":"live"}'],
    [200, "application/json", "{"],
    [200, "application/json", "x".repeat(2048)],
  ] as const) {
    await withServer((_req, res) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    }, async (port) => assert.equal(await checkLiveness(port), false));
  }
});

test("an oversized Content-Length fails before reading the body", async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json", "content-length": "8192" });
    res.write("{");
  }, async (port) => assert.equal(await checkLiveness(port), false));
});

test("a slowly trickling local server cannot extend the total deadline", async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    const interval = setInterval(() => res.write(" "), 50);
    res.on("close", () => clearInterval(interval));
  }, async (port) => {
    const start = Date.now();
    assert.equal(await checkLiveness(port), false);
    assert.ok(Date.now() - start < 2700);
  });
});

test("invalid ports and an unavailable local service fail closed", async () => {
  assert.equal(await checkLiveness(0), false);
  assert.equal(await checkLiveness(65536), false);
  assert.equal(await checkLiveness(NaN), false);
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const n = (server.address() as AddressInfo).port;
      server.close(() => resolve(n));
    });
  });
  assert.equal(await checkLiveness(port), false);
});

test("Docker invokes the built healthcheck and no longer hard-codes the health port", () => {
  const dockerfile = readFileSync(join(import.meta.dirname, "../Dockerfile"), "utf8");
  assert.match(dockerfile, /HEALTHCHECK\b[^\n]*CMD node dist\/src\/healthcheck\.js/);
  assert.doesNotMatch(dockerfile, /HEALTHCHECK\b[^\n]*8080/);
});
