// Sonde temporaire : teste plusieurs formes de payload SMS vers Maestro.
import { adminClient, getBrokerAuth, getMaestroConfig, maestroFetchScoped } from "../_shared/maestro.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const msgId = url.searchParams.get("message_id")!;
  const admin = adminClient();
  const cfg = await getMaestroConfig(admin);
  const { data: m } = await admin
    .from("planipret_phone_messages")
    .select("*").eq("id", msgId).maybeSingle();
  if (!m) return Response.json({ error: "not_found" });
  const { data: prof } = await admin
    .from("planipret_profiles").select("phone")
    .or(`user_id.eq.${m.user_id},id.eq.${m.user_id}`).maybeSingle();
  const auth = await getBrokerAuth(admin, m.user_id);
  const broker = prof?.phone ?? null;
  const contact = m.direction === "inbound" ? m.from_number : m.to_number;
  const e164 = (v: string | null) => (v ? (v.startsWith("+") ? v : `+${v.replace(/\D/g, "")}`) : null);

  const variants: Record<string, unknown>[] = [
    { from_user_number: e164(contact), to_user_number: e164(broker), body: m.body, direction: "inbound", sent_at: m.sent_at },
    { from_user_number: e164(contact), to_user_number: e164(broker), message: m.body, direction: "inbound", sent_at: m.sent_at, contact_number: e164(contact) },
    { from_user_number: e164(contact), to_user_number: e164(broker), body: m.body },
    { from_user_number: e164(contact), to_user_number: e164(broker), body: m.body, message_id: m.ns_message_id ?? m.id },
  ];

  const out: unknown[] = [];
  for (const [i, body] of variants.entries()) {
    const res = await maestroFetchScoped(cfg, {
      method: "POST", path: "/api/v1/messages", token: auth.token,
      brokerId: auth.brokerId, body,
    });
    out.push({ i, status: res.status, data: JSON.stringify(res.data).slice(0, 300) });
  }
  return Response.json({ broker_id: auth.brokerId, broker, contact, out });
});
