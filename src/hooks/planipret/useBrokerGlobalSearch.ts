import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brokerSelect, searchFilter } from "@/lib/planipret/brokerAccess";

export type SearchHit = {
  id: string;
  kind: "call" | "message" | "voicemail" | "recording" | "maestro" | "email" | "person" | "commission";
  primary: string;
  secondary?: string | null;
  meta?: string | null;
  href: string;
  raw?: any;
};

export type SearchGroups = Record<SearchHit["kind"], SearchHit[]>;

const EMPTY: SearchGroups = {
  call: [], message: [], voicemail: [], recording: [], maestro: [], email: [], person: [], commission: [],
};

const LIMIT = 8;
const CACHE = new Map<string, SearchGroups>();
const CACHE_MAX = 20;

function fmtDate(v?: string | null) {
  if (!v) return "";
  try { return new Date(v).toLocaleString(); } catch { return ""; }
}

function peer(row: any) {
  return row?.from_name || row?.to_name || row?.from_number || row?.to_number || "—";
}

/**
 * Live global search across every broker data source.
 * Local (Supabase) sources resolve first; slower edge sources (Maestro,
 * Microsoft 365) stream into the same result set as they answer.
 */
export function useBrokerGlobalSearch(userId: string, term: string, debounceMs = 250) {
  const [groups, setGroups] = useState<SearchGroups>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (!userId || q.length < 2) {
      setGroups(EMPTY); setLoading(false); setRemoteLoading(false);
      return;
    }
    const cached = CACHE.get(`${userId}|${q}`);
    if (cached) { setGroups(cached); setLoading(false); setRemoteLoading(false); return; }

    const id = ++runId.current;
    setLoading(true);
    setRemoteLoading(true);

    const timer = setTimeout(async () => {
      if (id !== runId.current) return;
      const next: SearchGroups = { ...EMPTY, call: [], message: [], voicemail: [], recording: [], maestro: [], email: [], person: [], commission: [] };

      const build = (table: any) =>
        brokerSelect(table, userId, "*").order("created_at", { ascending: false }).limit(LIMIT).or(searchFilter(table, q));

      const commissionsQ = (supabase.from("planipret_commission_stats" as any) as any)
        .select("id, broker_name, dimension, sub_dimension, section, cy_volume, cy_commission, fiscal_year")
        .eq("broker_user_id", userId)
        .or(`dimension.ilike.%${q}%,sub_dimension.ilike.%${q}%,section.ilike.%${q}%`)
        .limit(LIMIT);

      const [c, m, v, com] = await Promise.allSettled([
        build("planipret_phone_calls"),
        build("planipret_phone_messages"),
        build("planipret_voicemails"),
        commissionsQ,
      ]);
      if (id !== runId.current) return;

      const rowsOf = (r: any) => (r.status === "fulfilled" ? ((r.value as any)?.data ?? []) : []);

      for (const row of rowsOf(c)) {
        const hit: SearchHit = {
          id: `call-${row.id}`, kind: "call", primary: peer(row),
          secondary: row.ai_summary || `${row.direction ?? ""} ${row.status ?? ""}`.trim(),
          meta: fmtDate(row.started_at ?? row.created_at),
          href: `/planipret/broker/calls?search=${encodeURIComponent(q)}`, raw: row,
        };
        next.call.push(hit);
        if (row.recording_url || row.has_recording) {
          next.recording.push({ ...hit, id: `rec-${row.id}`, kind: "recording", href: `/planipret/broker/recordings?q=${encodeURIComponent(q)}` });
        }
      }
      for (const row of rowsOf(m)) {
        next.message.push({
          id: `msg-${row.id}`, kind: "message", primary: peer(row), secondary: row.body,
          meta: fmtDate(row.sent_at ?? row.created_at),
          href: `/planipret/broker/messages?q=${encodeURIComponent(q)}`, raw: row,
        });
      }
      for (const row of rowsOf(v)) {
        next.voicemail.push({
          id: `vm-${row.id}`, kind: "voicemail", primary: row.from_name || row.from_number || "—",
          secondary: row.transcript, meta: fmtDate(row.received_at ?? row.created_at),
          href: `/planipret/broker/voicemail?q=${encodeURIComponent(q)}`, raw: row,
        });
      }
      for (const row of rowsOf(com)) {
        next.commission.push({
          id: `com-${row.id}`, kind: "commission",
          primary: row.sub_dimension || row.dimension || row.section || "—",
          secondary: [row.section, row.dimension].filter(Boolean).join(" · "),
          meta: String(row.fiscal_year ?? ""),
          href: `/planipret/broker/commissions`, raw: row,
        });
      }

      setGroups({ ...next });
      setLoading(false);

      // Slow sources — merged in as they answer.
      const [maestro, contacts, mails] = await Promise.allSettled([
        supabase.functions.invoke("maestro-actions", { body: { action: "list_clients", payload: { search: q, limit: LIMIT, offset: 0 } } }),
        supabase.functions.invoke("ms365-actions", { body: { action: "search_contact", payload: { query: q } } }),
        supabase.functions.invoke("ms365-actions", { body: { action: "read_emails", payload: { folder: "inbox", top: 40, skip: 0 } } }),
      ]);
      if (id !== runId.current) return;

      const maestroRows = maestro.status === "fulfilled" ? ((maestro.value as any)?.data?.clients ?? []) : [];
      next.maestro = (Array.isArray(maestroRows) ? maestroRows : []).slice(0, LIMIT).map((cl: any) => ({
        id: `mc-${cl.maestro_client_id ?? cl.id}`, kind: "maestro" as const,
        primary: cl.full_name || [cl.first_name, cl.last_name].filter(Boolean).join(" ") || cl.email || "—",
        secondary: [cl.email, cl.phone || cl.mobile_phone].filter(Boolean).join(" · "),
        meta: cl.status ?? null,
        href: `/planipret/broker/maestro-clients?search=${encodeURIComponent(q)}`, raw: cl,
      }));

      const people = contacts.status === "fulfilled" ? ((contacts.value as any)?.data?.results ?? []) : [];
      next.person = (Array.isArray(people) ? people : []).slice(0, LIMIT).map((p: any, i: number) => ({
        id: `pe-${p.email ?? p.name ?? i}-${i}`, kind: "person" as const,
        primary: p.name || p.email || "—",
        secondary: [p.email, p.phone].filter(Boolean).join(" · "),
        meta: p.job || p.company || null,
        href: `/planipret/broker/microsoft`, raw: p,
      }));

      const emails = mails.status === "fulfilled" ? ((mails.value as any)?.data?.emails ?? []) : [];
      const lower = q.toLowerCase();
      next.email = (Array.isArray(emails) ? emails : [])
        .filter((e: any) => `${e.subject ?? ""} ${e.from ?? e.from_name ?? ""} ${e.preview ?? e.bodyPreview ?? ""}`.toLowerCase().includes(lower))
        .slice(0, LIMIT)
        .map((e: any) => ({
          id: `em-${e.id}`, kind: "email" as const,
          primary: e.subject || "(sans objet)",
          secondary: e.from_name || e.from || e.sender || null,
          meta: fmtDate(e.received_at ?? e.receivedDateTime),
          href: `/planipret/broker/microsoft`, raw: e,
        }));

      const final = { ...next };
      CACHE.set(`${userId}|${q}`, final);
      if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
      setGroups(final);
      setRemoteLoading(false);
    }, debounceMs);

    return () => { clearTimeout(timer); };
  }, [userId, term, debounceMs]);

  const total = Object.values(groups).reduce((n, arr) => n + arr.length, 0);
  return { groups, total, loading, remoteLoading };
}
