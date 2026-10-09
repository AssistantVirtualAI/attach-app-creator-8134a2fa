import { useState } from "react";
import { Hourglass, WalletCards } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PendingCommissionsCard from "./PendingCommissionsCard";
import RegisterCommissions from "./RegisterCommissions";

export default function CommissionSections({ lang, scope }: { lang: "fr" | "en"; scope: "admin" | "broker" }) {
  const [section, setSection] = useState("pending");
  const fr = lang === "fr";
  return (
    <Tabs value={section} onValueChange={setSection} className="mt-5">
      <TabsList aria-label={fr ? "Statut des commissions" : "Commission status"} className="h-auto flex flex-wrap justify-start gap-2 bg-transparent border-b rounded-none pb-3 mb-4">
        <TabsTrigger value="pending" id="commission-pending-tab" aria-controls="commission-pending-panel" className="gap-2 px-5 py-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><Hourglass className="h-4 w-4" />{fr ? "En attente" : "Pending"}</TabsTrigger>
        <TabsTrigger value="paid" id="commission-paid-tab" aria-controls="commission-paid-panel" className="gap-2 px-5 py-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><WalletCards className="h-4 w-4" />{fr ? "Déboursées" : "Paid"}</TabsTrigger>
      </TabsList>
      <div role="tabpanel" id="commission-pending-panel" aria-labelledby="commission-pending-tab" hidden={section !== "pending"}>
        <PendingCommissionsCard lang={lang} cacheScope={scope} />
      </div>
      <div role="tabpanel" id="commission-paid-panel" aria-labelledby="commission-paid-tab" hidden={section !== "paid"}>
        <h2 className="flex items-center gap-2 text-xl font-bold mb-4"><WalletCards className="h-5 w-5 text-primary" />{fr ? "Commissions déboursées" : "Paid commissions"}</h2>
        <RegisterCommissions lang={lang} scope={scope} />
      </div>
    </Tabs>
  );
}