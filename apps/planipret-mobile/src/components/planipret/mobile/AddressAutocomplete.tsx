import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type ParsedAddress = { streetNumber: string; route: string; city: string; region: string; zip: string };

const TYPES: [RegExp, string][] = [
  [/^(rue|street|st)\b/i, "1"], [/^(avenue|av|ave)\b/i, "2"], [/^(boulevard|boul|blvd)\b/i, "3"],
  [/^(chemin|ch|road|rd)\b/i, "4"], [/^rang\b/i, "5"], [/^(place|pl)\b/i, "6"],
];
const TYPES_SUFFIX: [RegExp, string][] = [
  [/\s(street|st)$/i, "1"], [/\s(avenue|ave)$/i, "2"], [/\s(boulevard|blvd)$/i, "3"], [/\s(road|rd)$/i, "4"], [/\s(place|pl)$/i, "6"],
];

/** Sépare « Rue Principale » → type Maestro + nom de rue. */
export function splitRoute(route: string): { streetType: string; streetName: string } {
  const r = route.trim();
  for (const [re, v] of TYPES) if (re.test(r)) return { streetType: v, streetName: r.replace(re, "").replace(/^\s*(de la|du|des|de|d')\s*/i, (m) => m).trim() };
  for (const [re, v] of TYPES_SUFFIX) if (re.test(r)) return { streetType: v, streetName: r.replace(re, "").trim() };
  return { streetType: "", streetName: r };
}

export default function AddressAutocomplete({ onSelect, className, style }: {
  onSelect: (a: ParsedAddress) => void; className: string; style: React.CSSProperties;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ placeId: string; text: string }[]>([]);
  const [off, setOff] = useState(false);
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    if (q.trim().length < 3) { setItems([]); setOff(false); return; }
    const id = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke("pp-address-autocomplete", { body: { input: q } });
      if (error || data?.error) { setOff(true); setItems([]); return; }
      setOff(false);
      setItems(data?.suggestions ?? []);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const pick = async (s: { placeId: string; text: string }) => {
    skip.current = true;
    setQ(s.text); setItems([]);
    const { data } = await supabase.functions.invoke("pp-address-autocomplete", { body: { action: "details", placeId: s.placeId } });
    if (data && !data.error) onSelect(data as ParsedAddress);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
        <input className={className} style={{ ...style, paddingLeft: 34 }} placeholder="Rechercher l'adresse (Google)"
          value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      {off && <p className="text-xs mt-1" style={{ color: "var(--pp-text-secondary)" }}>Recherche Google indisponible — remplissez l'adresse manuellement.</p>}
      {items.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-xl z-10"
          style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)" }}>
          {items.map((s) => (
            <button key={s.placeId} type="button" onClick={() => pick(s)}
              className="w-full text-left px-3 py-2 text-sm flex items-start gap-2"
              style={{ color: "var(--pp-text-primary)", borderBottom: "1px solid var(--pp-bg-border)" }}>
              <MapPin className="w-4 h-4 mt-0.5 shrink-0 opacity-60" /> {s.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
