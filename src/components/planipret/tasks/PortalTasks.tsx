import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import TasksSection from "@/components/planipret/mobile/TasksSection";

/**
 * Page Tâches du portail (admin + courtier). Elle réutilise exactement le même
 * moteur que l'application mobile (`planipret-task-api` → Maestro) et le même
 * composeur, calqué sur l'écran de création de tâches de Maestro.
 */
export default function PortalTasks({ lang }: { lang: "fr" | "en" }) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (alive) setUserId(data.user?.id ?? null);
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className="max-w-3xl">
      <TasksSection userId={userId} lang={lang} />
    </div>
  );
}
