import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import ElevenLabsManagementCard from "@/components/planipret/admin/integrations/ElevenLabsManagementCard";
import { Bot } from "lucide-react";

export default function PAAvaAgent() {
  const { t } = useMplanipretLang();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ fontFamily: "Inter,sans-serif", fontWeight: 700, fontSize: 22, color: "var(--pp-text-primary)" }} className="flex items-center gap-2">
            <Bot className="w-5 h-5" style={{ color: "#6C3CE1" }} />
            {t("adminPortal.pageTitles.avaAgent") || "Agent AVA — Configuration"}
          </h1>
          <p style={{ fontSize: 12, color: "var(--pp-text-faint)" }} className="mt-0.5">
            {t("adminPortal.avaAgent.subtitle") || "Voix, prompts, outils et webhooks connectés de l'agent vocal ElevenLabs partagé par tous les courtiers."}
          </p>
        </div>
      </div>

      <ElevenLabsManagementCard userId={userId} />
    </div>
  );
}
