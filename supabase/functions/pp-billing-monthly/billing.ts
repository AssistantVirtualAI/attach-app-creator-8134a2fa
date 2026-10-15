// Pure billing math — mirrors src/lib/planipret/pricing.ts (keep in sync).
export const PLAN_PRICES = { widget: 49.95, mobile: 79.0, ai: 99.95 } as const;
export const PLAN_COSTS = { widget: 18.99, mobile: 30.0, ai: 50.0 } as const;
export const SERVICE_MONTHLY = 11.99;
export const SERVICE_ACTIVATION = 100.0;
export type PlanKey = keyof typeof PLAN_PRICES;
export const PLAN_LABELS: Record<PlanKey, string> = {
  widget: "Widget seulement",
  mobile: "Widget + App (sans AVA)",
  ai: "Kit complet (App + AVA)",
};

export type Flags = { mobile_app_enabled?: boolean | null; voice_agent_enabled?: boolean | null; ava_chat_enabled?: boolean | null };
export function classifyPlan(p: Flags): PlanKey {
  if (!p.mobile_app_enabled) return "widget";
  return (!!p.voice_agent_enabled || p.ava_chat_enabled !== false) ? "ai" : "mobile";
}

const TEST = ["scott", "mohamad", "carlo", "clinton"];
export function isRealBroker(p: { full_name?: string | null; email?: string | null; ns_domain?: string | null }) {
  const s = `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase();
  return p.ns_domain === "planipret.ca" && !TEST.some((t) => s.includes(t));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export type Profile = Flags & { created_at: string; full_name?: string | null; email?: string | null; ns_domain?: string | null };
export type Item = { kind: "queue" | "ivr"; name: string | null; first_seen_at: string; removed_at: string | null };

/** Monthly report for [start, end). */
export function buildReport(profiles: Profile[], items: Item[], start: Date, end: Date) {
  const s = start.getTime(), e = end.getTime();
  const real = profiles.filter(isRealBroker).filter((p) => new Date(p.created_at).getTime() < e);
  const plans = (["widget", "mobile", "ai"] as PlanKey[]).map((k) => {
    const inPlan = real.filter((p) => classifyPlan(p) === k);
    const added = inPlan.filter((p) => new Date(p.created_at).getTime() >= s).length;
    const total = inPlan.length;
    return {
      plan: k, label: PLAN_LABELS[k], existing: total - added, added, total,
      unit_price: PLAN_PRICES[k], unit_cost: PLAN_COSTS[k],
      revenue: r2(total * PLAN_PRICES[k]), cost: r2(total * PLAN_COSTS[k]),
      margin: r2(total * (PLAN_PRICES[k] - PLAN_COSTS[k])),
    };
  });
  const services = (["queue", "ivr"] as const).map((kind) => {
    const active = items.filter((i) => i.kind === kind && new Date(i.first_seen_at).getTime() < e && (!i.removed_at || new Date(i.removed_at).getTime() >= e));
    const added = active.filter((i) => new Date(i.first_seen_at).getTime() >= s);
    return {
      kind, label: kind === "queue" ? "Files d'attente" : "IVR",
      existing: active.length - added.length, added: added.length, total: active.length,
      added_names: added.map((i) => i.name ?? "—"),
      monthly: r2(active.length * SERVICE_MONTHLY), activation: r2(added.length * SERVICE_ACTIVATION),
    };
  });
  const planRevenue = r2(plans.reduce((a, p) => a + p.revenue, 0));
  const planCost = r2(plans.reduce((a, p) => a + p.cost, 0));
  const svcMonthly = r2(services.reduce((a, x) => a + x.monthly, 0));
  const activation = r2(services.reduce((a, x) => a + x.activation, 0));
  return {
    period_start: start.toISOString().slice(0, 10),
    plans, services,
    totals: {
      users: plans.reduce((a, p) => a + p.total, 0),
      users_added: plans.reduce((a, p) => a + p.added, 0),
      plan_revenue: planRevenue, plan_cost: planCost, plan_margin: r2(planRevenue - planCost),
      services_monthly: svcMonthly, activation_one_time: activation,
      monthly_recurring: r2(planCost + svcMonthly),
      total_billed: r2(planCost + svcMonthly + activation),
    },
  };
}
export type BillingReport = ReturnType<typeof buildReport>;
