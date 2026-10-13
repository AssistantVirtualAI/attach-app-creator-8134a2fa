import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { listTenants, listContacts, listCalls, listVoicemails, listConversations, listMessages } from "./tools/luc-read";
import createContact from "./tools/luc-create-contact";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "attach-app-creator",
  title: "attach-app-creator",
  version: "0.1.0",
  instructions:
    "Lemtel UC tools: read tenants, contacts, call history, voicemails and chat for the signed-in user, and create contacts. Access follows the user's Lemtel permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    requireOAuthClientClaim: true,
  }),
  tools: [listTenants, listContacts, listCalls, listVoicemails, listConversations, listMessages, createContact],
});
