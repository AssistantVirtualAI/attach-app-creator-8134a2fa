import { describe, it, expect } from "vitest";
import { parseLemtelCsv, resultsCsv, csvTemplate } from "../lemtelCsv";
import { toLemtelErrorKey } from "../lemtelHostedApi";

describe("Lemtel bulk CSV", () => {
  it("validates rows", () => {
    const { rows, headerError } = parseLemtelCsv(
      "first_name,last_name,email,language,role\nA,B,a@x.com,fr,user\nC,,bad,de,boss\nE,F,a@x.com,,user",
    );
    expect(headerError).toBe(false);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors).toEqual(expect.arrayContaining(["missing_name", "invalid_email", "invalid_language", "invalid_role"]));
    expect(rows[2].errors).toContain("duplicate_email");
    expect(rows[2].warnings).toContain("language_inherited");
  });
  it("rejects bad header", () => expect(parseLemtelCsv("foo,bar\n1,2").headerError).toBe(true));
  it("template has only allowed columns", () =>
    expect(csvTemplate().split("\n")[0]).toBe("first_name,last_name,email,language,role,department,title"));
  it("results export has no secrets", () => {
    const csv = resultsCsv([{ email: "a@x.com", status: "invited" }]);
    expect(csv).not.toMatch(/password|token/i);
  });
});

describe("Lemtel error mapping", () => {
  it("never leaks raw text", () => {
    expect(toLemtelErrorKey("Edge Function returned a non-2xx status code", 500)).toBe("unavailable");
    expect(toLemtelErrorKey("temporary_password_expired")).toBe("temp_expired");
    expect(toLemtelErrorKey("password_already_personalized")).toBe("already_personalized");
    expect(toLemtelErrorKey("TypeError: Failed to fetch")).toBe("network");
  });
});
