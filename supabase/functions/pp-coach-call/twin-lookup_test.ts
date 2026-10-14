import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchTwinTranscript } from "./twin-lookup.ts";

// Mock admin client qui enregistre les filtres appliqués à la requête.
function mockAdmin(rows: any[]) {
  const filters: { method: string; args: any[] }[] = [];
  const chain: any = {
    select: (...a: any[]) => (filters.push({ method: "select", args: a }), chain),
    eq: (...a: any[]) => (filters.push({ method: "eq", args: a }), chain),
    neq: (...a: any[]) => (filters.push({ method: "neq", args: a }), chain),
    is: (...a: any[]) => (filters.push({ method: "is", args: a }), chain),
    not: (...a: any[]) => (filters.push({ method: "not", args: a }), chain),
    or: (...a: any[]) => (filters.push({ method: "or", args: a }), chain),
    limit: (...a: any[]) => (filters.push({ method: "limit", args: a }), chain),
    then: (resolve: any) => resolve({ data: rows }),
  };
  return { from: () => chain, filters };
}

const OWNER = "broker-owner-uuid";
const OTHER = "other-broker-uuid";
const LONG_TRANSCRIPT = "Bonjour, ceci est une transcription suffisamment longue pour être acceptée.";

Deno.test("1. transcription jumeau du même user_id acceptée", async () => {
  const admin = mockAdmin([{ id: "twin-1", transcript: LONG_TRANSCRIPT, transcript_segments: null }]);
  const twin = await fetchTwinTranscript(admin, { user_id: OWNER, ns_callid: "ns-abc-123456" }, "call-1");
  assert(twin, "un jumeau doit être trouvé");
  assertEquals(twin!.transcript, LONG_TRANSCRIPT);
  const eqUser = admin.filters.find((f) => f.method === "eq" && f.args[0] === "user_id");
  assert(eqUser, "le filtre user_id doit être appliqué");
  assertEquals(eqUser.args[1], OWNER);
});

Deno.test("2. transcription jumeau d'un autre user_id jamais lue ni copiée", async () => {
  // La requête filtre user_id = OWNER côté serveur : un jumeau d'un autre
  // courtier ne peut pas être retourné. Simule la réponse filtrée (vide).
  const admin = mockAdmin([]);
  const twin = await fetchTwinTranscript(admin, { user_id: OWNER, ns_callid: "ns-abc-123456" }, "call-1");
  assertEquals(twin, null);
  // Prouve que la requête demande bien user_id = OWNER et jamais OTHER.
  const eqUser = admin.filters.find((f) => f.method === "eq" && f.args[0] === "user_id");
  assertEquals(eqUser?.args[1], OWNER);
  assert(!admin.filters.some((f) => f.args.includes(OTHER)), "aucun filtre ne doit référencer un autre user_id");
});

Deno.test("3. row.user_id absent => aucune recherche jumeau", async () => {
  const admin = mockAdmin([{ id: "twin-1", transcript: LONG_TRANSCRIPT, transcript_segments: null }]);
  const twin = await fetchTwinTranscript(admin, { user_id: null, ns_callid: "ns-abc-123456" }, "call-1");
  assertEquals(twin, null);
  assertEquals(admin.filters.length, 0, "aucune requête ne doit être construite");

  const admin2 = mockAdmin([{ id: "twin-1", transcript: LONG_TRANSCRIPT, transcript_segments: null }]);
  const twin2 = await fetchTwinTranscript(admin2, { ns_callid: "ns-abc-123456" }, "call-1");
  assertEquals(twin2, null);
  assertEquals(admin2.filters.length, 0);
});
