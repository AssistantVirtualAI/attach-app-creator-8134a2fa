/**
 * Arbitrage du chemin d'appel sortant.
 *
 * Règle : quand le moteur natif est présent, il est le seul propriétaire de
 * l'AOR `<ext>M` et porte l'audio. Quand le binaire installé n'embarque pas le
 * moteur (build livrée sans PJSIP), la WebView reprend l'AOR : JsSIP établit un
 * vrai dialogue WebRTC et transporte l'audio dans l'application. C'est le seul
 * chemin réparable par mise à jour à distance (OTA), sans nouvelle soumission.
 *
 * Le repli REST (`pp-ns-calls action:start`) n'établit aucune jambe média vers
 * l'appareil : il affichait « Ringing » alors que rien ne sonnait. Il reste
 * interdit sur mobile et réservé au client web.
 */
export type OutboundRoute =
  | "native"               // composer via le moteur natif
  | "native_unregistered"  // moteur présent mais ligne non inscrite → erreur honnête
  | "webview"              // moteur absent : JsSIP dans la WebView (OTA, audio réel)
  | "web";                 // client web : JsSIP puis repli PBX

export function decideOutboundRoute(input: {
  clientType: string;
  isNativePlatform: boolean;
  engineAvailable: boolean;
  engineRegistered: boolean;
}): OutboundRoute {
  const nativeMobile = input.clientType === "mobile" && input.isNativePlatform;
  if (!nativeMobile) return "web";
  if (!input.engineAvailable) return "webview";
  return input.engineRegistered ? "native" : "native_unregistered";
}
