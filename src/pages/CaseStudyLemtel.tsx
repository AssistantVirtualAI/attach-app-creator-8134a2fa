import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { FooterSection } from "@/components/landing/FooterSection";
import { LemtelShowcaseSection } from "@/components/landing/LemtelShowcaseSection";
import { useLanguage } from "@/context/LanguageContext";
import { useEffect } from "react";

export default function CaseStudyLemtel() {
  const { language } = useLanguage();

  useEffect(() => {
    document.title = language === "en"
      ? "Lemtel case study — AVA Statistic"
      : "Étude de cas Lemtel — AVA Statistic";
    const desc = language === "en"
      ? "Lemtel unified telephony suite: HD SIP softphone on Web, Desktop, iOS, Android and Chrome, with a full admin PBX portal."
      : "La suite Lemtel : softphone SIP HD sur Web, Desktop, iOS, Android et Chrome, avec portail admin PBX complet.";
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
      <LemtelShowcaseSection />
      <FooterSection />
    </div>
  );
}
