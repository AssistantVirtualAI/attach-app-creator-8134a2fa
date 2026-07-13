import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 50);
    if (!q) return json({ calls: [], messages: [], voicemails: [], insights: [], contacts: [], emails: [] });

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await supa.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);
    const { data: lemtelOnly } = await supa.rpc("is_lemtel_only", { _user_id: userId });
    if (lemtelOnly === true) return json({ error: "forbidden_wrong_app", app: "lemtel" }, 403);

    const like = `%${q}%`;
    const [calls, messages, voicemails, insights] = await Promise.all([
      supa.from("planipret_phone_calls").select("id,direction,caller_number,callee_number,from_name,to_name,duration_seconds,lead_score,lead_temperature,started_at,created_at")
        .eq("user_id", userId)
        .or(`caller_number.ilike.${like},callee_number.ilike.${like},from_name.ilike.${like},to_name.ilike.${like}`)
        .order("created_at", { ascending: false }).limit(limit),
      supa.from("planipret_phone_messages").select("id,direction,from_number,to_number,body,created_at")
        .eq("user_id", userId)
        .or(`from_number.ilike.${like},to_number.ilike.${like},body.ilike.${like}`)
        .order("created_at", { ascending: false }).limit(limit),
      supa.from("planipret_voicemails").select("id,from_number,duration_seconds,transcript,created_at")
        .eq("user_id", userId)
        .or(`from_number.ilike.${like},transcript.ilike.${like}`)
        .order("created_at", { ascending: false }).limit(limit),
      supa.from("planipret_ai_insights").select("id,call_id,summary,created_at")
        .ilike("summary", like).order("created_at", { ascending: false }).limit(limit),
    ]);

    const [contacts, emails] = await Promise.all([
      tryInvoke(supa, "maestro-actions", { action: "list_contacts", q }, "contacts"),
      tryInvoke(supa, "ms365-actions", { action: "read_emails", q }, "emails"),
    ]);

    return json({
      calls: calls.data ?? [],
      messages: messages.data ?? [],
      voicemails: voicemails.data ?? [],
      insights: insights.data ?? [],
      contacts: contacts.slice(0, limit),
      emails: emails.slice(0, limit),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function tryInvoke(supa: any, fn: string, body: any, key: string): Promise<any[]> {
  try {
    const { data } = await supa.functions.invoke(fn, { body });
    const arr = Array.isArray(data?.[key]) ? data[key] : Array.isArray(data) ? data : [];
    return arr;
  } catch { return []; }
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
