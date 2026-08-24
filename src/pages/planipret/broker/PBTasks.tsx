import { CheckSquare } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import PortalTasks from "@/components/planipret/tasks/PortalTasks";

export default function PBTasks() {
  const { lang } = useMplanipretLang();
  const isEn = lang === "en";
  return (
    <PAPage>
      <PAPageHeader
        icon={<CheckSquare className="w-5 h-5" />}
        title={isEn ? "Tasks" : "Tâches"}
        subtitle={isEn
          ? "Create and follow your Maestro tasks — same flow as the Maestro Tasks page"
          : "Créez et suivez vos tâches Maestro — même flux que la page Tâches de Maestro"}
      />
      <PortalTasks lang={isEn ? "en" : "fr"} />
    </PAPage>
  );
}
