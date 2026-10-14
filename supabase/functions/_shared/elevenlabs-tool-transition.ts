export type ElevenLabsRegistryTool = {
  id?: string;
  tool_id?: string;
  tool_config?: { name?: string; type?: string };
  name?: string;
  type?: string;
};

export type ElevenLabsAgentPrompt = {
  tool_ids?: string[];
};

export function toolId(tool: ElevenLabsRegistryTool): string | null {
  return tool.id ?? tool.tool_id ?? null;
}

export function toolName(tool: ElevenLabsRegistryTool): string | null {
  return tool.tool_config?.name ?? tool.name ?? null;
}

export function toolType(tool: ElevenLabsRegistryTool): string | null {
  return tool.tool_config?.type ?? tool.type ?? null;
}

/**
 * Tool types cannot be mutated while the old tool is attached to an ElevenLabs
 * agent. Keep every unaffected id, remove only type-changing ids, then replace
 * those ids after their new registry entries are created.
 */
export function planToolTypeTransition(
  prompt: ElevenLabsAgentPrompt | null | undefined,
  registry: ElevenLabsRegistryTool[],
  desiredTypes: Map<string, string>,
) {
  const byId = new Map(registry.map((tool) => [toolId(tool), tool] as const).filter(([id]) => Boolean(id)));
  const attachedIds = Array.isArray(prompt?.tool_ids) ? prompt!.tool_ids! : [];
  const replaceIds = new Set<string>();
  const replaceNames = new Set<string>();

  for (const id of attachedIds) {
    const existing = byId.get(id);
    const name = existing ? toolName(existing) : null;
    const currentType = existing ? toolType(existing) : null;
    const desiredType = name ? desiredTypes.get(name) : null;
    if (name && currentType && desiredType && currentType !== desiredType) {
      replaceIds.add(id);
      replaceNames.add(name);
    }
  }

  return {
    attachedIds,
    replaceIds: [...replaceIds],
    replaceNames: [...replaceNames],
    retainedIds: attachedIds.filter((id) => !replaceIds.has(id)),
  };
}
