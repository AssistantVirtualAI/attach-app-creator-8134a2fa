// Modèle financier Planiprêt — coûts & prix de vente par service par utilisateur/mois
// Chaque courtier est dans UN seul forfait :
// - widget : Widget seulement (app mobile désactivée)
// - mobile : Widget + app mobile, sans AVA Chat ni AVA Voix
// - ai     : Kit complet (app mobile + AVA Chat et/ou AVA Voix)
export const SERVICE_PRICES = {
  widget: 49.95,
  mobile: 79.00,
  ai: 99.95,
} as const;

/** @deprecated use SERVICE_PRICES */
export const SALE_PRICE = SERVICE_PRICES.widget;

export const SERVICE_COSTS = {
  widget: 18.99,
  mobile: 30.00,
  ai: 50.00,
} as const;

export type ServiceKey = keyof typeof SERVICE_COSTS;

export const SERVICE_META: Record<ServiceKey, { label: string; color: string; gradient: string }> = {
  mobile: { label: "Forfait Widget + App", color: "#2E9BDC", gradient: "linear-gradient(135deg, rgba(46,155,220,0.18), rgba(46,155,220,0.02))" },
  widget: { label: "Forfait Widget",     color: "#F5A623", gradient: "linear-gradient(135deg, rgba(245,166,35,0.18), rgba(245,166,35,0.02))" },
  ai:     { label: "Forfait Kit complet", color: "#9B7FE8", gradient: "linear-gradient(135deg, rgba(155,127,232,0.18), rgba(155,127,232,0.02))" },
};

export type ServiceFinance = {
  service: ServiceKey;
  users: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
  unitProfit: number;
};

export function computeServiceFinance(service: ServiceKey, users: number): ServiceFinance {
  const cost = SERVICE_COSTS[service];
  const price = SERVICE_PRICES[service];
  const unitProfit = price - cost;
  const revenue = users * price;
  const totalCost = users * cost;
  const profit = users * unitProfit;
  return {
    service,
    users,
    revenue,
    cost: totalCost,
    profit,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    unitProfit,
  };
}

export function computeTotals(rows: ServiceFinance[]) {
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  const users = rows.reduce((s, r) => s + r.users, 0);
  return {
    revenue, cost, profit, users,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    annualProfit: profit * 12,
    annualRevenue: revenue * 12,
  };
}

export const fmtMoney = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

export const fmtMoneyPrecise = (n: number) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 }).format(n);

export type PlanFlags = { mobile_app_enabled?: boolean | null; voice_agent_enabled?: boolean | null; ava_chat_enabled?: boolean | null };

/** Forfait d'un courtier selon ses boutons (app mobile, AVA Chat, AVA Voix). */
export function classifyPlan(p: PlanFlags): ServiceKey {
  if (!p.mobile_app_enabled) return "widget";
  const hasAva = !!p.voice_agent_enabled || p.ava_chat_enabled !== false;
  return hasAva ? "ai" : "mobile";
}

/** Compte de courtiers par forfait (chaque courtier compté une seule fois). */
export function countPlans(rows: PlanFlags[]): Record<ServiceKey, number> {
  const c: Record<ServiceKey, number> = { widget: 0, mobile: 0, ai: 0 };
  rows.forEach((r) => { c[classifyPlan(r)]++; });
  return c;
}
