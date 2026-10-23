// pp-mobile-build — bouton « Préparer une build mobile » du portail admin.
//
// Démarre et suit les builds Codemagic de Planiprêt Mobile (artifacts
// uniquement — aucun upload store). Tout est allowlisté côté serveur :
// le navigateur ne peut fournir ni commande, ni URL, ni repo, ni workflow
// arbitraire. Le jeton Codemagic ne quitte jamais le serveur.
//
// Actions : preview | start | status
import { corsHeaders, jsonResponse, requirePlanipretAdmin, supaAdmin } from "../_shared/ns-broker.ts";

const CODEMAGIC_API = "https://api.codemagic.io";

export const ALLOWED_WORKFLOWS = [
  "planipret-ios-artifact",
  "planipret-android-artifact",
  "planipret-release-artifacts",
] as const;
export type WorkflowId = (typeof ALLOWED_WORKFLOWS)[number];

const REF_BRANCH = /^release\/[A-Za-z0-9._-]{1,60}$/;
const REF_TAG = /^pp-v\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/;

const RATE_LIMIT_PER_HOUR = 3;
const ACTIVE_STATUSES = ["queued", "preparing", "fetching", "building", "publishing", "running"];
const AUDIT_ACTION = "mobile_build";

export function isAllowedWorkflow(w: unknown): w is WorkflowId {
  return typeof w === "string" && (ALLOWED_WORKFLOWS as readonly string[]).includes(w);
}

export function isAllowedRef(ref: unknown): ref is string {
  return typeof ref === "string" && (REF_BRANCH.test(ref) || REF_TAG.test(ref));
}

export function refType(ref: string): "branch" | "tag" {
  return REF_TAG.test(ref) ? "tag" : "branch";
}

/** Décision de limite de débit : true = refusé. */
export function isRateLimited(startsLastHour: number): boolean {
  return startsLastHour >= RATE_LIMIT_PER_HOUR;
}

/** Décision anti-double-build : true = refusé (build identique déjà en cours). */
export function isDuplicateBuild(
  existing: Array<{ workflow?: string; sha?: string | null; status?: string }>,
  workflow: string,
  sha: string | null,
): boolean {
  return existing.some(
    (e) =>
      e.workflow === workflow &&
      (sha === null || e.sha === sha) &&
      ACTIVE_STATUSES.includes(String(e.status ?? "")),
  );
}

/** Ne garde que les champs sûrs à renvoyer au navigateur. */
export function sanitizeBuildStatus(raw: any): Record<string, unknown> {
  const artifacts = Array.isArray(raw?.artifacts)
    ? raw.artifacts.map((a: any) => ({
        name: String(a?.name ?? ""),
        url: typeof a?.url === "string" ? a.url : null,
        size: typeof a?.size === "number" ? a.size : null,
      }))
    : [];
  return {
    buildId: raw?._id ?? raw?.id ?? null,
    status: raw?.status ?? "unknown",
    workflow: raw?.workflowId ?? null,
    branch: raw?.branch ?? null,
    tag: raw?.tag ?? null,
    startedAt: raw?.startedAt ?? null,
    finishedAt: raw?.finishedAt ?? null,
    artifacts,
  };
}

