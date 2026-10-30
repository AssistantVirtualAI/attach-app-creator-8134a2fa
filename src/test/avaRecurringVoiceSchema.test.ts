import { describe, expect, it } from "vitest";
import { buildAvaToolConfigs } from "../../supabase/functions/_shared/ava-tools";

describe("ElevenLabs recurring-task parameter acceptance", () => {
  for (const name of ["create_task", "create_calendar_event"]) {
    it(`${name} supplies descriptions for every nested recurrence value`, () => {
      const tool = buildAvaToolConfigs("https://example.test", "public-key").find((entry: any) => entry.tool_config.name === name);
      expect(tool).toBeDefined();
      const recurrence = tool?.tool_config.parameters?.properties?.recurrence;
      expect(recurrence?.properties?.value?.description).toEqual(expect.any(String));
      expect(recurrence?.properties?.pattern?.description).toEqual(expect.any(String));
      expect(recurrence?.properties?.on?.items?.description).toEqual(expect.any(String));
    });
  }
});