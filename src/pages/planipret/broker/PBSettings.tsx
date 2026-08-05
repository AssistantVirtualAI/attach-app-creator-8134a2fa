import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Settings, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PlanipretLangSwitch } from "@/components/planipret/PlanipretLangSwitch";
import Ms365StatusBadge from "@/components/planipret/Ms365StatusBadge";
import MaestroConnectCard from "@/components/planipret/mobile/MaestroConnectCard";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import type { BrokerCtx } from "./PlanipretBrokerLayout";

export default function PBSettings() {
  const { profile } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  const changePassword = async () => {
    if (pw.length < 8) { toast.error(lang === "en" ? "At least 8 characters" : "Minimum 8 caractères"); return; }
    if (pw !== pw2) { toast.error(lang === "en" ? "Passwords do not match" : "Les mots de passe ne correspondent pas"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setPw(""); setPw2("");
    toast.success(lang === "en" ? "Password updated" : "Mot de passe mis à jour");
  };

  return (
    <PAPage>
      <PAPageHeader icon={<Settings className="w-4 h-4" />} title={lang === "en" ? "Settings" : "Réglages"} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="pp-card" style={{ padding: 16 }}>
          <h2 className="pp-heading" style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{lang === "en" ? "My profile" : "Mon profil"}</h2>
          <dl className="space-y-2" style={{ fontSize: 13 }}>
            {[
              [lang === "en" ? "Name" : "Nom", profile?.full_name],
              [lang === "en" ? "Email" : "Courriel", profile?.email],
              [lang === "en" ? "Extension" : "Extension", profile?.extension],
              [lang === "en" ? "Role" : "Rôle", profile?.role],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3">
                <dt style={{ color: "var(--pp-text-muted)" }}>{k}</dt>
                <dd style={{ color: "var(--pp-text-primary)", fontWeight: 600 }}>{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: "1px solid var(--pp-bg-border)" }}>
            <span style={{ fontSize: 13, color: "var(--pp-text-muted)" }}>{lang === "en" ? "Language" : "Langue"}</span>
            <PlanipretLangSwitch />
          </div>
        </div>

        <div className="pp-card" style={{ padding: 16 }}>
          <h2 className="pp-heading flex items-center gap-2" style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            <KeyRound className="w-4 h-4" />{lang === "en" ? "Change password" : "Changer le mot de passe"}
          </h2>
          <div className="space-y-2">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password"
              placeholder={lang === "en" ? "New password" : "Nouveau mot de passe"} className="pp-input w-full" style={{ fontSize: 13 }} />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password"
              placeholder={lang === "en" ? "Confirm password" : "Confirmer le mot de passe"} className="pp-input w-full" style={{ fontSize: 13 }} />
            <button onClick={() => void changePassword()} disabled={saving} className="pp-btn-primary disabled:opacity-50">
              {saving ? "…" : (lang === "en" ? "Update" : "Mettre à jour")}
            </button>
          </div>
        </div>

        <div className="pp-card" style={{ padding: 16 }}>
          <h2 className="pp-heading" style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Microsoft 365</h2>
          <Ms365StatusBadge />
        </div>

        <div>
          <MaestroConnectCard />
        </div>
      </div>
    </PAPage>
  );
}
