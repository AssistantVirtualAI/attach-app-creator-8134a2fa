import { describe, it, expect } from "vitest";
import {
  alreadyDecided,
  canSendFollowup,
  clientNameOf,
  clientNumberOf,
  followupIdempotencyKey,
  needsClientSelection,
  pickEndedCall,
  type ConsentCall,
} from "../postCallConsent";

const base = (over: Partial<ConsentCall> = {}): ConsentCall => ({
  id: "call-1",
  user_id: "broker-1",
  from_number: "+15550001111",
  to_number: "+15550002222",
  direction: "outbound",
  maestro_client_id: "cli-1",
  maestro_client_name: "Client Fictif",
  from_name: null,
  to_name: null,
  duration_seconds: 42,
  save_consent: null,
  ...over,
});

describe("sélection de l'appel terminé", () => {
  it("retient uniquement l'appel désigné par l'événement", () => {
    const rows = [base({ id: "call-9" }), base({ id: "call-1" })];
    expect(pickEndedCall(rows, { providerCallId: "call-1" }, ["broker-1"])?.id).toBe("call-1");
  });

  it("ne réutilise jamais un appel déjà tranché", () => {
    expect(pickEndedCall([base({ save_consent: "approved" })], { providerCallId: "call-1" }, ["broker-1"])).toBeNull();
    expect(alreadyDecided({ save_consent: "declined" })).toBe(true);
  });
});

describe("client post-appel", () => {
  it("prend l'appelant comme client quand NetSapiens normalise en inbound", () => {
    const call = base({ direction: "inbound", maestro_client_name: null, from_name: "Marc", to_name: "Courtier" });
    expect(clientNumberOf(call)).toBe("+15550001111");
    expect(clientNameOf(call)).toBe("Marc");
  });

  it("demande le choix du client uniquement quand aucune identité n'est disponible", () => {
    expect(needsClientSelection(base({ maestro_client_id: null, maestro_client_name: null }))).toBe(true);
    expect(needsClientSelection(base())).toBe(false);
  });
});

describe("garde d'envoi du suivi", () => {
  const draft = { kind: "sms" as const, body: "Merci pour l'appel.", recipient: "+15550002222", confirmed: true };
  it("requiert une confirmation explicite et reste idempotent", () => {
    expect(canSendFollowup({ ...draft, confirmed: false })).toBe(false);
    expect(canSendFollowup(draft)).toBe(true);
    const value = { userId: "u1", callId: "c1", kind: "sms" as const, recipient: draft.recipient, body: draft.body };
    expect(followupIdempotencyKey(value)).toBe(followupIdempotencyKey(value));
  });
});
