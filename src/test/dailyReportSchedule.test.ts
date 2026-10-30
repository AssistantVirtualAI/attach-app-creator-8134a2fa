import { describe, expect, it } from "vitest";
import { dailyReportDue } from "../../supabase/functions/_shared/daily-report-schedule";
describe("daily report schedule", () => {
  it("schedules at 17:00 Toronto within the existing 15-minute job window", () => {
    expect(dailyReportDue({}, "2026-10-30", 16 * 60 + 59)).toBe(false);
    expect(dailyReportDue({}, "2026-10-30", 17 * 60)).toBe(true);
    expect(dailyReportDue({}, "2026-10-30", 17 * 60 + 15)).toBe(true);
    expect(dailyReportDue({}, "2026-10-30", 17 * 60 + 30)).toBe(false);
  });
  it("honors broker-selected time", () => {
    expect(dailyReportDue({ email_digest_time: "08:30" }, "2026-10-30", 510)).toBe(true);
    expect(dailyReportDue({ email_digest_time: "08:30" }, "2026-10-30", 1020)).toBe(false);
  });
  it("prevents duplicates after accepted or uncertain attempts without labeling attempts successful", () => {
    expect(dailyReportDue({ last_email_digest_date: "2026-10-30" }, "2026-10-30", 1020)).toBe(false);
    expect(dailyReportDue({ email_digest_attempt_date: "2026-10-30" }, "2026-10-30", 1020)).toBe(false);
    expect(dailyReportDue({ email_digest_attempt_date: "2026-10-29" }, "2026-10-30", 1020)).toBe(true);
  });
});