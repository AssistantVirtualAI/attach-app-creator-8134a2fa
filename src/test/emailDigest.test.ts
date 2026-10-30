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

import { buildDailyReportHtml, callStats, smsThreads } from "../../supabase/functions/_shared/email-digest";
describe("daily report", () => {
  const calls = [
    { direction: "inbound", status: "completed", answered_at: "x", duration_seconds: 120, started_at: "2026-10-30T14:05:00Z", from_number: "5145551111" },
    { direction: "inbound", status: "inbound_ringing", started_at: "2026-10-30T15:05:00Z", from_number: "5145552222" },
    { direction: "missed", status: "no-answer", started_at: "2026-10-30T15:30:00Z", from_number: "5145553333" },
    { direction: "outbound", status: "completed", duration_seconds: 60, started_at: "2026-10-30T16:00:00Z", to_number: "5145554444" },
  ];
  it("counts missed and answered calls", () => {
    const s = callStats(calls);
    expect(s.total).toBe(4); expect(s.missed.length).toBe(2); expect(s.answered).toBe(2); expect(s.talkSeconds).toBe(180);
  });
  it("flags texts whose last message is incoming as unanswered", () => {
    const t = smsThreads([
      { direction: "inbound", from_number: "+15145550001", body: "a", created_at: "2026-10-30T14:00:00Z" },
      { direction: "outbound", to_number: "5145550001", body: "b", created_at: "2026-10-30T14:01:00Z" },
      { direction: "inbound", from_number: "5145550002", body: "c", created_at: "2026-10-30T14:02:00Z" },
    ]);
    expect(t.unanswered).toBe(1); expect(t.received).toBe(2); expect(t.sent).toBe(1);
  });
  it("uses AI one-liners when present and hides disabled sections", () => {
    const d = buildDailyReportHtml({ brokerName: "M", dateLabel: "x", calls, voicemails: [], sms: [], sections: { texts: false },
      mails: [{ id: "a", subject: "S", isRead: true, bodyPreview: "raw preview" }], mailSummaries: [{ id: "a", summary: "Résumé IA", action: "Rappeler" }] });
    expect(d.html).toContain("Résumé IA"); expect(d.html).not.toContain("raw preview"); expect(d.html).not.toContain(">Textos <");
    expect(d.stats.missed).toBe(2);
  });
});
