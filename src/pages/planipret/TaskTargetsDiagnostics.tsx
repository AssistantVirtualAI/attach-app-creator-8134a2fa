// Developer diagnostics: inspect the Maestro `task_targets` resolved for the
// signed-in broker and dry-run the target validation used by task creation.
// Access: /planipret/task-targets  (and /mplanipret/task-targets)
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  listClientTargets,
  validateTaskTarget,
  type ClientTaskTarget,
  type TargetValidationResult,
} from "@/lib/planipret/tasks";

export default function TaskTargetsDiagnostics() {
  const [search, setSearch] = useState("");
  const [targets, setTargets] = useState<ClientTaskTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [check, setCheck] = useState<TargetValidationResult | null>(null);
  const [checking, setChecking] = useState(false);

  const load = async (q?: string) => {
    setLoading(true); setError(null);
    try {
      setTargets(await listClientTargets(q || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const client = useMemo(
    () => targets.find((t) => t.client_id === selected) ?? null,
    [targets, selected],
  );

  const runCheck = async (type: "user" | "contract", xid: string) => {
    setChecking(true); setCheck(null);
    try {
      const r = await validateTaskTarget(type, xid);
      setCheck(r.validation);
    } catch (e) {
      setCheck({ ok: false, type, xid, error: "validation_failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="p-6 space-y-6 max-w-4xl mx-auto">
      <header>
        <h1 className="text-xl font-semibold">Diagnostic des cibles de tâche (task_targets)</h1>
        <p className="text-sm text-muted-foreground">
          Cibles valides renvoyées par l'API Clients Maestro, utilisées pour créer une tâche
          (<code>type: user</code> → id client, <code>type: contract</code> → id de contrat).
        </p>
      </header>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(search); }}
            placeholder="Rechercher un client (nom ou courriel)"
            aria-label="Rechercher un client"
            className="w-full h-10 pl-9 pr-3 rounded-md border bg-background text-sm"
          />
        </div>
        <button
          onClick={() => void load(search)}
          className="h-10 px-4 rounded-md border text-sm inline-flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Recharger
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-3 space-y-1 max-h-[420px] overflow-auto">
          <h2 className="text-sm font-semibold mb-2">Clients ({targets.length})</h2>
          {!loading && !targets.length && (
            <p className="text-sm text-muted-foreground">Aucune cible retournée par l'API Clients.</p>
          )}
          {targets.map((t) => (
            <button
              key={t.client_id}
              onClick={() => { setSelected(t.client_id); setCheck(null); }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm ${selected === t.client_id ? "bg-muted" : "hover:bg-muted/50"}`}
            >
              <span className="font-medium">{t.name}</span>
              <span className="block text-xs text-muted-foreground">
                {t.email ?? "—"} · user {t.user?.id ?? "—"} · {t.contracts.length} contrat(s)
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-lg border p-3 space-y-3">
          <h2 className="text-sm font-semibold">Cibles résolues</h2>
          {!client && <p className="text-sm text-muted-foreground">Choisis un client à gauche.</p>}
          {client && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">type: user</p>
                {client.user ? (
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs">
                      xid {client.user.id} · brokers {client.user.eligible_broker_ids.join(", ") || "—"}
                    </code>
                    <button className="text-xs underline" onClick={() => void runCheck("user", client.user!.id)}>Valider</button>
                  </div>
                ) : <p className="text-xs text-muted-foreground">Aucune cible utilisateur.</p>}
              </div>
              <div>
                <p className="font-medium">type: contract</p>
                {client.contracts.length ? client.contracts.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <code className="text-xs">xid {c.id}{c.number ? ` · n° ${c.number}` : ""}</code>
                    <button className="text-xs underline" onClick={() => void runCheck("contract", c.id)}>Valider</button>
                  </div>
                )) : <p className="text-xs text-muted-foreground">Aucun contrat.</p>}
              </div>
              <details>
                <summary className="text-xs cursor-pointer text-muted-foreground">JSON brut</summary>
                <pre className="text-[11px] overflow-auto">{JSON.stringify(client, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border p-3">
        <h2 className="text-sm font-semibold mb-2">Validation (dry run)</h2>
        {checking && <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Vérification…</p>}
        {!checking && !check && <p className="text-sm text-muted-foreground">Clique « Valider » sur une cible.</p>}
        {!checking && check && (
          <div className="space-y-2 text-sm">
            <p className="inline-flex items-center gap-2 font-medium" style={{ color: check.ok ? "var(--pp-success, #16A34A)" : "var(--pp-danger, #DC2626)" }}>
              {check.ok ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              {check.ok ? "Cible valide" : check.error}
            </p>
            {check.message && <p className="text-muted-foreground">{check.message}</p>}
            <pre className="text-[11px] overflow-auto">{JSON.stringify(check, null, 2)}</pre>
          </div>
        )}
      </section>
    </main>
  );
}
