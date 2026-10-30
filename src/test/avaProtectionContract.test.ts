// AVA protection contract: locks working AVA behaviour. Changing any of these
// assertions requires an explicit owner decision (see AGENTS.md).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EXPECTED_TOOL_NAMES, buildAvaToolsArray } from "../../supabase/functions/_shared/ava-tools.ts";
import { normalizeAvaEmailPayload } from "../../supabase/functions/ava-tool-executor/emailPayload.ts";

const tools = buildAvaToolsArray("https://example.test", "anon") as any[];
const nameOf = (t: any) => t?.name ?? t?.function?.name ?? t?.tool_config?.name;
const names = tools.map(nameOf).filter(Boolean);
const voiceSrc = readFileSync("src/components/planipret/mobile/AvaVoiceAgent.tsx", "utf8");

describe("AVA protection contract", () => {
  it("keeps every registered tool names, without duplicates", () => {
    expect(EXPECTED_TOOL_NAMES.length).toBe(new Set(EXPECTED_TOOL_NAMES).size);
    for (const n of ["send_email", "send_sms", "make_call", "list_tasks", "complete_task", "get_commission_summary", "list_my_clients", "get_voicemails"]) {
      expect(EXPECTED_TOOL_NAMES).toContain(n);
    }
  });

  it("registry exposes no unknown tools", () => {
    for (const n of names) expect(EXPECTED_TOOL_NAMES).toContain(n);
  });

  it("voice email maps to_email to the Microsoft 365 'to' field and keeps explicit recipients", () => {
    expect(normalizeAvaEmailPayload({ to_email: " a@b.ca " }).to).toBe("a@b.ca");
    expect(normalizeAvaEmailPayload({ to: "x@y.ca", to_email: "a@b.ca" }).to).toBe("x@y.ca");
  });

  it("sensitive voice actions still require confirmation", () => {
    for (const n of ["make_call", "hangup_call", "send_sms", "send_email", "create_task", "complete_task", "delete_task", "create_client", "update_client"]) {
      expect(voiceSrc).toMatch(new RegExp(`CONFIRM_REQUIRED = new Set\\([\\s\\S]*"${n}"`));
    }
  });

  it("voice confirmations are never stranded (superseded, session end, failures settle)", () => {
    expect(voiceSrc).toContain("confirmation_superseded");
    expect(voiceSrc).toContain("session_ended");
    expect(voiceSrc).toMatch(/\.then\(resolve, fail\)/);
  });
});
