export type SmsDeliveryState = "accepted" | "sending" | "delivered" | "failed" | "unknown";

type Evidence = Record<string, any>;

/** Only an explicit provider status establishes delivery; local sent/read flags do not. */
export function smsDeliveryState(message: Evidence): SmsDeliveryState {
  const metadata = message.metadata ?? {};
  const providerStatus = message.provider_status ?? metadata.status
    ?? (message.source !== "local" && (message.ns_message_id || message.timestamp || message["messagesession-id"]) ? message.status : undefined);
  const status = String(providerStatus ?? "").trim().toLowerCase();
  if (["failed", "error", "rejected", "undelivered"].includes(status)) return "failed";
  if (status === "delivered") return "delivered";
  if (["sending", "queued", "pending"].includes(status)) return "sending";
  if (["accepted", "sent"].includes(status)) return "accepted";
  if (String(message.id ?? "").startsWith("tmp-")) return "sending";
  if (["sent", "accepted"].includes(String(message.status ?? "").toLowerCase())) return "accepted";
  return "unknown";
}

export function smsDeliveryLabel(message: Evidence, lang: string): string {
  const labels: Record<SmsDeliveryState, [string, string]> = {
    accepted: ["Accepté", "Accepted"],
    sending: ["En cours d’envoi", "Sending"],
    delivered: ["Livré", "Delivered"],
    failed: ["Échec de livraison", "Delivery failed"],
    unknown: ["Livraison non confirmée", "Delivery unconfirmed"],
  };
  return labels[smsDeliveryState(message)][lang === "en" ? 1 : 0];
}

/** Retain provider evidence when an optimistic/local copy wins deduplication. */
export function preserveSmsDelivery<T extends Evidence>(preferred: T, other: Evidence): T {
  const status = other.provider_status ?? other.metadata?.status
    ?? (other.source !== "local" && !String(other.id ?? "").startsWith("tmp-") ? other.status : undefined);
  return status ? { ...preferred, provider_status: preferred.provider_status ?? preferred.metadata?.status ?? status } : preferred;
}