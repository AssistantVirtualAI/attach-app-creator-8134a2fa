// Claude (Anthropic) provider helper for the AI SDK.
// Replaces the former Lovable AI Gateway provider: every legacy model id
// (google/*, openai/*, ...) is mapped to an equivalent Claude model.
import { createAnthropic } from "npm:@ai-sdk/anthropic";
import { toClaudeModel } from "./claude-compat.ts";

export function createClaudeProvider(apiKey?: string) {
  const anthropic = createAnthropic({
    apiKey: apiKey ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "",
  });
  return (model: string) => anthropic(toClaudeModel(model));
}

/** @deprecated kept for call-site compatibility — now returns Claude. */
export function createLovableAiGatewayProvider(_apiKey?: string) {
  return createClaudeProvider();
}
