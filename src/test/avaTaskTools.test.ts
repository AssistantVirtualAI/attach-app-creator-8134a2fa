import { describe, it, expect } from "vitest";
import { buildAvaToolConfigs, EXPECTED_TOOL_NAMES } from "../../supabase/functions/_shared/ava-tools";
import {
  AVA_CONFIRM_REQUIRED,
  AVA_MUTATING_ACTIONS,
  isAvaMutatingAction,
  requiresVoiceConfirmation,
} from "@/lib/planipret/avaMutations";

const TASK_TOOLS = ["list_tasks", "get_task", "create_task", "update_task", "delete_task"];

describe("AVA task tools (chat + voice share the same schemas)", () => {
  const configs = buildAvaToolConfigs("https://example.supabase.co", "anon");
  const byName = new Map(configs.map((c: any) => [c.name ?? c.tool_config?.name, c]));

  it("exposes the five task tools", () => {
    for (const t of TASK_TOOLS) {
      expect(EXPECTED_TOOL_NAMES).toContain(t);
      expect(byName.has(t)).toBe(true);
    }
  });

  it("create_task requires target, target_type, notes and due_at", () => {
    const spec = JSON.stringify(byName.get("create_task"));
    for (const f of ["target", "target_type", "notes", "due_at"]) expect(spec).toContain(f);
    // Calendar sync and notifications must be opt-in parameters, never implicit.
    expect(spec).toContain("sync_calendar");
    expect(spec).toContain("notification");
  });

  it("update_task takes task_id + changes", () => {
    const spec = JSON.stringify(byName.get("update_task"));
    expect(spec).toContain("task_id");
    expect(spec).toContain("changes");
  });

  it("delete_task advertises an explicit confirmation flag", () => {
    const spec = JSON.stringify(byName.get("delete_task"));
    expect(spec).toContain("confirmed");
    expect(spec.toLowerCase()).toContain("confirmation");
  });

  it("list_tasks supports the overdue/today/upcoming filter and pagination", () => {
    const spec = JSON.stringify(byName.get("list_tasks"));
    for (const f of ["filter", "status", "page", "limit"]) expect(spec).toContain(f);
  });
});

describe("AVA confirmation barriers", () => {
  it("treats the three task mutations as mutating chat actions", () => {
    for (const a of ["create_task", "update_task", "delete_task"]) {
      expect(AVA_MUTATING_ACTIONS.has(a)).toBe(true);
      expect(isAvaMutatingAction(a)).toBe(true);
    }
  });

  it("does not gate read-only task tools", () => {
    expect(isAvaMutatingAction("list_tasks")).toBe(false);
    expect(isAvaMutatingAction("get_task")).toBe(false);
  });

  it("requires a verbal confirmation for every task mutation in voice mode", () => {
    for (const a of ["create_task", "update_task", "delete_task"]) {
      expect(AVA_CONFIRM_REQUIRED.has(a)).toBe(true);
      expect(requiresVoiceConfirmation(a)).toBe(true);
    }
  });

  it("delete always requires confirmation, even in autonomous mode", () => {
    expect(requiresVoiceConfirmation("delete_task")).toBe(true);
  });
});
