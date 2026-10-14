// Guard: analysis is allowed when at least one usable AI key is present.
export function hasUsableAiKey(env: { anthropic?: string | null; openai?: string | null }): boolean {
  return Boolean(env.anthropic?.trim()) || Boolean(env.openai?.trim());
}
