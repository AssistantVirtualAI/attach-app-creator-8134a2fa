// Contrat du lien « app mobile → portail AVA Statistic ».
//
// Gèle les points dont dépendent TOUTES les versions installées de l'app :
//  1. L'URL finale utilise l'origine historique https://avastatistic.ca et le
//     chemin /planipret/portal-handoff (accepté par les anciennes versions).
//  2. Le jeton voyage en paramètres de requête (th, em, to), jamais en
//     fragment — le navigateur intégré iOS peut perdre les fragments.
//  3. La fonction répond TOUJOURS HTTP 200, même en erreur (ok:false +
//     error lisible) : une réponse non-2xx masquait la vraie raison derrière
//     le message générique « lien du portail invalide ».
//  4. La destination `to` reste confinée à /planipret/broker ou
//     /planipret/admin (politique resolvePlanipretPortalTarget).
import { assert, assertEquals, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePlanipretPortalTarget } from "../_shared/planipret-portal-target.mjs";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("handoff URL: origine historique avastatistic.ca, chemin /planipret/portal-handoff", () => {
  assertStringIncludes(SOURCE, 'LEGACY_PORTAL_ORIGIN = "https://avastatistic.ca"');
  assertStringIncludes(SOURCE, "`${LEGACY_PORTAL_ORIGIN}/planipret/portal-handoff?${handoffParams}`");
});

Deno.test("handoff URL: jeton en paramètres de requête (th, em, to), pas de fragment", () => {
  assertStringIncludes(SOURCE, "new URLSearchParams({");
  assertStringIncludes(SOURCE, "th: String(link.properties.hashed_token)");
  assertStringIncludes(SOURCE, "em: user.email");
  assertStringIncludes(SOURCE, "to: target");
  // Aucun fragment (#) dans la construction de l'URL finale.
  const urlLine = SOURCE.split("\n").find((l) => l.includes("portal-handoff?"));
  assert(urlLine, "ligne de construction de l'URL introuvable");
  assert(!urlLine.includes("#"), "l'URL ne doit pas utiliser de fragment");
});

Deno.test("réponses: toujours HTTP 200, même en erreur (ok:false + error)", () => {
  // Le helper json() ignore le statut demandé et répond 200.
  assertMatch(SOURCE, /const json = \(b: unknown, status = 200\) =>/);
  assertMatch(SOURCE, /new Response\(JSON\.stringify\(b\), \{ status: 200/);
  // Chaque refus renvoie ok:false avec une raison lisible.
  for (const reason of ["not_authenticated", "no_planipret_profile", "handoff_stamp_failed", "link_failed"]) {
    assertStringIncludes(SOURCE, reason);
  }
  assertStringIncludes(SOURCE, 'json({ ok: false, error: "not_authenticated" }, 401)');
});

Deno.test("cible: courtier → /planipret/broker, admin → /planipret/admin", () => {
  assertEquals(resolvePlanipretPortalTarget(false, undefined), "/planipret/broker");
  assertEquals(resolvePlanipretPortalTarget(true, undefined), "/planipret/admin");
  assertEquals(resolvePlanipretPortalTarget(false, "/planipret/broker/clients"), "/planipret/broker/clients");
  assertEquals(resolvePlanipretPortalTarget(true, "/planipret/admin/users"), "/planipret/admin/users");
});

Deno.test("cible: un courtier ne peut pas viser /planipret/admin, rien hors /planipret", () => {
  assertEquals(resolvePlanipretPortalTarget(false, "/planipret/admin"), "/planipret/broker");
  assertEquals(resolvePlanipretPortalTarget(false, "/planipret/admin/users"), "/planipret/broker");
  assertEquals(resolvePlanipretPortalTarget(true, "/settings"), "/planipret/admin");
  assertEquals(resolvePlanipretPortalTarget(false, "https://evil.example/x"), "/planipret/broker");
  assertEquals(resolvePlanipretPortalTarget(true, "/planipret/admin/../../etc"), "/planipret/admin");
  assertEquals(resolvePlanipretPortalTarget(false, "/planipret/broker?x=1"), "/planipret/broker");
});

Deno.test("URL complète: forme acceptée par les versions installées", () => {
  // Rejoue la construction exacte de la fonction avec des valeurs fictives.
  const target = resolvePlanipretPortalTarget(false, undefined);
  const params = new URLSearchParams({ th: "fake_hashed_token", em: "courtier@example.com", to: target }).toString();
  const url = `https://avastatistic.ca/planipret/portal-handoff?${params}`;
  assert(url.startsWith("https://avastatistic.ca/planipret/portal-handoff?"));
  assert(!url.includes("#"));
  const u = new URL(url);
  assertEquals(u.searchParams.get("th"), "fake_hashed_token");
  assertEquals(u.searchParams.get("em"), "courtier@example.com");
  assertEquals(u.searchParams.get("to"), "/planipret/broker");
});

Deno.test("erreurs: correlation_id + code normalisé, jamais le message brut", () => {
  assertStringIncludes(SOURCE, 'failure("stamp", "handoff_stamp_failed", stampError)');
  assertStringIncludes(SOURCE, 'failure("generate_link", "link_failed", linkErr)');
  assertStringIncludes(SOURCE, 'failure("unexpected", "handoff_failed", e)');
  assertStringIncludes(SOURCE, "json({ ok: false, error: code, correlation_id }, 500)");
  assert(!/error:\s*linkErr\?\.message/.test(SOURCE), "message fournisseur renvoyé");
  assert(!/String\(\(e as Error\)\?\.message/.test(SOURCE), "message d'exception renvoyé");
});

Deno.test("logs: aucun JWT, jeton, courriel, metadata ou URL", () => {
  const logLines = SOURCE.split("\n").filter((l) => /console\.(log|warn|error)/.test(l));
  for (const l of logLines) {
    for (const bad of ["authHeader", "hashed_token", "user.email", "user_metadata", "handoffParams", "user.id", ".message"]) {
      assert(!l.includes(bad), `log sensible: ${bad} dans « ${l.trim()} »`);
    }
  }
});
