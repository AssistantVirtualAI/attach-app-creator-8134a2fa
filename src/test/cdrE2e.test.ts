import { describe, it, expect } from "vitest";
import { buildCdrE2eReport } from "../../supabase/functions/_shared/pp-cdr-e2e";

const NOW = new Date("2026-08-24T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const find = (r: ReturnType<typeof buildCdrE2eReport>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("test de bout en bout CDR (webhook → Maestro)", () => {
  it("valide la chaîne complète quand webhook et push Maestro sont récents", () => {
    const r = buildCdrE2eReport({
      webhookSubscription: true,
      lastCallAt: hoursAgo(1),
      lastMaestroPushAt: hoursAgo(1),
      now: NOW,
    });
    expect(r.verdict).toBe("ok");
    expect(find(r, "cdr_received").status).toBe("ok");
    expect(find(r, "maestro_push").status).toBe("ok");
  });

  it("diagnostique clairement l'absence d'abonnement webhook", () => {
    const r = buildCdrE2eReport({
      webhookSubscription: false,
      lastCallAt: null,
      lastMaestroPushAt: null,
      now: NOW,
    });
    expect(r.verdict).toBe("fail");
    const c = find(r, "webhook_subscription");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/aucun CDR n'arrivera jamais/i);
    expect(c.action).toBeTruthy();
  });

  it("signale un CDR reçu mais jamais poussé vers Maestro (widget vide)", () => {
    const r = buildCdrE2eReport({
      webhookSubscription: true,
      lastCallAt: hoursAgo(2),
      lastMaestroPushAt: null,
      now: NOW,
    });
    expect(r.verdict).toBe("fail");
    expect(find(r, "cdr_received").status).toBe("ok");
    const push = find(r, "maestro_push");
    expect(push.status).toBe("fail");
    expect(push.detail).toMatch(/widget/i);
  });

  it("signale l'absence totale de CDR après un appel de test", () => {
    const r = buildCdrE2eReport({
      webhookSubscription: true,
      lastCallAt: null,
      lastMaestroPushAt: null,
      now: NOW,
    });
    const cdr = find(r, "cdr_received");
    expect(cdr.status).toBe("fail");
    expect(cdr.action).toMatch(/appel de test/i);
    // Le push Maestro n'est qu'un avertissement : la cause racine est en amont.
    expect(find(r, "maestro_push").status).toBe("warn");
  });

  it("remonte l'erreur exacte du dernier push Maestro échoué", () => {
    const r = buildCdrE2eReport({
      webhookSubscription: true,
      lastCallAt: hoursAgo(1),
      lastMaestroPushAt: hoursAgo(5),
      lastMaestroError: "cdr → HTTP 401",
      now: NOW,
    });
    expect(r.verdict).toBe("fail");
    expect(find(r, "maestro_push").detail).toContain("HTTP 401");
  });

  it("avertit quand la chaîne est silencieuse depuis plus que la fenêtre", () => {
    const r = buildCdrE2eReport({
      webhookSubscription: true,
      lastCallAt: hoursAgo(200),
      lastMaestroPushAt: hoursAgo(200),
      now: NOW,
    });
    expect(r.verdict).toBe("warn");
    expect(r.summary).toMatch(/silencieuse/i);
  });
});
