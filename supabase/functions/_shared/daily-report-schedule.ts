export function dailyReportDue(meta: Record<string, any>, date: string, minuteOfDay: number) {
  const [h, m] = String(meta.email_digest_time ?? "17:00").split(":").map(Number);
  const target = h * 60 + m;
  return Number.isFinite(target) && minuteOfDay >= target && minuteOfDay < target + 30
    && meta.last_email_digest_date !== date && meta.email_digest_attempt_date !== date;
}