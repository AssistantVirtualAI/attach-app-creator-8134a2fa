import { useState } from "react";
import { Rocket, Loader2, CheckCircle2, XCircle, RefreshCw, Package } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { ppEdgeInvoke } from "@/lib/planipret/ppEdge";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { toast } from "sonner";

type Workflow = "planipret-ios-artifact" | "planipret-android-artifact" | "planipret-release-artifacts";

type Preview = {
  ref: string;
  refType: "branch" | "tag";
  sha: string | null;
  versions: { version: string | null; androidVersionCode: number | null };
};

type BuildState = {
  buildId: string;
  workflow: Workflow;
  ref: string;
  sha: string | null;
  status: string;
  artifacts?: Array<{ name: string; url: string | null; size: number | null }>;
};

const REF_PATTERN = /^(release\/[A-Za-z0-9._-]{1,60}|pp-v\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?)$/;

export default function PAMobileBuild() {
  const { lang } = useMplanipretLang();
  const fr = lang !== "en";
  const [workflow, setWorkflow] = useState<Workflow>("planipret-release-artifacts");
  const [ref, setRef] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [busy, setBusy] = useState<"preview" | "start" | "status" | null>(null);

  const L = (frText: string, enText: string) => (fr ? frText : enText);

  const doPreview = async () => {
    if (!REF_PATTERN.test(ref.trim())) {
      toast.error(L("Branche release/* ou tag pp-v* requis.", "A release/* branch or pp-v* tag is required."));
      return;
    }
    setBusy("preview");
    const { data, error } = await ppEdgeInvoke("pp-mobile-build", { action: "preview", ref: ref.trim() });
    setBusy(null);
    if (error || !data?.success) {
      toast.error(error?.message ?? L("Aperçu impossible", "Preview failed"));
      return;
    }
    setPreview({ ref: data.ref, refType: data.refType, sha: data.sha, versions: data.versions });
  };

  const doStart = async () => {
    if (!preview) return;
    setBusy("start");
    const { data, error } = await ppEdgeInvoke("pp-mobile-build", { action: "start", workflow, ref: preview.ref });
    setBusy(null);
    if (error || !data?.success) {
      toast.error(data?.message ?? error?.message ?? L("Démarrage refusé", "Start refused"));
      return;
    }
    setBuild({ buildId: data.buildId, workflow, ref: preview.ref, sha: data.sha, status: data.status });
    toast.success(L("Build démarrée sur Codemagic", "Build started on Codemagic"));
  };

  const doStatus = async () => {
    if (!build) return;
    setBusy("status");
    const { data, error } = await ppEdgeInvoke("pp-mobile-build", { action: "status", buildId: build.buildId });
    setBusy(null);
    if (error || !data?.success) {
      toast.error(error?.message ?? L("État indisponible", "Status unavailable"));
      return;
    }
    setBuild((b) => (b ? { ...b, status: data.build.status, artifacts: data.build.artifacts } : b));
  };

  const statusColor = ["finished", "successful", "success"].includes(build?.status ?? "")
    ? "var(--pp-success, #2E9E6B)"
    : ["failed", "error", "canceled"].includes(build?.status ?? "")
      ? "var(--pp-danger)"
      : "var(--pp-warning)";

  return (
    <PAPage>
      <PAPageHeader
        icon={<Rocket size={20} />}
        title={L("Préparer une build mobile", "Prepare a mobile build")}
        subtitle={L(
          "Builds Codemagic signées (IPA + AAB) en mode artifacts uniquement. Aucun envoi aux stores.",
          "Signed Codemagic builds (IPA + AAB), artifacts only. Nothing is uploaded to the stores.",
        )}
      />

      <div className="pa-card" style={{ maxWidth: 640 }}>
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--pp-text-secondary)" }}>
          {L("Workflow", "Workflow")}
        </label>
        <select
          value={workflow}
          onChange={(e) => setWorkflow(e.target.value as Workflow)}
          className="w-full rounded-md border px-3 py-2 text-sm mb-4"
          style={{ borderColor: "var(--pp-bg-border)", background: "var(--pp-bg-surface)", color: "var(--pp-text-primary)" }}
        >
          <option value="planipret-release-artifacts">{L("Les deux plateformes (même commit)", "Both platforms (same commit)")}</option>
          <option value="planipret-ios-artifact">iOS — IPA signé</option>
          <option value="planipret-android-artifact">Android — AAB signé</option>
        </select>

        <label className="block text-sm font-medium mb-1" style={{ color: "var(--pp-text-secondary)" }}>
          {L("Branche ou tag", "Branch or tag")}
        </label>
        <input
          value={ref}
          onChange={(e) => { setRef(e.target.value); setPreview(null); }}
          placeholder="release/1.5.2 ou pp-v1.5.2"
          className="w-full rounded-md border px-3 py-2 text-sm mb-4"
          style={{ borderColor: "var(--pp-bg-border)", background: "var(--pp-bg-surface)", color: "var(--pp-text-primary)" }}
        />

        <button
          onClick={doPreview}
          disabled={busy !== null}
          className="rounded-md px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--pp-bg-elevated, #EEF2F7)", color: "var(--pp-text-primary)", border: "1px solid var(--pp-bg-border)" }}
        >
          {busy === "preview" ? <Loader2 className="inline animate-spin" size={14} /> : null}{" "}
          {L("Vérifier", "Check")}
        </button>

        {preview && (
          <div className="mt-4 rounded-md p-3 text-sm" style={{ background: "var(--pp-bg-elevated, #F6F8FB)", border: "1px solid var(--pp-bg-border)" }}>
            <div><strong>{L("Référence", "Reference")}</strong> : {preview.ref} ({preview.refType === "tag" ? "tag" : "branche"})</div>
            <div><strong>SHA</strong> : {preview.sha ?? L("résolu au démarrage", "resolved at start")}</div>
            <div><strong>iOS</strong> : {L("version", "version")} {preview.versions.version ?? "?"} · build {preview.versions.androidVersionCode ?? "?"}</div>
            <div><strong>Android</strong> : versionName {preview.versions.version ?? "?"} · versionCode {preview.versions.androidVersionCode ?? "?"}</div>
            <div><strong>{L("Environnement cible", "Target environment")}</strong> : {L("artifacts uniquement — aucun store", "artifacts only — no store")}</div>

            <button
              onClick={doStart}
              disabled={busy !== null}
              className="mt-3 rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "var(--pp-brand-accent-2, #0023e6)" }}
            >
              {busy === "start" ? <Loader2 className="inline animate-spin" size={14} /> : <Rocket className="inline" size={14} />}{" "}
              {L("Confirmer et démarrer la build", "Confirm and start the build")}
            </button>
          </div>
        )}
      </div>

      {build && (
        <div className="pa-card mt-4" style={{ maxWidth: 640 }}>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div><strong>Build</strong> : {build.buildId}</div>
              <div><strong>Workflow</strong> : {build.workflow}</div>
              <div><strong>SHA</strong> : {build.sha ?? "—"}</div>
              <div className="flex items-center gap-2 mt-1">
                <strong>{L("État", "Status")}</strong> :
                <span style={{ color: statusColor, fontWeight: 700 }}>
                  {["finished", "successful", "success"].includes(build.status)
                    ? <CheckCircle2 className="inline" size={14} />
                    : ["failed", "error", "canceled"].includes(build.status)
                      ? <XCircle className="inline" size={14} />
                      : <Loader2 className="inline animate-spin" size={14} />}{" "}
                  {build.status}
                </span>
              </div>
            </div>
            <button
              onClick={doStatus}
              disabled={busy !== null}
              className="rounded-md px-3 py-2 text-sm font-semibold"
              style={{ background: "var(--pp-bg-elevated, #EEF2F7)", color: "var(--pp-text-primary)", border: "1px solid var(--pp-bg-border)" }}
            >
              {busy === "status" ? <Loader2 className="inline animate-spin" size={14} /> : <RefreshCw className="inline" size={14} />}{" "}
              {L("Rafraîchir l'état", "Refresh status")}
            </button>
          </div>

          {build.artifacts && build.artifacts.length > 0 && (
            <div className="mt-3 text-sm">
              <strong>{L("Artifacts", "Artifacts")}</strong>
              <ul className="mt-1 space-y-1">
                {build.artifacts.map((a) => (
                  <li key={a.name} className="flex items-center gap-2">
                    <Package size={14} />
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "var(--pp-brand-accent-2, #0023e6)" }}>
                        {a.name}
                      </a>
                    ) : (
                      <span>{a.name}</span>
                    )}
                    {a.size ? <span style={{ color: "var(--pp-text-muted)" }}>({Math.round(a.size / 1_000_000)} Mo)</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </PAPage>
  );
}
