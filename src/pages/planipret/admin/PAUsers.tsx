import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Plus, Edit3, Trash2, ExternalLink, X, AlertTriangle, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp, MoreHorizontal, KeyRound, Copy, Smartphone, Bot, Phone, Sparkles, Upload } from "lucide-react";
import Pagination from "@/components/planipret/admin/Pagination";
import DebugPanel, { type DebugEntry } from "@/components/planipret/admin/DebugPanel";
import { TableErrorState, TableEmptyState } from "@/components/planipret/admin/TableStates";
import { getPlanipretBrokerDirectory, type PlanipretBrokerRow } from "@/lib/planipret/adminDirectory";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";


const ACCENT = "#2E9BDC";
const SUCCESS = "#00D4AA";
const DANGER = "#E84C4C";

type Profile = PlanipretBrokerRow & {
  user_id: string; email: string; full_name: string; extension: string;
  ns_extension?: string | null;
  mobile_app_enabled: boolean; voice_agent_enabled: boolean;
  ns_domain: string; elevenlabs_agent_id: string | null;
  updated_at: string; created_at: string;
  dnd_enabled?: boolean;
  ns_only?: boolean;
  status?: string | null;
  maestro_connected?: boolean | null;
  role?: string | null;
};

type DidAssignmentImport = {
  phone_number: string;
  extension: string;
  callerid_name?: string | null;
};

export type NsNumber = {
  raw: string;
  e164: string;
  pretty: string;
  extension: string | null;
  application: string | null;
  active: boolean;
};

const normalizeDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

const normalizeExt = (value: unknown) => String(value ?? "")
  .trim()
  .replace(/^sip:/i, "")
  .split("@")[0]
  .replace(/[^a-z0-9._-]/gi, "")
  .trim();

const isPhoneLike = (value: unknown) => {
  const d = normalizeDigits(value);
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
};

const parseDelimitedLine = (line: string, delimiter: string) => {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur.trim()); cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const pickByHeader = (row: Record<string, string>, groups: string[]) => {
  const entries = Object.entries(row);
  for (const key of groups) {
    const hit = entries.find(([h]) => h.includes(key));
    if (hit?.[1]) return hit[1];
  }
  return "";
};

const rowsToAssignments = (records: Record<string, string>[]) => records
  .map((row) => {
    const phone = pickByHeader(row, ["phone", "téléphone", "telephone", "numero", "numéro", "did", "dnis", "phonenumber"]);
    const extension = pickByHeader(row, ["extension", "ext", "to-user", "dest-user", "destination-user", "destination"]);
    const callerid = pickByHeader(row, ["callerid", "caller id", "name", "nom", "description"]);
    if (!isPhoneLike(phone) || !normalizeExt(extension)) return null;
    return { phone_number: phone, extension: normalizeExt(extension), callerid_name: callerid || null };
  })
  .filter(Boolean) as DidAssignmentImport[];

