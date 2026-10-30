import { describe, expect, it } from "vitest";
import { buildDigestHtml, categorize, localDayStartIso } from "../../supabase/functions/_shared/email-digest";

const mail = (i: number, extra: any = {}) => ({ id: `m${i}`, subject: `Sujet ${i}`, from: { emailAddress: { name: `Client ${i}`, address: `c${i}@ex.com` } }, receivedDateTime: "2026-10-30T14:00:00Z", isRead: true, ...extra });

describe("email digest", () => {
  it("includes every email of the day, not only 20", () => {
    const mails = Array.from({ length: 57 }, (_, i) => mail(i));
    const d = buildDigestHtml({ brokerName: "Marc", dateLabel: "30 octobre", mails });
    expect(d.total).toBe(57);
    for (let i = 0; i < 57; i++) expect(d.html).toContain(`Sujet ${i}<`);
    expect(d.html).not.toContain("d'autres courriels");
  });
  it("classifies newsletters as info and flagged/unread human mail as priority", () => {
    expect(categorize(mail(1, { from: { emailAddress: { name: "Deal Centre", address: "noreply@tmg.ca" } } }))).toBe("info");
    expect(categorize(mail(2, { flag: { flagStatus: "flagged" } }))).toBe("priority");
    expect(categorize(mail(3, { isRead: false }))).toBe("priority");
    expect(categorize(mail(4))).toBe("people");
  });
  it("escapes email content", () => {
    const d = buildDigestHtml({ brokerName: "M", dateLabel: "x", mails: [mail(1, { subject: "<script>x</script>" })] });
    expect(d.html).not.toContain("<script>");
  });
  it("computes Toronto day start", () => {
    expect(localDayStartIso("America/Toronto", new Date("2026-10-30T04:54:00Z"))).toBe("2026-10-30T04:00:00.000Z");
  });
});
