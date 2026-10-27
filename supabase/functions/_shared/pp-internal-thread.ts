// Fil interne entre postes : validation de la paire (poste du courtier JWT ↔
// poste correspondant). Le peer doit rester un poste interne (2 à 6 chiffres)
// pour que la lecture serveur ne puisse jamais exposer un fil SMS externe.
export function internalThreadPair(
  ownRaw: unknown,
  peerRaw: unknown,
): { own: string; peer: string } | null {
  const own = String(ownRaw ?? "").replace(/\D/g, "");
  const peer = String(peerRaw ?? "").replace(/\D/g, "");
  if (!own || peer.length < 2 || peer.length > 6) return null;
  return { own, peer };
}

/** Rows of the stored pair, either direction, scoped to the two extensions. */
export function internalThreadOrFilter(own: string, peer: string): string {
  return `and(from_number.eq.${own},to_number.eq.${peer}),and(from_number.eq.${peer},to_number.eq.${own})`;
}
