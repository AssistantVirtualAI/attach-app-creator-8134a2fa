// Session cache for MHome to render instantly on remount.
export type MHomeStats = {
  calls: number; missed: number; sms: number; voicemails: number;
  meetings: number; hotLeads: number; tasks: number; outbound: number;
};

export type MHomeCache = {
  period: string;
  stats: MHomeStats;
  recent: any[];
  hotLeads: any[];
  dueReminders: any[];
  meetings: any[];
  msMeetings: any[];
  brief: any | null;
  cachedAt: number;
};

const KEY_PREFIX = "planipret.mhome.cache.v1";

const emptyStats: MHomeStats = {
  calls: 0, missed: 0, sms: 0, voicemails: 0,
  meetings: 0, hotLeads: 0, tasks: 0, outbound: 0,
};

export function keyFor(userId: string | undefined | null, period: string) {
  return `${KEY_PREFIX}:${userId || "anon"}:${period}`;
}

export function loadMHomeCache(userId: string | undefined | null, period: string): MHomeCache | null {
  try {
    const raw = sessionStorage.getItem(keyFor(userId, period));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return {
      period,
      stats: { ...emptyStats, ...(v.stats || {}) },
      recent: Array.isArray(v.recent) ? v.recent : [],
      hotLeads: Array.isArray(v.hotLeads) ? v.hotLeads : [],
      dueReminders: Array.isArray(v.dueReminders) ? v.dueReminders : [],
      meetings: Array.isArray(v.meetings) ? v.meetings : [],
      msMeetings: Array.isArray(v.msMeetings) ? v.msMeetings : [],
      brief: v.brief ?? null,
      cachedAt: Number(v.cachedAt || Date.now()),
    };
  } catch { return null; }
}

export function saveMHomeCache(userId: string | undefined | null, period: string, patch: Partial<MHomeCache>) {
  try {
    const current = loadMHomeCache(userId, period) ?? {
      period, stats: emptyStats, recent: [], hotLeads: [], dueReminders: [],
      meetings: [], msMeetings: [], brief: null, cachedAt: Date.now(),
    };
    const next: MHomeCache = { ...current, ...patch, period, cachedAt: Date.now() };
    sessionStorage.setItem(keyFor(userId, period), JSON.stringify(next));
  } catch { /* quota */ }
}
