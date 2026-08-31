/**
 * Regroupe les données Maestro par client : tâches (avec alertes d'échéance),
 * dossiers locaux et dépôts de commission. Utilisé par la vue admin « Clients
 * Maestro » et par le suivi client de l'app mobile.
 */
import { supabase } from "@/integrations/supabase/client";
import type { NormalizedTask } from "@/lib/planipret/tasks";

export interface ClientDeposit {
  id?: string | number;
  target_name?: string | null;
  amount?: number | null;
  date_trans?: string | null;
  number?: string | null;
  institution?: string | null;
  commission_type?: string | null;
}

export interface ClientDeal {
  id: string;
  contact_name: string | null;
  contact_number: string | null;
  stage: string | null;
  value_estimate: number | null;
  maestro_contact_id: string | null;
  updated_at: string | null;
}

export interface ClientBundle {
  key: string;
  name: string;
  tasks: NormalizedTask[];
  overdue: number;
  today: number;
  upcoming: number;
  nextDue: string | null;
  deals: ClientDeal[];
  deposits: ClientDeposit[];
  depositTotal: number;
}

export const clientKey = (name: string | null | undefined) =>
  String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const DONE = new Set(["done", "completed", "complete", "closed", "termine", "terminé", "3", "4"]);

const dayBounds = () => {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
};

/** Assemble un bundle par client à partir des tâches, dossiers et dépôts. */
export function buildClientBundles(
  tasks: NormalizedTask[],
  deals: ClientDeal[] = [],
  deposits: ClientDeposit[] = [],
): ClientBundle[] {
  const { start, end } = dayBounds();
  const map = new Map<string, ClientBundle>();

  const ensure = (name: string | null | undefined): ClientBundle | null => {
    const label = String(name ?? "").trim();
    if (!label) return null;
    const key = clientKey(label);
    let b = map.get(key);
    if (!b) {
      b = { key, name: label, tasks: [], overdue: 0, today: 0, upcoming: 0, nextDue: null, deals: [], deposits: [], depositTotal: 0 };
      map.set(key, b);
    }
    return b;
  };

  for (const t of tasks) {
    const b = ensure(t.target_name ?? (t as any)?.raw?.client_name);
    if (!b) continue;
    b.tasks.push(t);
    const closed = DONE.has(String(t.status ?? "").toLowerCase());
    const at = t.due_at ? new Date(t.due_at).getTime() : NaN;
    if (!closed && Number.isFinite(at)) {
      if (at < start) b.overdue += 1;
      else if (at <= end) b.today += 1;
      else b.upcoming += 1;
      if (!b.nextDue || at < new Date(b.nextDue).getTime()) b.nextDue = t.due_at;
    }
  }

  for (const d of deals) {
    const b = ensure(d.contact_name);
    if (b) b.deals.push(d);
  }

  for (const dep of deposits) {
    const b = ensure(dep.target_name);
    if (!b) continue;
    b.deposits.push(dep);
    b.depositTotal += Number(dep.amount ?? 0);
  }

  return [...map.values()].sort((a, b) => {
    const w = (x: ClientBundle) => x.overdue * 100 + x.today * 10 + x.upcoming;
    return w(b) - w(a) || a.name.localeCompare(b.name);
  });
}

/** Dépôts de commission des `months` derniers mois (source Maestro officielle). */
export async function fetchClientDeposits(months = 24): Promise<ClientDeposit[]> {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - months, 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase.functions.invoke("planipret-commission-reports", {
      body: {
        action: "deposits",
        filters: { date_from: iso(from), date_to: iso(to), commission_type: "base", order_by: "date_trans", sort: "desc", page: 1, per_page: 500 },
      },
    });
    if (error || (data as any)?.error) return [];
    return (((data as any)?.rows ?? []) as ClientDeposit[]);
  } catch {
    return [];
  }
}

/** Dossiers locaux (pipeline) pour un ou plusieurs propriétaires. */
export async function fetchClientDeals(userIds: string[]): Promise<ClientDeal[]> {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supabase
    .from("planipret_pipeline")
    .select("id, contact_name, contact_number, stage, value_estimate, maestro_contact_id, updated_at")
    .in("user_id", ids)
    .order("updated_at", { ascending: false })
    .limit(300);
  return ((data ?? []) as ClientDeal[]);
}
