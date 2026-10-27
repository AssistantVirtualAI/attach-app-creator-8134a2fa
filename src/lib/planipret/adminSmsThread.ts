// Admin Messages thread pairing — one conversation per (broker line, client
// number). The broker's texts leave from a DID while webhook-mirrored replies
// land on the broker's extension, so both identities must match the thread.
export type SmsThreadPairing = {
  peerKey: string;
  lineKey: string;
  brokerExt?: string;
};

export const d10 = (v: unknown): string =>
  String(v ?? "").replace(/\D/g, "").slice(-10);

export function matchesSmsThreadPair(
  fromNumber: unknown,
  toNumber: unknown,
  pairing: SmsThreadPairing,
): boolean {
  const a = d10(fromNumber);
  const b = d10(toNumber);
  if (!pairing.peerKey) return false;
  const isLine = (side: string) =>
    Boolean(side) &&
    (!pairing.lineKey || side === pairing.lineKey ||
      (pairing.brokerExt ? side === pairing.brokerExt : side.length <= 6));
  return (a === pairing.peerKey && isLine(b)) || (b === pairing.peerKey && isLine(a));
}
