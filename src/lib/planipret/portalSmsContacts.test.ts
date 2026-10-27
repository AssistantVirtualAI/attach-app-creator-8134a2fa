import { describe, expect, it } from "vitest";
import { portalSmsContacts, filterPortalSmsContacts } from "./portalSmsContacts";

describe("portal SMS recipients", () => {
  it("retains extension 113 separately from external DID numbers", () => {
    expect(portalSmsContacts([{ name: "Broker", extension: "113", phone: "5145550199" }])).toEqual([
      { name: "Broker", number: "+15145550199" }, { name: "Broker", number: "113" },
    ]);
  });
  it("deduplicates the same named number without discarding alternate numbers", () => {
    expect(portalSmsContacts([{ full_name: "Client", phone: "5145550199", cell_phone: "+15145550199", home_phone: "5145550188" }])).toHaveLength(2);
  });
  it("searches names with accents and formatted numbers", () => {
    const contacts = portalSmsContacts([{ full_name: "Mégane Client", phone: "5145550199" }]);
    expect(filterPortalSmsContacts(contacts, "Megane")).toHaveLength(1);
    expect(filterPortalSmsContacts(contacts, "(514) 555-0199")).toHaveLength(1);
    expect(filterPortalSmsContacts(contacts, "Other")).toHaveLength(0);
  });
});