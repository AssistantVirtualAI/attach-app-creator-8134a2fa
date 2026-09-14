/**
 * Arbitrage du chemin d'appel sortant.
 *
 * Règle invariante : sur une plateforme native (iOS ET Android), JsSIP est
 * interdit dans la WebView (propriété exclusive de l'AOR `<ext>M`). Le seul
 * chemin qui transporte l'audio est donc le moteur natif. Le repli REST
 * (`pp-ns-calls action:start`) n'établit aucune jambe média vers l'appareil :
 * il affichait « Ringing » alors que rien ne sonnait. Il est interdit sur
 * mobile et réservé au client web.
 */
export type OutboundRoute =
  | "native"               // composer via le moteur natif
  | "native_unregistered"  // moteur présent mais ligne non inscrite → erreur honnête
  | "engine_missing"       // binaire sans moteur natif → mise à jour requise
  | "web";                 // client web : JsSIP puis repli PBX

export function decideOutboundRoute(input: {
  clientType: string;
  isNativePlatform: boolean;
  engineAvailable: boolean;
  engineRegistered: boolean;
}): OutboundRoute {
  const nativeMobile = input.clientType === "mobile" && input.isNativePlatform;
  if (!nativeMobile) return "web";
  if (!input.engineAvailable) return "engine_missing";
  return input.engineRegistered ? "native" : "native_unregistered";
}
