import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type DidRow = {
  e164: string;
  pretty?: string;
  extension: string | null;
  display_name?: string | null;
};

const digitsOf = (v: string) => String(v || "").replace(/\D+/g, "").replace(/^1(?=\d{10}$)/, "");

/**
 * Détection automatique des doublons de DID (côté Maestro / NetSapiens) :
 *  - un même numéro routé vers PLUSIEURS postes (cas critique : l'appel peut
 *    sonner sur le mauvais poste ou tomber en messagerie) ;
 *  - un même poste qui porte PLUSIEURS numéros (informatif, souvent voulu).
 */
export default function DidDuplicateAlert({ numbers }: { numbers: DidRow[] }) {
  const { dupNumbers, dupExtensions } = useMemo(() => {
    const byNumber = new Map<string, DidRow[]>();
    const byExt = new Map<string, DidRow[]>();
    for (const n of numbers) {
      const key = digitsOf(n.e164 || n.pretty || "");
      if (key) byNumber.set(key, [...(byNumber.get(key) ?? []), n]);
      const ext = String(n.extension ?? "").trim();
      if (ext) byExt.set(ext, [...(byExt.get(ext) ?? []), n]);
    }
    const dupNumbers = [...byNumber.entries()]
      .map(([key, rows]) => ({
        key,
        rows,
        exts: Array.from(new Set(rows.map((r) => String(r.extension ?? "").trim()).filter(Boolean))),
      }))
      .filter((g) => g.exts.length > 1);
    const dupExtensions = [...byExt.entries()]
      .map(([ext, rows]) => ({
        ext,
        nums: Array.from(new Set(rows.map((r) => r.pretty || r.e164))),
        name: rows[0]?.display_name ?? null,
      }))
      .filter((g) => g.nums.length > 1);
    return { dupNumbers, dupExtensions };
  }, [numbers]);

  if (!numbers.length) return null;

  const clean = dupNumbers.length === 0 && dupExtensions.length === 0;

  return (
    <Card className={dupNumbers.length ? "border-destructive/60" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {clean
            ? <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
            : <AlertTriangle className="w-4 h-4 text-destructive" />}
          Doublons de DID
        </CardTitle>
        <CardDescription>
          Vérification automatique : un DID ne doit pointer que vers un seul poste.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {clean && (
          <p className="text-muted-foreground">Aucun doublon détecté sur {numbers.length} numéro(s).</p>
        )}

        {dupNumbers.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium text-destructive">
              {dupNumbers.length} numéro(s) routé(s) vers plusieurs postes — à corriger.
            </p>
            <ul className="space-y-1">
              {dupNumbers.map((g) => (
                <li key={g.key} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{g.rows[0].pretty || g.rows[0].e164}</span>
                  <span className="text-muted-foreground">→</span>
                  {g.exts.map((e) => (
                    <Badge key={e} variant="destructive">poste {e}</Badge>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}

        {dupExtensions.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">
              {dupExtensions.length} poste(s) avec plusieurs numéros (à valider) :
            </p>
            <ul className="space-y-1">
              {dupExtensions.map((g) => (
                <li key={g.ext} className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">poste {g.ext}</Badge>
                  {g.name && <span className="text-muted-foreground">{g.name}</span>}
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono">{g.nums.join(" · ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
