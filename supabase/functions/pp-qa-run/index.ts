// Harnais QA temporaire : exécute les scénarios de test en tant qu'un courtier donné.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function tool(userId: string, name: string, params: Record<string, unknown>) {
  const t0 = Date.now();
  const res = await fetch(`${URL_}/functions/v1/ava-tool-executor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      "x-ava-tool-name": name,
    },
    body: JSON.stringify({ _user_id: userId, tool_name: name, parameters: params, session_id: "qa" }),
  });
  const data = await res.json().catch(() => ({}));
  return { tool: name, status: res.status, ms: Date.now() - t0, data };
}

async function fn(path: string, body: unknown, userId?: string) {
  const t0 = Date.now();
  const res = await fetch(`${URL_}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      ...(userId ? { "x-user-id": userId } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.text();
  return { path, status: res.status, ms: Date.now() - t0, data: data.slice(0, 1200) };
}

Deno.serve(async (req) => {
  const admin = createClient(URL_, SR);
  const { steps = [], user_id } = await req.json().catch(() => ({} as any));
  const out: unknown[] = [];
  for (const s of steps) {
    try {
      if (s.kind === "tool") out.push(await tool(s.user_id ?? user_id, s.name, s.params ?? {}));
      else out.push(await fn(s.path, s.body ?? {}, s.user_id ?? user_id));
    } catch (e) {
      out.push({ step: s, error: String(e) });
    }
  }
  return Response.json({ out }, { headers: { "Access-Control-Allow-Origin": "*" } });
});
