import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { FooterSection } from "@/components/landing/FooterSection";
import { PlanipretShowcaseSection } from "@/components/landing/PlanipretShowcaseSection";
import { useLanguage } from "@/context/LanguageContext";
import { useEffect } from "react";

export default function CaseStudyPlanipret() {
  const { language } = useLanguage();

  useEffect(() => {
    document.title = language === "en"
      ? "Planiprêt case study — AVA Statistic"
      : "Étude de cas Planiprêt — AVA Statistic";
    const desc = language === "en"
      ? "How Planiprêt brokers use AVA voice + chat AI, mobile app, admin portal, Maestro CRM and Microsoft 365 integrations."
      : "Comment les courtiers Planiprêt utilisent AVA (voix + chat), application mobile, portail admin, CRM Maestro et Microsoft 365.";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", desc);
  }, [language]);

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      <Navbar />
      <div className="container mx-auto px-6 pt-24 pb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {language === "en" ? "Back to home" : "Retour à l'accueil"}
        </Link>
      </div>
      <PlanipretShowcaseSection />
      <FooterSection />
    </div>
  );
}
