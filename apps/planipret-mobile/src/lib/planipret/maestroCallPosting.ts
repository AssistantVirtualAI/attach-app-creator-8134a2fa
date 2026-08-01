/**
 * Maestro call-posting rules (agreed with Scott, Aug 2026).
 *
 *   1. POST when creating an outbound call to a client.
 *   2. POST when creating an outbound call to a broker's VoIP number.
 *   3. POST when receiving an inbound call from a client.
 *   4. Do NOT post when receiving an inbound call from a broker's VoIP number
 *      (the calling broker already created the record via rule 2).
 *
 * `POST /calls` is idempotent upstream, so a duplicate post from a second
 * device is safe; we still de-duplicate locally by provider_call_id.
 */
import { supabase } from "@/integrations/supabase/client";
import { maestroTelecom } from "@/lib/planipret/maestroTelecom";

const posted = new Set<string>();

export function wasPostedToMaestro(providerCallId?: string | null): boolean {
  return !!providerCallId && posted.has(providerCallId);
}

function digits(n: string): string {
  return String(n || "").replace(/[^\d]/g, "");
}

/** Last 10 digits — NANP-safe comparison key. */
function key(n: string): string {
  const d = digits(n);
  return d.length > 10 ? d.slice(-10) : d;
}

let brokerNumbers: Set<string> | null = null;
let brokerLoad: Promise<Set<string> | null> | null = null;

async function loadBrokerNumbers(): Promise<Set<string> | null> {
  if (brokerNumbers) return brokerNumbers;
  if (brokerLoad) return brokerLoad;
  brokerLoad = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("maestro-actions", {
        body: { action: "list_brokers", page_size: 200 },
      });
      if (error || (data as any)?.success === false) return null;
      const list: any[] = (data as any)?.brokers ?? (data as any)?.clients ?? [];
      if (!Array.isArray(list)) return null;
      const set = new Set<string>();
      for (const b of list) {
        for (const v of [b?.phone, b?.voip_number, b?.cell_phone, b?.work_phone, b?.did, b?.extension]) {
          const k = key(String(v ?? ""));
          if (k) set.add(k);
        }
      }
      brokerNumbers = set;
      return set;
    } catch {
      return null;
    } finally {
      brokerLoad = null;
    }
  })();
  return brokerLoad;
}

/**
 * Is the remote party an internal broker VoIP number?
 * Returns `null` when it cannot be determined (network/link failure).
 */
export async function isBrokerVoipNumber(number: string): Promise<boolean | null> {
  const d = digits(number);
  if (!d) return null;
  // Bare extension → always internal.
  if (d.length >= 3 && d.length <= 5) return true;
  const set = await loadBrokerNumbers();
  if (!set) return null;
  return set.has(key(d));
}

type PostArgs = { providerCallId?: string | null; number?: string | null };

function log(msg: string, extra?: Record<string, unknown>) {
  console.info(`[maestro-call] ${msg}`, extra ?? {});
}

async function post(providerCallId: string, number: string, direction: "inbound" | "outbound") {
  posted.add(providerCallId);
  try {
    await maestroTelecom.createCall({
      provider_call_id: providerCallId,
      to_user_number: number || undefined,
      status: direction === "outbound" ? "dialing" : "created",
      direction,
    });
    log(`${direction} call posted`, { providerCallId, number });
  } catch (e: any) {
    posted.delete(providerCallId);
    console.warn("[maestro-call] post failed", e?.message ?? e);
  }
}

/** Rules 1 & 2 — always post outbound calls (client or broker VoIP). */
export function postOutboundCall({ providerCallId, number }: PostArgs): void {
  const id = String(providerCallId ?? "").trim();
  if (!id || posted.has(id)) return;
  void post(id, String(number ?? ""), "outbound");
}

/** Rules 3 & 4 — post inbound only when the caller is not a broker VoIP number. */
export function postInboundCall({ providerCallId, number }: PostArgs): void {
  const id = String(providerCallId ?? "").trim();
  if (!id || posted.has(id)) return;
  const num = String(number ?? "");
  void (async () => {
    const isBroker = await isBrokerVoipNumber(num);
    if (isBroker === true) {
      log("inbound from broker VoIP → skipped (rule 4)", { providerCallId: id, number: num });
      return;
    }
    if (isBroker === null) {
      // Fail-safe: unknown classification → skip rather than risk a duplicate.
      // The CDR pipeline (ns-webhook-receiver → maestro-sync-call) still syncs.
      log("inbound classification unavailable → skipped (fail-safe)", { providerCallId: id, number: num });
      return;
    }
    await post(id, num, "inbound");
  })();
}

/** Test/diagnostic helper. */
export function resetMaestroCallPostingCache() {
  posted.clear();
  brokerNumbers = null;
}
