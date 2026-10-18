import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("imports pure Claude helpers without Deno and skips server telemetry", async () => {
  vi.stubGlobal("Deno", undefined);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { toClaudeModel, logAiUsage } = await import("../../supabase/functions/_shared/claude-compat");
  expect(toClaudeModel("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5-20250929");
  logAiUsage({ provider: "claude", input_tokens: 12, output_tokens: 4 });
  expect(fetchMock).not.toHaveBeenCalled();
});