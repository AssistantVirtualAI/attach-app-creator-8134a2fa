import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const ro = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const limit = z.number().int().min(1).max(200).default(50).describe("Max rows (1-200).");
const tenant = z.string().uuid().optional().describe("Optional Lemtel tenant id filter.");

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
function rows(name: string, data: unknown, error: { message: string } | null) {
  if (error) throw new ToolError(error.message);
  const list = (data ?? []) as { [k: string]: Json }[];
  return { content: [{ type: "text" as const, text: JSON.stringify(list) }], structuredContent: { [name]: list } };
}

export const listTenants = defineTool({
  name: "list_tenants",
  title: "List Lemtel tenants",
  description: "List Lemtel UC tenants and memberships visible to the signed-in user.",
  inputSchema: {},
  annotations: ro,
  handler: async (_i, ctx) => {
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb.from("luc_memberships").select("tenant_id, role, display_name, email, luc_tenants(name, slug, status, seat_limit)");
    return rows("memberships", data, error);
  },
});

export const listContacts = defineTool({
  name: "list_contacts",
  title: "List contacts",
  description: "List Lemtel UC contacts, optionally searching by name or number.",
  inputSchema: { tenant_id: tenant, search: z.string().trim().max(100).optional().describe("Name or number fragment."), limit },
  annotations: ro,
  handler: async ({ tenant_id, search, limit }, ctx) => {
    let q = supabaseForUser(ctx).from("luc_contacts").select("id, tenant_id, name, number, email, favorite, speed_dial").order("name").limit(limit);
    if (tenant_id) q = q.eq("tenant_id", tenant_id);
    if (search) { const s = search.replace(/[%,()]/g, ""); q = q.or(`name.ilike.%${s}%,number.ilike.%${s}%`); }
    const { data, error } = await q;
    return rows("contacts", data, error);
  },
});

export const listCalls = defineTool({
  name: "list_calls",
  title: "List call history",
  description: "List recent Lemtel UC call events (newest first).",
  inputSchema: { tenant_id: tenant, limit },
  annotations: ro,
  handler: async ({ tenant_id, limit }, ctx) => {
    let q = supabaseForUser(ctx).from("luc_call_events").select("id, tenant_id, direction, status, remote_number, duration_seconds, started_at, source").order("started_at", { ascending: false }).limit(limit);
    if (tenant_id) q = q.eq("tenant_id", tenant_id);
    const { data, error } = await q;
    return rows("calls", data, error);
  },
});

export const listVoicemails = defineTool({
  name: "list_voicemails",
  title: "List voicemails",
  description: "List Lemtel UC voicemails (newest first), optionally only unread.",
  inputSchema: { tenant_id: tenant, unread_only: z.boolean().default(false), limit },
  annotations: ro,
  handler: async ({ tenant_id, unread_only, limit }, ctx) => {
    let q = supabaseForUser(ctx).from("luc_voicemails").select("id, tenant_id, caller, duration_seconds, read, transcription_status, created_at").order("created_at", { ascending: false }).limit(limit);
    if (tenant_id) q = q.eq("tenant_id", tenant_id);
    if (unread_only) q = q.eq("read", false);
    const { data, error } = await q;
    return rows("voicemails", data, error);
  },
});

export const listConversations = defineTool({
  name: "list_conversations",
  title: "List conversations",
  description: "List Lemtel UC chat conversations the user belongs to.",
  inputSchema: { tenant_id: tenant, limit },
  annotations: ro,
  handler: async ({ tenant_id, limit }, ctx) => {
    let q = supabaseForUser(ctx).from("luc_conversations").select("id, tenant_id, kind, title, created_at").order("created_at", { ascending: false }).limit(limit);
    if (tenant_id) q = q.eq("tenant_id", tenant_id);
    const { data, error } = await q;
    return rows("conversations", data, error);
  },
});

export const listMessages = defineTool({
  name: "list_messages",
  title: "List messages",
  description: "List recent messages of one Lemtel UC conversation (newest first).",
  inputSchema: { conversation_id: z.string().uuid().describe("Conversation id."), limit },
  annotations: ro,
  handler: async ({ conversation_id, limit }, ctx) => {
    const { data, error } = await supabaseForUser(ctx).from("luc_messages").select("id, sender_id, body, created_at").eq("conversation_id", conversation_id).order("created_at", { ascending: false }).limit(limit);
    return rows("messages", data, error);
  },
});
