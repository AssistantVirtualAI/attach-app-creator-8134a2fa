import { describe, expect, it } from "vitest";
import { matchesAvaTaskSearch } from "../../supabase/functions/_shared/ava-task-search";

describe("AVA task context", () => {
  const task = { id: "954606", notes: "Compléter l’entrée de commission", target_name: "Contrat new function copy client", raw: { client_id: "273968" } };
  it("matches the supplied client reference independently of the task id", () => {
    expect(matchesAvaTaskSearch(task, "Contrat new function copy client #273968")).toBe(true);
    expect(matchesAvaTaskSearch(task, "#954606")).toBe(false);
  });
  it("does not match part of another client number", () => {
    expect(matchesAvaTaskSearch(task, "#27396")).toBe(false);
  });
});