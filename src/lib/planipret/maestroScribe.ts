/**
 * Client typé pour la nouvelle API Scribe de Maestro (clients, adresses,
 * téléphones, contrats), routée via l'edge function `pp-maestro-scribe`.
 */
import { safeEdgeFunction } from "@/lib/safeEdgeFunction";

export interface ScribeResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  endpoint?: string;
}

async function call<T = any>(
  action: string,
  opts: { id?: string | number; payload?: Record<string, unknown>; query?: Record<string, any>; prefix?: string } = {},
): Promise<ScribeResponse<T>> {
  const res = await safeEdgeFunction<any>("pp-maestro-scribe", {
    method: "POST",
    body: { action, ...opts },
  });
  if (res.error && !res.data) {
    return { ok: false, status: res.status ?? 0, data: null, error: res.error };
  }
  const d = res.data ?? {};
  return { ok: !!d.ok, status: d.status ?? res.status ?? 0, data: d.data ?? null, error: d.error ?? null, endpoint: d.endpoint };
}

export const scribeDiag = () => call("diag");

export const clients = {
  list: (query: Record<string, any> = {}) => call("clients.list", { query }),
  get: (id: string | number) => call("clients.get", { id }),
  create: (payload: Record<string, unknown>) => call("clients.create", { payload }),
  update: (id: string | number, payload: Record<string, unknown>) => call("clients.update", { id, payload }),
  remove: (id: string | number) => call("clients.delete", { id }),
};

export const addresses = {
  list: (query: Record<string, any> = {}) => call("addresses.list", { query }),
  get: (id: string | number) => call("addresses.get", { id }),
  create: (payload: Record<string, unknown>) => call("addresses.create", { payload }),
  update: (id: string | number, payload: Record<string, unknown>) => call("addresses.update", { id, payload }),
  remove: (id: string | number) => call("addresses.delete", { id }),
};

export const telephones = {
  list: (query: Record<string, any> = {}) => call("telephones.list", { query }),
  get: (id: string | number) => call("telephones.get", { id }),
  create: (payload: Record<string, unknown>) => call("telephones.create", { payload }),
  update: (id: string | number, payload: Record<string, unknown>) => call("telephones.update", { id, payload }),
  remove: (id: string | number) => call("telephones.delete", { id }),
};

export interface ContractFilters {
  contract_id?: string | number;
  client_id?: string | number;
  agent_id?: string | number;
  institution_id?: string | number;
  application_id?: string | number;
  mortgage_id?: string | number;
  status?: string;
  date_from?: string;
  date_to?: string;
  date_field?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export const contracts = {
  /** Côté Maestro : périmètre selon le rôle, l'équipe de référence et l'accès adjoint → chef d'équipe. Admin = 1 mois par défaut. */
  list: (filters: ContractFilters = {}) => call("contracts.list", { query: filters }),
  get: (id: string | number) => call("contracts.get", { id }),
  create: (payload: Record<string, unknown>) => call("contracts.create", { payload }),
};

export const maestroScribe = { scribeDiag, clients, addresses, telephones, contracts };