const parseAssignmentsFile = (text: string): DidAssignmentImport[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : (parsed.assignments ?? parsed.numbers ?? parsed.data ?? []);
    if (Array.isArray(arr)) return rowsToAssignments(arr.map((item: any) => Object.fromEntries(
      Object.entries(item ?? {}).map(([k, v]) => [String(k).toLowerCase(), String(v ?? "")]),
    )));
  } catch { /* not JSON */ }

  if (/<table|<tr|<html/i.test(trimmed)) {
    const doc = new DOMParser().parseFromString(trimmed, "text/html");
    const records: Record<string, string>[] = [];
    doc.querySelectorAll("table").forEach((table) => {
      const trs = Array.from(table.querySelectorAll("tr"));
      const header = Array.from(trs[0]?.querySelectorAll("th,td") ?? []).map((c) => c.textContent?.trim().toLowerCase() ?? "");
      trs.slice(1).forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("td,th")).map((c) => c.textContent?.trim() ?? "");
        if (cells.length < 2) return;
        const row: Record<string, string> = {};
        cells.forEach((v, i) => { row[header[i] || `col${i}`] = v; });
        records.push(row);
      });
    });
    const fromTables = rowsToAssignments(records);
    if (fromTables.length > 0) return fromTables;
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const delimiter = ["\t", ";", ",", "|"]
    .sort((a, b) => (lines[0].split(b).length - lines[0].split(a).length))[0];
  const headers = parseDelimitedLine(lines[0], delimiter).map((h) => h.toLowerCase());
  const hasHeader = headers.some((h) => /phone|téléphone|telephone|numero|numéro|did|dnis|extension|ext/.test(h));
  if (hasHeader) {
    const records = lines.slice(1).map((line) => {
      const cells = parseDelimitedLine(line, delimiter);
      const row: Record<string, string> = {};
      cells.forEach((v, i) => { row[headers[i] || `col${i}`] = v; });
      return row;
    });
    const fromCsv = rowsToAssignments(records);
    if (fromCsv.length > 0) return fromCsv;
  }

  return lines.map((line) => {
    const phone = line.match(/(?:\+?1[\s().-]*)?[2-9]\d{2}[\s().-]*\d{3}[\s.-]*\d{4}/)?.[0] ?? "";
    const withoutPhone = line.replace(phone, " ");
    const ext = withoutPhone.match(/(?:ext\.?|extension|poste|user)?\s*[:#-]?\s*([1-9]\d{2,5})\b/i)?.[1] ?? "";
    if (!isPhoneLike(phone) || !ext) return null;
    return { phone_number: phone, extension: ext, callerid_name: withoutPhone.replace(/\s+/g, " ").trim() || null };
  }).filter(Boolean) as DidAssignmentImport[];
};


export default function PAUsers() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");

  const filter = (params.get("filter") as "all" | "app" | "agent" | "offline") ?? "all";
  
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSizeRaw = parseInt(params.get("pageSize") ?? params.get("ps") ?? "25", 10);
  const pageSize = [25, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 25;
  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => { if (v == null || v === "") next.delete(k); else next.set(k, v); });
    setParams(next, { replace: true });
  };
  const setFilter = (f: string) => updateParams({ filter: f, page: "1" });
  
  const setPage = (p: number) => updateParams({ page: String(p) });
  const setPageSize = (s: number) => updateParams({ pageSize: String(s), ps: null, page: "1" });

  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [debug, setDebug] = useState<DebugEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [delUser, setDelUser] = useState<Profile | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [callsByUser, setCallsByUser] = useState<Record<string, number>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [appReviewExists, setAppReviewExists] = useState<boolean | null>(null);
  const [creatingReview, setCreatingReview] = useState(false);

  const [nsError, setNsError] = useState<string | null>(null);
  const [nsDomain, setNsDomain] = useState<string | null>(null);

  // All phone numbers (DIDs) in the NS domain
  const [allNumbers, setAllNumbers] = useState<NsNumber[]>([]);
  const [numbersError, setNumbersError] = useState<string | null>(null);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [importingAssignments, setImportingAssignments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const didInitialLoad = useRef(false);

  const numbersByExt = useMemo(() => {
    const map: Record<string, NsNumber[]> = {};
    for (const n of allNumbers) {
      if (!n.extension) continue;
      (map[n.extension] ??= []).push(n);
    }
    return map;
  }, [allNumbers]);

  const unassignedNumbers = useMemo(
    () => allNumbers.filter((n) => !n.extension),
    [allNumbers],
  );

  const assignedNumbersCount = allNumbers.filter((n) => !!n.extension).length;

  const loadNumbers = async () => {
    setNumbersLoading(true);
    const { data, error } = await supabase.functions.invoke("pp-admin-phonenumbers", {
      body: { action: "list" },
    });
    setNumbersLoading(false);
    if (error || !(data as any)?.success) {
      setNumbersError((data as any)?.error ?? error?.message ?? "Erreur");
      setAllNumbers([]);
      return;
    }
    setNumbersError(null);
    setAllNumbers(((data as any).numbers ?? []) as NsNumber[]);
  };

  const load = async () => {
    setLoading(true);
    setNsError(null);
    setLoadError(null);
    const directory = await getPlanipretBrokerDirectory();
    setRows(directory.brokers as Profile[]);
    setNsDomain(directory.nsDomain);
    setNsError(directory.nsError);

    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const { data: calls } = await supabase.from("planipret_phone_calls")
      .select("user_id, extension").gte("started_at", start.toISOString());
    const map: Record<string, number> = {};
    (calls ?? []).forEach((c: any) => {
      if (c.user_id) map[c.user_id] = (map[c.user_id] ?? 0) + 1;
      if (c.extension) map[`ext:${c.extension}`] = (map[`ext:${c.extension}`] ?? 0) + 1;
    });
    setCallsByUser(map);
    setDebug(directory.debug as DebugEntry[]);
    // Check if App Review user exists
    const { count: reviewCount } = await supabase
      .from("planipret_profiles")
      .select("id", { count: "exact", head: true })
      .eq("email", "demo@avastatistic.ca");
    setAppReviewExists((reviewCount ?? 0) > 0);
    setLoading(false);
    loadNumbers();
  };

  const importAssignmentsFile = async (file: File) => {
    setImportingAssignments(true);
    try {
      const assignments = parseAssignmentsFile(await file.text());
      if (assignments.length === 0) {
        toast.error("Aucun assignment DID valide trouvé dans ce fichier");
        return;
      }
      const { data, error } = await supabase.functions.invoke("pp-admin-phonenumbers", {
        body: { action: "sync_assignments", payload: { assignments, replace: true } },
      });
      if (error || !(data as any)?.success) {
        toast.error((data as any)?.error ?? error?.message ?? "Erreur d'import DID");
        return;
      }
      toast.success(`${(data as any).imported ?? assignments.length} assignments DID synchronisés`);
      await loadNumbers();
    } finally {
      setImportingAssignments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const syncFromNs = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("ns-sync-user", { body: { action: "sync_from_ns" } });
    const toNs = !error && (data as any)?.success
      ? await supabase.functions.invoke("ns-sync-user", { body: { action: "sync_to_ns" } })
      : null;
    setSyncing(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.error ?? error?.message ?? "Erreur de synchronisation");
      return;
    }
    if (toNs?.error || !(toNs?.data as any)?.success) {
      toast.error("Sync téléphone partielle", { description: (toNs?.data as any)?.error ?? toNs?.error?.message ?? "Erreur sync sortante" });
      await load();
      return;
    }
    const d = data as any;
    const out = toNs?.data as any;
    toast.success(`Sync OK · ${d.updated} depuis téléphone · ${out?.created ?? 0} créés / ${out?.updated ?? 0} mis à jour côté téléphone`);
    await load();
  };

  const createAppReviewUser = async () => {
    setCreatingReview(true);
    const { data, error } = await supabase.functions.invoke("pp-appreview-provision", { body: {} });
    setCreatingReview(false);
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.error ?? (data as any)?.detail ?? error?.message ?? "Erreur");
      console.error("appreview error:", data, error);
      return;
    }
    toast.success("✅ Utilisateur App Review créé");
    await load();
  };

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    load();
  }, []);

  const normalizeSearch = (value: unknown) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const filtered = useMemo(() => {
    const hasSearch = !!search.trim();
    return rows.filter((r) => {
      // When searching, don't hide rows behind the app/agent/offline tab —
      // the tab filter is muted so results are visible regardless of status.
      if (!hasSearch) {
        if (filter === "app" && !r.mobile_app_enabled) return false;
        if (filter === "agent" && !r.voice_agent_enabled) return false;
        if (filter === "offline" && r.mobile_app_enabled) return false;
      }
      if (hasSearch) {
        const s = normalizeSearch(search);
        const anyR = r as any;
        const fields = [
          r.full_name,
          r.email,
          r.extension,
          anyR.ns_extension,
          anyR.ns_domain,
        ];
        return fields.some((v) => normalizeSearch(v).includes(s));
      }
      return true;
    });
  }, [rows, filter, search]);


  const effectivePage = search.trim() ? 1 : page;
  const paged = filtered.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const toggleField = async (u: Profile, field: "mobile_app_enabled" | "voice_agent_enabled") => {
    const next = !u[field];
    setSavingId(u.user_id ?? `ext:${u.extension ?? u.ns_extension ?? ""}`);

    // ns_only broker → no Planiprêt profile yet. Provision one on the fly so
    // the toggle actually takes effect.
    // No Planiprêt account yet (ns_only OR simply missing user_id) → provision on the fly.
    if (u.ns_only || !u.user_id) {
      const { data, error } = await supabase.functions.invoke("pp-admin-user", {
        body: {
          action: "provision_from_ns",
          payload: {
            email: u.email,
            full_name: u.full_name,
            extension: u.extension ?? u.ns_extension,
            updates: { [field]: next },
          },
        },
      });
      setSavingId(null);
      if (error || !(data as any)?.success) {
        toast.error((data as any)?.error ?? error?.message ?? "Erreur de provisionnement");
        return;
      }
      toast.success("Compte Planiprêt créé et activé");
      await load();
      return;
    }
    setRows((p) => p.map((r) => r.user_id === u.user_id ? { ...r, [field]: next } : r));
    const { data, error } = await supabase.functions.invoke("pp-admin-user", {
      body: { action: "update", payload: { user_id: u.user_id, updates: { [field]: next } } },
    });
    setSavingId(null);
    if (error || !(data as any)?.success) {
      setRows((p) => p.map((r) => r.user_id === u.user_id ? { ...r, [field]: !next } : r));
      toast.error((data as any)?.error ?? error?.message ?? "Erreur de mise à jour");
      return;
    }
    // Resync from DB so the UI reflects the persisted value (defensive).
    const { data: fresh } = await supabase
      .from("planipret_profiles")
      .select("mobile_app_enabled, voice_agent_enabled")
      .eq("user_id", u.user_id)
      .maybeSingle();
    if (fresh) {
      setRows((p) => p.map((r) => r.user_id === u.user_id ? { ...r, mobile_app_enabled: !!fresh.mobile_app_enabled, voice_agent_enabled: !!fresh.voice_agent_enabled } : r));
    }
    // Propagate to phone system: any toggle change re-provisions the NS user
    // (recording config + mobile access are derived from these flags).
    supabase.functions.invoke("ns-sync-user", {
      body: { action: "sync_one", broker_id: u.user_id },
    }).catch(() => null);
    // When the mobile app is activated, also enqueue softphone/app provisioning
    // so the broker gets an app account in the phone system automatically.
    if (field === "mobile_app_enabled" && next) {
      supabase.functions.invoke("provision-app-user", {
        body: { user_id: u.user_id },
      }).catch(() => null);
    }
    toast.success(next ? (field === "mobile_app_enabled" ? "Accès mobile activé — provisionnement en cours" : "Agent vocal IA activé") : (field === "mobile_app_enabled" ? "Accès mobile désactivé" : "Agent vocal IA désactivé"));
  };

  const bulkToggle = async (field: "mobile_app_enabled" | "voice_agent_enabled", value: boolean) => {
    const ids = Array.from(selected);
    for (const id of ids) {
      await supabase.functions.invoke("pp-admin-user", { body: { action: "update", payload: { user_id: id, updates: { [field]: value } } } });
    }
    setSelected(new Set());
    await load();
    toast.success(`${ids.length} courtier(s) mis à jour`);
  };

  const bulkDelete = async () => {
    if (!confirm(`Supprimer ${selected.size} courtier(s) ?`)) return;
    for (const id of Array.from(selected)) {
      await supabase.functions.invoke("pp-admin-user", { body: { action: "delete", payload: { user_id: id } } });
    }
    setSelected(new Set());
    await load();
    toast.success("Suppression terminée");
  };

  const promoteOrDemote = async (u: Profile, promote: boolean) => {
    const label = promote ? "promouvoir en admin" : "rétrograder en courtier";
    if (!u.user_id) { toast.error("Utilisateur sans compte Planiprêt."); return; }
    if (!confirm(`Confirmer : ${label} ${u.full_name} ?`)) return;
    const { data, error } = await supabase.functions.invoke("pp-admin-user", {
      body: { action: promote ? "promote_broker" : "demote_admin", payload: { user_id: u.user_id } },
    });
    if (error || !(data as any)?.success) {
      toast.error((data as any)?.error ?? error?.message ?? "Échec");
      return;
    }
    toast.success(promote ? "Promu admin" : "Rétrogradé courtier");
    await load();
  };


  const adminCount = rows.length;
  return (
    <div className="space-y-4">
      {!loading && adminCount <= 1 && (
        <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: `${ACCENT}10`, border: `1px solid ${ACCENT}33` }}>
          <div style={{ color: ACCENT, fontSize: 20, lineHeight: 1 }}>ℹ️</div>
          <div className="flex-1">
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>Créez un compte admin Planiprêt</p>
            <p style={{ fontSize: 11, color: "var(--pp-text-secondary)", marginTop: 4 }}>
              Ajoutez un administrateur Planiprêt pour qu'il puisse gérer ses courtiers de façon autonome.
            </p>
          </div>
          <button onClick={() => setAddAdminOpen(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: ACCENT }}>
            + Ajouter un admin
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--pp-text-primary)" }}>Courtiers</h2>
          <span className="px-2 py-1 rounded-full" style={{ fontSize: 11, background: "var(--pp-bg-elevated)", color: "var(--pp-text-secondary)", border: "1px solid var(--pp-bg-border-2)" }}>
            {rows.length} courtier{rows.length > 1 ? "s" : ""}
          </span>
          {nsDomain && (
            <span className="px-2 py-1 rounded-full" style={{ fontSize: 11, background: `${SUCCESS}15`, color: SUCCESS, border: `1px solid ${SUCCESS}33` }}>
              ● NS {nsDomain}
            </span>
          )}
          {nsError && (
            <span title={nsError} className="px-2 py-1 rounded-full" style={{ fontSize: 11, background: `${DANGER}15`, color: DANGER, border: `1px solid ${DANGER}33` }}>
              ⚠ NS-API hors ligne
            </span>
          )}
          {!numbersError && allNumbers.length > 0 && (
            <span className="px-2 py-1 rounded-full" style={{ fontSize: 11, background: "var(--pp-bg-elevated)", color: "var(--pp-text-secondary)", border: "1px solid var(--pp-bg-border-2)" }}>
              📞 {allNumbers.length} DID · {assignedNumbersCount} assigné{assignedNumbersCount > 1 ? "s" : ""} · {unassignedNumbers.length} libre{unassignedNumbers.length > 1 ? "s" : ""}
            </span>
          )}
          {numbersError && (
            <span title={numbersError} className="px-2 py-1 rounded-full" style={{ fontSize: 11, background: `${DANGER}15`, color: DANGER, border: `1px solid ${DANGER}33` }}>
              ⚠ DID hors ligne
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--pp-text-muted)" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un courtier..."
              className="pl-9 pr-3 py-2 rounded-lg text-sm w-72"
              style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)" }} />
          </div>
          <button onClick={syncFromNs} disabled={syncing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)", opacity: syncing ? 0.6 : 1 }}>
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Sync..." : "Sync NS-API"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,.html,.htm,text/csv,text/tab-separated-values,application/json,text/html"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importAssignmentsFile(file);
            }}
          />
          <button onClick={() => fileInputRef.current?.click()} disabled={importingAssignments} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)", opacity: importingAssignments ? 0.6 : 1 }}>
            <Upload className={`w-4 h-4 ${importingAssignments ? "animate-pulse" : ""}`} /> {importingAssignments ? "Import..." : "Importer DID"}
          </button>
          <button onClick={() => setAddAdminOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--pp-bg-elevated)", border: `1px solid ${ACCENT}55`, color: ACCENT }}>
            <Plus className="w-4 h-4" /> Ajouter un admin
          </button>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-medium" style={{ background: ACCENT }}>
            <Plus className="w-4 h-4" /> Ajouter un courtier
          </button>
        </div>
      </div>

      {/* App Review card */}
      {appReviewExists === false && (
        <div className="pp-card p-4 flex items-center justify-between" style={{ borderLeft: `3px solid ${ACCENT}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pp-text-primary)" }}>⚡ Utilisateur App Review non configuré</div>
            <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }} className="mt-0.5">Requis pour la review Apple/Google · demo@avastatistic.ca · Ext. 1999</div>
          </div>
          <button onClick={createAppReviewUser} disabled={creatingReview} className="px-3 py-2 rounded-lg text-white text-sm font-medium" style={{ background: ACCENT, opacity: creatingReview ? 0.6 : 1 }}>
            {creatingReview ? "Création..." : "Créer l'utilisateur App Review"}
          </button>
        </div>
      )}
      {appReviewExists === true && (
        <div className="pp-card p-3 flex items-center gap-3" style={{ borderLeft: `3px solid ${SUCCESS}` }}>
          <span style={{ fontSize: 13, color: "var(--pp-text-primary)" }}>✅ App Review configuré</span>
          <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>demo@avastatistic.ca · DemoPass2026! · Ext. 1999</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        {([
          ["all", "Tous"], ["app", "App activée"], ["agent", "Agent IA activé"], ["offline", "Hors ligne"],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition"
            style={filter === k
              ? { background: ACCENT, color: "#fff", border: `1px solid ${ACCENT}` }
              : { background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>
            {l}
          </button>
        ))}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="rounded-lg px-4 py-2 flex items-center justify-between" style={{ background: `${ACCENT}10`, border: `1px solid ${ACCENT}33` }}>
          <span style={{ fontSize: 13, color: "var(--pp-text-primary)" }}>{selected.size} courtier(s) sélectionné(s)</span>
          <div className="flex gap-2">
            <button onClick={() => bulkToggle("mobile_app_enabled", true)} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>📱 Activer app</button>
            <button onClick={() => bulkToggle("voice_agent_enabled", true)} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>🤖 Activer agent</button>
            <button onClick={bulkDelete} className="px-3 py-1.5 rounded-lg text-xs text-white" style={{ background: DANGER }}>🗑️ Supprimer</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="pp-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: "var(--pp-bg-elevated)" }}>
              <tr className="text-left" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--pp-text-faint)" }}>
                <th className="p-3 w-8"><input type="checkbox" checked={paged.length > 0 && paged.every((r) => selected.has(r.user_id))}
                  onChange={(e) => {
                    const ns = new Set(selected);
                    paged.forEach((r) => e.target.checked ? ns.add(r.user_id) : ns.delete(r.user_id));
                    setSelected(ns);
                  }} /></th>
                <th className="p-3">Nom complet</th>
                <th className="p-3">Courriel</th>
                <th className="p-3">Ext.</th>
                <th className="p-3">Numéros DID</th>
                <th className="p-3">App</th>
                <th className="p-3">Agent IA</th>
                <th className="p-3">DND</th>
                <th className="p-3">Appels mois</th>
                <th className="p-3">Maestro ID</th>
                <th className="p-3">Dernière activité</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="p-3"><div className="w-4 h-4 animate-pulse rounded" style={{ background: "var(--pp-bg-elevated)" }} /></td>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="p-3"><div className="h-3 w-3/4 animate-pulse rounded" style={{ background: "var(--pp-bg-elevated)" }} /></td>
                    ))}
                    <td className="p-3"><div className="h-6 w-10 rounded-full animate-pulse" style={{ background: "var(--pp-bg-elevated)" }} /></td>
                  </tr>
                ))
              ) : paged.length === 0 ? (
                <tr><td colSpan={12} className="p-8 text-center" style={{ color: "var(--pp-text-faint)" }}>Aucun courtier</td></tr>
              ) : paged.map((u) => (
                <tr key={u.user_id || u.email || u.extension} className="hover:bg-white/[0.02] transition"
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    background: highlightId === u.user_id ? `${ACCENT}15` : undefined,
                  }}>
                  <td className="p-3"><input type="checkbox" checked={selected.has(u.user_id)} onChange={(e) => {
                    const ns = new Set(selected);
                    e.target.checked ? ns.add(u.user_id) : ns.delete(u.user_id);
                    setSelected(ns);
                  }} /></td>
                  <td className="p-3" style={{ fontWeight: 500, color: "var(--pp-text-primary)" }}>
                    {u.full_name}
                    {u.ns_only && <span className="ml-2 px-1.5 py-0.5 rounded" style={{ fontSize: 9, background: `${ACCENT}18`, color: ACCENT, border: `1px solid ${ACCENT}33` }}>NS</span>}
                  </td>
                  <td className="p-3" style={{ color: "var(--pp-text-secondary)" }}>{u.email}</td>
                  <td className="p-3 tabular-nums" style={{ color: "var(--pp-text-secondary)" }}>{u.extension}</td>
                  <td className="p-3">
                    {(() => {
                      const nums = numbersByExt[u.extension] ?? [];
                      if (numbersLoading && nums.length === 0) return <span style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>…</span>;
                      if (nums.length === 0) return <span style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>—</span>;
                      return (
                        <div className="flex flex-wrap gap-1">
                          {nums.map((n) => (
                            <span key={n.raw} title={n.raw} className="px-1.5 py-0.5 rounded tabular-nums" style={{ fontSize: 11, background: `${ACCENT}15`, color: ACCENT, border: `1px solid ${ACCENT}33` }}>
                              {n.pretty}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-3"><Toggle on={!!u.mobile_app_enabled} loading={!!(u.user_id && savingId === u.user_id)} onChange={() => toggleField(u, "mobile_app_enabled")} /></td>
                  <td className="p-3"><Toggle on={!!u.voice_agent_enabled} loading={!!(u.user_id && savingId === u.user_id)} onChange={() => toggleField(u, "voice_agent_enabled")} /></td>
                  <td className="p-3">
                    {u.dnd_enabled ? (
                      <button
                        onClick={async () => {
                          if (!confirm(`Désactiver le mode DND pour ${u.full_name} (urgence) ?`)) return;
                          await supabase.from("planipret_profiles").update({ dnd_enabled: false }).eq("user_id", u.user_id);
                          await load();
                          toast.success("DND désactivé");
                        }}
                        className="text-white px-2 py-1 rounded-full"
                        style={{ fontSize: 10, fontWeight: 600, background: DANGER }}
                        title="Cliquez pour désactiver (override admin)">
                        🔕 Actif
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>—</span>
                    )}
                  </td>
                  <td className="p-3 tabular-nums" style={{ color: "var(--pp-text-primary)" }}>{callsByUser[u.user_id] ?? callsByUser[`ext:${u.extension}`] ?? 0}</td>
                  <td className="p-3">
                    <MaestroIdCell user={u} onSaved={load} />
                  </td>
                  <td className="p-3" style={{ fontSize: 11, color: "var(--pp-text-faint)" }}>{u.updated_at ? new Date(u.updated_at).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                  <td className="p-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-white/[0.05] transition"
                          style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)" }}
                        >
                          Actions <ChevronDown className="w-3 h-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="text-xs">{u.full_name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {!u.ns_only && (
                          <DropdownMenuItem onClick={() => setEditUser(u)}>
                            <Edit3 className="w-3.5 h-3.5 mr-2" /> Modifier le courtier
                          </DropdownMenuItem>
                        )}
                        {!u.ns_only && (
                          <DropdownMenuItem
                            onClick={async () => {
                              const { data } = await supabase.functions.invoke("pp-admin-user", { body: { action: "reset_password", payload: { email: u.email } } });
                              if ((data as any)?.success) toast.success("Email de réinitialisation envoyé");
                              else toast.error("Échec de l'envoi");
                            }}
                          >
                            <KeyRound className="w-3.5 h-3.5 mr-2" /> Réinitialiser le mot de passe
                          </DropdownMenuItem>
                        )}
                        {!u.ns_only && <DropdownMenuSeparator />}
                        {!u.ns_only && (
                          <DropdownMenuItem onClick={() => toggleField(u, "mobile_app_enabled")}>
                            <Smartphone className="w-3.5 h-3.5 mr-2" />
                            {u.mobile_app_enabled ? "Désactiver l'app mobile" : "Activer l'app mobile"}
                          </DropdownMenuItem>
                        )}
                        {!u.ns_only && (
                          <DropdownMenuItem onClick={() => toggleField(u, "voice_agent_enabled")}>
                            <Bot className="w-3.5 h-3.5 mr-2" />
                            {u.voice_agent_enabled ? "Désactiver l'agent IA" : "Activer l'agent IA"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => { navigator.clipboard.writeText(u.email); toast.success("Courriel copié"); }}
                        >
                          <Copy className="w-3.5 h-3.5 mr-2" /> Copier le courriel
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => navigate(`/planipret/admin/calls?broker=${u.ns_only ? `ext:${u.extension}` : `user:${u.user_id}`}`)}
                        >
                          <Phone className="w-3.5 h-3.5 mr-2" /> Voir les appels
                        </DropdownMenuItem>
                        {!u.ns_only && (
                          <DropdownMenuItem
                            onClick={() => navigate(`/planipret/admin/ava?user=${u.user_id}`)}
                          >
                            <Sparkles className="w-3.5 h-3.5 mr-2" /> Historique AVA
                          </DropdownMenuItem>
                        )}
                        {!u.ns_only && (
                          <DropdownMenuItem asChild>
                            <a href="/mplanipret" target="_blank" rel="noopener">
                              <ExternalLink className="w-3.5 h-3.5 mr-2" /> Prévisualiser l'app
                            </a>
                          </DropdownMenuItem>
                        )}
                        {!u.ns_only && (
                          <>
                            <DropdownMenuSeparator />
                            {u.role === "admin" ? (
                              <DropdownMenuItem onClick={() => promoteOrDemote(u, false)}>
                                <ChevronDown className="w-3.5 h-3.5 mr-2" /> Rétrograder en courtier
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => promoteOrDemote(u, true)}>
                                <ChevronUp className="w-3.5 h-3.5 mr-2" /> Promouvoir en admin
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => setDelUser(u)}
                              className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Supprimer le courtier
                            </DropdownMenuItem>
                          </>
                        )}

                        {u.ns_only && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setAddOpen(true)}
                              className="text-[color:var(--pp-brand-accent-2,#2E9BDC)]"
                            >
                              <Plus className="w-3.5 h-3.5 mr-2" /> Créer un compte Planiprêt
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={effectivePage}
          pageSize={pageSize}
          total={filtered.length}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          unit="courtiers"
        />
      </div>

      <DebugPanel entries={debug} />


      {addOpen && <UserModal mode="add" allNumbers={allNumbers} onClose={() => setAddOpen(false)} onSaved={async (id) => { setAddOpen(false); await load(); if (id) { setHighlightId(id); setTimeout(() => setHighlightId(null), 3000); } }} />}
      {editUser && <UserModal mode="edit" user={editUser} allNumbers={allNumbers} onClose={() => setEditUser(null)} onSaved={async () => { setEditUser(null); await load(); }} />}
      {delUser && <DeleteModal user={delUser} onClose={() => setDelUser(null)} onDeleted={async () => { setDelUser(null); await load(); }} />}
      {addAdminOpen && <AdminModal onClose={() => setAddAdminOpen(false)} onSaved={async () => { setAddAdminOpen(false); await load(); }} />}
    </div>
  );
}

function Toggle({ on, loading, disabled, onChange }: { on: boolean; loading?: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} disabled={loading || disabled}
      className={`w-10 h-6 rounded-full p-0.5 transition ${loading || disabled ? "opacity-60" : ""}`}
      style={{ background: on ? ACCENT : "var(--pp-bg-elevated)", border: `1px solid ${on ? ACCENT : "var(--pp-bg-border-2)"}` }}>
      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

function MaestroIdCell({ user, onSaved }: { user: Profile; onSaved: () => void }) {
  const initial = String((user as any).maestro_broker_id ?? "");
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => { setValue(initial); }, [initial]);
  const linked = !!initial;

  const save = async () => {
    const v = value.trim();
    if (v === initial) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("planipret_profiles")
        .update({ maestro_broker_id: v || null })
        .eq("user_id", user.user_id);
      if (error) throw error;
      toast.success(v ? `Maestro ID lié: ${v}` : "Maestro ID retiré");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!initial) { toast.error("Aucun Maestro ID à tester"); return; }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("pp-maestro-telecom", {
        body: { action: "sip" },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.ok) {
        toast.success(`Maestro OK — SIP: ${d.sip_username ?? "?"} (id ${d.maestro_broker_id})`);
      } else {
        toast.error(`Maestro: ${d?.error ?? `HTTP ${d?.status ?? "?"}`}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Échec test Maestro");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
        disabled={saving}
        className="w-20 px-1.5 py-1 rounded tabular-nums"
        style={{ fontSize: 11, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)" }}
      />
      <span
        className="px-1.5 py-0.5 rounded"
        style={{
          fontSize: 9, fontWeight: 600,
          background: linked ? `${SUCCESS}18` : "var(--pp-bg-elevated)",
          color: linked ? SUCCESS : "var(--pp-text-faint)",
          border: `1px solid ${linked ? `${SUCCESS}33` : "var(--pp-bg-border-2)"}`,
        }}>
        {linked ? "Lié ✓" : "Non lié"}
      </span>
      <button
        onClick={test}
        disabled={testing || !linked}
        className="px-1.5 py-0.5 rounded hover:bg-white/[0.05] transition disabled:opacity-40"
        style={{ fontSize: 10, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}
        title="Tester la résolution SIP Maestro"
      >
        {testing ? "…" : "Tester"}
      </button>
    </div>
  );
}


function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function UserModal({ mode, user, allNumbers, onClose, onSaved }: { mode: "add" | "edit"; user?: Profile; allNumbers: NsNumber[]; onClose: () => void; onSaved: (id?: string) => void }) {
  const isEdit = mode === "edit";
  const [firstName, setFirstName] = useState(user?.full_name?.split(" ")[0] ?? "");
  const [lastName, setLastName] = useState(user?.full_name?.split(" ").slice(1).join(" ") ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [extension, setExtension] = useState(user?.extension ?? "");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [appEnabled, setAppEnabled] = useState(user?.mobile_app_enabled ?? true);
  const [agentEnabled, setAgentEnabled] = useState(user?.voice_agent_enabled ?? false);
  const [agentId, setAgentId] = useState(user?.elevenlabs_agent_id ?? "");
  const [agentSecOpen, setAgentSecOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Current DIDs assigned to this broker (extension match)
  const currentNumbers = useMemo(
    () => allNumbers.filter((n) => n.extension && user?.extension && n.extension === user.extension),
    [allNumbers, user?.extension],
  );
  const availableNumbers = useMemo(
    () => allNumbers.filter((n) => !n.extension),
    [allNumbers],
  );
  const [phoneNumber, setPhoneNumber] = useState<string>(currentNumbers[0]?.raw ?? "");
  const originalNumber = currentNumbers[0]?.raw ?? "";

  const applyPhoneNumber = async (ext: string) => {
    if (phoneNumber === originalNumber) return { ok: true };
    // Unassign the previous number (if any & changed/cleared)
    if (originalNumber && originalNumber !== phoneNumber) {
      await supabase.functions.invoke("pp-admin-phonenumbers", {
        body: { action: "unassign", payload: { phone_number: originalNumber } },
      }).catch(() => null);
    }
    if (phoneNumber) {
      const { data, error } = await supabase.functions.invoke("pp-admin-phonenumbers", {
        body: { action: "assign", payload: { phone_number: phoneNumber, extension: ext } },
      });
      if (error || !(data as any)?.success) {
        return { ok: false, error: (data as any)?.error ?? error?.message ?? "Erreur DID" };
      }
    }
    return { ok: true };
  };

  const submit = async () => {
    if (!firstName || !lastName || !email || !extension || (!isEdit && !password)) {
      toast.error("Champs requis manquants"); return;
    }
    if (/@lemtel\.com$/i.test(email.trim())) {
      toast.error("Les emails @lemtel.com appartiennent à Lemtel — utilisez un autre domaine."); return;
    }
    setBusy(true);
    const full_name = `${firstName} ${lastName}`.trim();
    if (isEdit) {
      if (!user?.user_id) {
        setBusy(false);
        toast.error("Courtier sans compte Planiprêt — provisionnez-le d'abord depuis la liste.");
        return;
      }
      const { data, error } = await supabase.functions.invoke("pp-admin-user", {
        body: { action: "update", payload: { user_id: user.user_id, updates: { full_name, extension, mobile_app_enabled: appEnabled, voice_agent_enabled: agentEnabled, elevenlabs_agent_id: agentId || null } } },
      });
      if (error || !(data as any)?.success) { setBusy(false); toast.error((data as any)?.error ?? error?.message ?? "Erreur"); return; }
      const p = await applyPhoneNumber(extension);
      setBusy(false);
      if (!p.ok) { toast.error(`Courtier sauvegardé, DID: ${p.error}`); return; }
      toast.success("Courtier mis à jour");
      onSaved();
    } else {
      const { data, error } = await supabase.functions.invoke("pp-admin-user", {
        body: { action: "create", payload: { email, password, full_name, ns_extension: extension, mobile_app_enabled: appEnabled, voice_agent_enabled: agentEnabled, elevenlabs_agent_id: agentId || null } },
      });
      if (error || !(data as any)?.success) { setBusy(false); toast.error((data as any)?.error ?? "Erreur de création"); return; }
      const p = await applyPhoneNumber(extension);
      setBusy(false);
      if (!p.ok) { toast.error(`Courtier créé, DID: ${p.error}`); onSaved((data as any).user_id); return; }
      toast.success(`Courtier ${full_name} créé ✅`);
      onSaved((data as any).user_id);
    }
  };

  const [newPwd, setNewPwd] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);

  const resetPwd = async () => {
    const { data } = await supabase.functions.invoke("pp-admin-user", { body: { action: "reset_password", payload: { email } } });
    if ((data as any)?.success) toast.success("Email de réinitialisation envoyé");
    else toast.error("Échec de l'envoi");
  };

  const setPwdDirect = async () => {
    if (!newPwd || newPwd.length < 8) { toast.error("Min. 8 caractères"); return; }
    setPwdBusy(true);
    const { data, error } = await supabase.functions.invoke("pp-admin-user", {
      body: { action: "set_password", payload: { user_id: user?.user_id, email, password: newPwd } },
    });
    setPwdBusy(false);
    if (error || !(data as any)?.success) { toast.error((data as any)?.error ?? "Échec"); return; }
    setNewPwd("");
    toast.success("Mot de passe mis à jour ✅");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-[600px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: "1px solid var(--pp-bg-border-2)" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--pp-text-primary)" }}>{isEdit ? `Modifier ${user?.full_name}` : "Ajouter un courtier"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/[0.05]"><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
        </div>
        <div className="p-5 space-y-4">
          <Section title="Informations personnelles">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom *"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="pp-input" /></Field>
              <Field label="Nom de famille *"><input value={lastName} onChange={(e) => setLastName(e.target.value)} className="pp-input" /></Field>
            </div>
            <Field label="Courriel professionnel *" hint="Ex: jdupont@planipret.ca">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isEdit} className="pp-input" />
            </Field>
          </Section>

          <Section title="Téléphonie">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Extension NS *" hint="Ex: 1234"><input value={extension} onChange={(e) => setExtension(e.target.value)} maxLength={5} className="pp-input" /></Field>
              <Field label="Domaine NS"><input value="planipret.ca" readOnly className="pp-input" style={{ opacity: 0.6 }} /></Field>
            </div>
            <Field
              label="Numéro DID assigné"
              hint={
                availableNumbers.length === 0 && currentNumbers.length === 0
                  ? "Aucun numéro libre dans le domaine planipret.ca"
                  : "Choisir un numéro actif non assigné dans le domaine planipret.ca"
              }
            >
              <select
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="pp-input"
              >
                <option value="">— Aucun DID —</option>
                {currentNumbers.map((n) => (
                  <option key={`cur-${n.raw}`} value={n.raw}>
                    {n.pretty} (actuel)
                  </option>
                ))}
                {availableNumbers.map((n) => (
                  <option key={`free-${n.raw}`} value={n.raw}>
                    {n.pretty} — libre
                  </option>
                ))}
              </select>
            </Field>
            {!isEdit ? (
              <Field label="Mot de passe initial *">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type={showPwd ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="pp-input pr-9" />
                    <button onClick={() => setShowPwd(!showPwd)} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: "var(--pp-text-muted)" }}>
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button onClick={() => setPassword(genPassword())} className="px-3 py-2 rounded-lg text-xs flex items-center gap-1" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>
                    <RefreshCw className="w-3 h-3" /> Générer
                  </button>
                </div>
              </Field>
            ) : (
              <button onClick={resetPwd} className="text-sm px-3 py-2 rounded-lg" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>🔑 Réinitialiser le mot de passe</button>
            )}
          </Section>

          <Section title="Accès application">
            <div className="space-y-2">
              <ToggleRow label="Activer l'app mobile" desc="Le courtier pourra accéder à /mplanipret" on={appEnabled} onChange={setAppEnabled} />
              <ToggleRow label="Activer l'agent vocal AVA" desc="Le courtier pourra utiliser l'assistant IA" on={agentEnabled} onChange={setAgentEnabled} />
            </div>
          </Section>

          <div>
            <button onClick={() => setAgentSecOpen(!agentSecOpen)} className="flex items-center gap-2" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--pp-text-muted)" }}>
              {agentSecOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Agent ElevenLabs (optionnel)
            </button>
            {agentSecOpen && (
              <Field label="ElevenLabs Agent ID" hint="Laisser vide pour utiliser l'agent partagé Planiprêt">
                <input value={agentId} onChange={(e) => setAgentId(e.target.value)} className="pp-input" />
              </Field>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 rounded-b-2xl" style={{ borderTop: "1px solid var(--pp-bg-border-2)", background: "var(--pp-bg-elevated)" }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>Annuler</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50" style={{ background: ACCENT }}>
            {busy ? "…" : isEdit ? "Sauvegarder" : "Créer le courtier"}
          </button>
        </div>
      </div>
      <style>{`.pp-input{width:100%;padding:8px 12px;background:var(--pp-bg-elevated);border:1px solid var(--pp-bg-border-2);border-radius:8px;font-size:14px;color:var(--pp-text-primary)}.pp-input:focus{outline:none;border-color:${ACCENT}}`}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--pp-text-muted)", fontWeight: 600 }}>{title}</p>
      {children}
    </div>
  );
}
function Field({ label, hint, children }: any) {
  return (
    <div>
      <label className="block mb-1" style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: "var(--pp-text-faint)", marginTop: 4 }}>{hint}</p>}
    </div>
  );
}
function ToggleRow({ label, desc, on, onChange }: any) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--pp-text-primary)" }}>{label}</p>
        <p style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{desc}</p>
      </div>
      <Toggle on={on} onChange={() => onChange(!on)} />
    </div>
  );
}

