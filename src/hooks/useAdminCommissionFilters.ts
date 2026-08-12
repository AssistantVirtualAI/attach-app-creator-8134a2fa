import { useCallback, useEffect, useRef, useState } from "react";

export type AdminCommissionFilters = {
  year: number;
  granularity: "week" | "month" | "quarter" | "year" | "ytd";
  periodIndex: number;
  agent: string;
  tab: string;
};

const KEY = "pp-admin-commission-filters:v1";

export function defaultAdminCommissionFilters(): AdminCommissionFilters {
  return {
    year: new Date().getFullYear(),
    granularity: "ytd",
    periodIndex: 12,
    agent: "",
    tab: "overview",
  };
}

export function readAdminCommissionFilters(): AdminCommissionFilters | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const d = defaultAdminCommissionFilters();
    return {
      year: Number(parsed.year) || d.year,
      granularity: ["week", "month", "quarter", "year", "ytd"].includes(parsed.granularity) ? parsed.granularity : d.granularity,
      periodIndex: Number(parsed.periodIndex) || d.periodIndex,
      agent: typeof parsed.agent === "string" ? parsed.agent : "",
      tab: typeof parsed.tab === "string" ? parsed.tab : d.tab,
    };
  } catch {
    return null;
  }
}

/** Persists the admin commission filters in the browser (admin portal only). */
export function useAdminCommissionFilters(enabled: boolean, value: AdminCommissionFilters) {
  const [restored] = useState<AdminCommissionFilters | null>(() => (enabled ? readAdminCommissionFilters() : null));
  const first = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [enabled, value.year, value.granularity, value.periodIndex, value.agent, value.tab]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { restored, clear };
}