async function codemagicFetch(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("CODEMAGIC_API_TOKEN") ?? "";
  if (!token) return { ok: false, status: 0, data: { error: "not_configured" } };
  const res = await fetch(`${CODEMAGIC_API}${path}`, {
    ...init,
    headers: {
      "x-auth-token": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

/** Résout le SHA et les versions sans jamais exposer de jeton. */
async function resolveRef(ref: string): Promise<{ sha: string | null; version: string | null; versionCode: number | null }> {
  const repo = Deno.env.get("CODEMAGIC_REPO") ?? ""; // ex. "org/planipret"
  const ghToken = Deno.env.get("GITHUB_TOKEN") ?? "";
  if (!repo) return { sha: null, version: null, versionCode: null };
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, { headers });
    if (!r.ok) return { sha: null, version: null, versionCode: null };
    const commit = await r.json();
    const sha = typeof commit?.sha === "string" ? commit.sha : null;
    let version: string | null = null;
    let versionCode: number | null = null;
    if (sha) {
      const pkgRes = await fetch(
        `https://raw.githubusercontent.com/${repo}/${sha}/apps/planipret-mobile/package.json`,
        { headers },
      );
      if (pkgRes.ok) {
        const pkg = await pkgRes.json();
        version = typeof pkg?.version === "string" ? pkg.version : null;
        versionCode = Number.isInteger(pkg?.androidVersionCode) ? pkg.androidVersionCode : null;
      }
    }
    return { sha, version, versionCode };
  } catch {
    return { sha: null, version: null, versionCode: null };
  }
}

async function audit(
  adminId: string | null,
  action: string,
  metadata: Record<string, unknown>,
) {
  try {
    await supaAdmin().from("planipret_audit_log").insert({
      admin_id: adminId,
      action: `${AUDIT_ACTION}_${action}`,
      resource_type: "mobile_build",
      metadata,
    });
  } catch { /* l'audit ne bloque jamais l'action */ }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requirePlanipretAdmin(req);
  if ("error" in auth) return auth.error;
  const adminId = (auth as any).profile?.id ?? null;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = body?.action;

  if (action === "preview") {
    const { ref } = body ?? {};
    if (!isAllowedRef(ref)) {
      return jsonResponse({ success: false, error: "ref_not_allowed", message: "Branche release/* ou tag pp-v* requis.", code: 400 }, 400);
    }
    const info = await resolveRef(ref);
    return jsonResponse({
      success: true,
      ref,
      refType: refType(ref),
      sha: info.sha,
      versions: { version: info.version, androidVersionCode: info.versionCode },
      workflows: ALLOWED_WORKFLOWS,
      environment: "artifacts-only",
    });
  }

  if (action === "start") {
    const { workflow, ref } = body ?? {};
    if (!isAllowedWorkflow(workflow)) {
      return jsonResponse({ success: false, error: "workflow_not_allowed", code: 400 }, 400);
    }
    if (!isAllowedRef(ref)) {
      return jsonResponse({ success: false, error: "ref_not_allowed", code: 400 }, 400);
    }
    const appId = Deno.env.get("CODEMAGIC_APP_ID") ?? "";
    if (!appId || !Deno.env.get("CODEMAGIC_API_TOKEN")) {
      return jsonResponse({ success: false, error: "not_configured", message: "Codemagic n'est pas encore configuré côté serveur.", code: 503 }, 503);
    }

    const admin = supaAdmin();
    const since1h = new Date(Date.now() - 3600_000).toISOString();
    const since6h = new Date(Date.now() - 6 * 3600_000).toISOString();

    const { count: startsLastHour } = await admin
      .from("planipret_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", `${AUDIT_ACTION}_start`)
      .eq("admin_id", adminId)
      .gte("created_at", since1h);
    if (isRateLimited(startsLastHour ?? 0)) {
      return jsonResponse({ success: false, error: "rate_limited", message: "Maximum 3 builds par heure.", code: 429 }, 429);
    }

    const info = await resolveRef(ref);
    const { data: recent } = await admin
      .from("planipret_audit_log")
      .select("metadata")
      .eq("action", `${AUDIT_ACTION}_start`)
      .gte("created_at", since6h);
    const existing = (recent ?? []).map((r: any) => r?.metadata ?? {});
    if (isDuplicateBuild(existing, workflow, info.sha)) {
      return jsonResponse({ success: false, error: "duplicate_build", message: "Une build identique est déjà en cours.", code: 409 }, 409);
    }

    const payload: Record<string, unknown> = { appId, workflowId: workflow };
    payload[refType(ref) === "tag" ? "tag" : "branch"] = ref;
    const res = await codemagicFetch("/builds", { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) {
      await audit(adminId, "start_failed", { workflow, ref, sha: info.sha, http: res.status });
      return jsonResponse({ success: false, error: "codemagic_rejected", code: 502 }, 502);
    }
    const buildId = res.data?.buildId ?? res.data?._id ?? null;
    await audit(adminId, "start", { workflow, ref, sha: info.sha, buildId, status: "queued" });
    return jsonResponse({ success: true, buildId, workflow, ref, sha: info.sha, status: "queued" });
  }

  if (action === "status") {
    const { buildId } = body ?? {};
    if (typeof buildId !== "string" || !/^[a-f0-9]{24}$/i.test(buildId)) {
      return jsonResponse({ success: false, error: "invalid_build_id", code: 400 }, 400);
    }
    const res = await codemagicFetch(`/builds/${buildId}`);
    if (!res.ok) {
      return jsonResponse({ success: false, error: "status_unavailable", code: 502 }, 502);
    }
    const clean = sanitizeBuildStatus(res.data?.build ?? res.data);
    await audit(adminId, "status", { buildId, status: clean.status });
    return jsonResponse({ success: true, build: clean });
  }

  return jsonResponse({ success: false, error: "unknown_action", code: 400 }, 400);
}

if (import.meta.main) {
  Deno.serve(handle);
}