function DeleteModal({ user, onClose, onDeleted }: { user: Profile; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const { data } = await supabase.functions.invoke("pp-admin-user", { body: { action: "delete", payload: { user_id: user.user_id } } });
    setBusy(false);
    if (!(data as any)?.success) { toast.error("Erreur de suppression"); return; }
    toast.success("Courtier supprimé");
    onDeleted();
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-[480px]" style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)" }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${DANGER}20`, color: DANGER }}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--pp-text-primary)" }}>Supprimer {user.full_name}?</h2>
              <p style={{ fontSize: 13, color: "var(--pp-text-secondary)", marginTop: 4 }}>Cette action est irréversible. Le courtier perdra immédiatement accès à l'application.</p>
            </div>
          </div>
          <ul className="space-y-1 mb-4 p-3 rounded-lg" style={{ fontSize: 11, color: "var(--pp-text-secondary)", background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
            <li>✓ Compte d'authentification</li>
            <li>✓ Profil et données</li>
            <li>✓ Extension NS-API {user.extension}</li>
            <li>✓ Historique des appels conservé</li>
          </ul>
          <label className="block mb-1" style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>Tapez le nom du courtier pour confirmer :</label>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={user.full_name}
            className="w-full px-3 py-2 rounded-lg text-sm mb-4"
            style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-primary)" }} />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>Annuler</button>
            <button onClick={submit} disabled={confirm !== user.full_name || busy} className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50" style={{ background: DANGER }}>
              {busy ? "…" : "Supprimer définitivement"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!firstName || !lastName || !email) { toast.error("Prénom, nom et courriel requis"); return; }
    if (/@lemtel\.com$/i.test(email.trim())) { toast.error("Les emails @lemtel.com ne sont pas autorisés."); return; }
    setBusy(true);
    const full_name = `${firstName} ${lastName}`.trim();
    const { data, error } = await supabase.functions.invoke("pp-admin-user", {
      body: { action: "create_admin", payload: { email, password: password || undefined, full_name } },
    });
    setBusy(false);
    if (error || !(data as any)?.success) { toast.error((data as any)?.error ?? error?.message ?? "Erreur de création"); return; }
    toast.success((data as any)?.promoted ? `${full_name} promu admin ✅` : `Admin ${full_name} créé ✅`);
    onSaved();
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-[520px]"
        style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: "1px solid var(--pp-bg-border-2)" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--pp-text-primary)" }}>Ajouter un administrateur Planiprêt</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/[0.05]"><X className="w-4 h-4" style={{ color: "var(--pp-text-muted)" }} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>
            Un admin a accès complet au portail /planipret/admin. Si le courriel appartient déjà à un courtier existant, il sera <strong>promu admin</strong> (le mot de passe est optionnel dans ce cas).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prénom *"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="pp-input" /></Field>
            <Field label="Nom *"><input value={lastName} onChange={(e) => setLastName(e.target.value)} className="pp-input" /></Field>
          </div>
          <Field label="Courriel *" hint="Ex: admin@planipret.ca">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="pp-input" />
          </Field>
          <Field label="Mot de passe (optionnel si courtier existant)">

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input type={showPwd ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="pp-input pr-9" />
                <button onClick={() => setShowPwd(!showPwd)} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: "var(--pp-text-muted)" }}>
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={() => setPassword(genPassword())} className="px-3 py-2 rounded-lg text-xs flex items-center gap-1" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>
                <RefreshCw className="w-3 h-3" /> Générer
              </button>
            </div>
          </Field>
        </div>
        <div className="flex justify-end gap-2 p-5 rounded-b-2xl" style={{ borderTop: "1px solid var(--pp-bg-border-2)", background: "var(--pp-bg-elevated)" }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)", color: "var(--pp-text-secondary)" }}>Annuler</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50" style={{ background: ACCENT }}>
            {busy ? "…" : "Créer l'admin"}
          </button>
        </div>
        <style>{`.pp-input{width:100%;padding:8px 12px;background:var(--pp-bg-elevated);border:1px solid var(--pp-bg-border-2);border-radius:8px;font-size:14px;color:var(--pp-text-primary)}.pp-input:focus{outline:none;border-color:${ACCENT}}`}</style>
      </div>
    </div>
  );
}
