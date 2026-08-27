---
name: No Lovable AI gateway — Claude only
description: All AI calls in edge functions go through Claude (Anthropic) via _shared/claude-compat.ts; STT uses OpenAI Whisper
type: constraint
---
Never call `https://ai.gateway.lovable.dev` or use `LOVABLE_API_KEY` in edge functions.

**How to apply:**
- Chat/completions: use `aiFetch()` from `supabase/functions/_shared/claude-compat.ts` (OpenAI-shaped in/out, routed to Anthropic Messages with prompt caching), or `callAnthropic`/`claudeText` from `_shared/anthropic.ts`.
- AI SDK: `createClaudeProvider()` from `_shared/ai-gateway.ts` (legacy model ids are mapped to Claude).
- Speech-to-text: OpenAI Whisper via `OPENAI_API_KEY` (Claude has no STT).
- Keys: `ANTHROPIC_API_KEY` for text, `OPENAI_API_KEY` for audio.
