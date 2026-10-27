import { normalizePortalMessageRecipient } from "./portalMessageRecipient";

export type PortalSmsContact = { name: string; number: string };

/** Only call with contact lists returned for the authenticated broker. */
export function portalSmsContacts(rows: Record<string, unknown>[]): PortalSmsContact[] {
  const contacts = new Map<string, PortalSmsContact>();
  for (const row of rows) {
    const name = String(row.display_name || row.full_name || row.name || [row.first_name ?? row.firstname, row.last_name ?? row.lastname].filter(Boolean).join(" ") || row.extension || "");
    const phones = [row.cell_phone, row.mobile, row.phone, row.phone_number, row.work_phone, row.home_phone, row.extension];
    if (Array.isArray(row.telephones)) for (const item of row.telephones) {
      if (item && typeof item === "object") phones.push(item.telephone_number ?? item.phone ?? item.number);
    }
    for (const phone of phones) {
      if (typeof phone !== "string" && typeof phone !== "number") continue;
      const number = normalizePortalMessageRecipient(String(phone));
      if (!number) continue;
      const key = `${name.toLocaleLowerCase()}|${number}`;
      if (!contacts.has(key)) contacts.set(key, { name: name || number, number });
    }
  }
  return [...contacts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterPortalSmsContacts(contacts: PortalSmsContact[], query: string): PortalSmsContact[] {
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const tokens = fold(query).trim().split(/\s+/).filter(Boolean);
  const digits = query.replace(/\D/g, "");
  return contacts.filter((contact) => tokens.every((token) => fold(`${contact.name} ${contact.number}`).includes(token)) || Boolean(digits && contact.number.replace(/\D/g, "").includes(digits) && !/[a-zA-Z]/.test(query)));
}