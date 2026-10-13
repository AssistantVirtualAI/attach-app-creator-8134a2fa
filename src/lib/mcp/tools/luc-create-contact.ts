import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_contact",
  title: "Create contact",
  description: "Create a Lemtel UC contact owned by the signed-in user in one of their tenants.",
  inputSchema: {
    tenant_id: z.string().uuid().describe("Lemtel tenant id (see list_tenants)."),
    name: z.string().trim().min(1).max(120),
    number: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(200).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ tenant_id, name, number, email }, ctx) => {
    const owner = ctx.getUserId();
    if (!owner) throw new ToolError("Not authenticated");
    const { data, error } = await supabaseForUser(ctx)
      .from("luc_contacts")
      .insert({ tenant_id, owner_id: owner, name, number: number ?? null, email: email ?? null })
      .select("id, tenant_id, name, number, email")
      .single();
    if (error) throw new ToolError(error.message);
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { contact: data } };
  },
});
