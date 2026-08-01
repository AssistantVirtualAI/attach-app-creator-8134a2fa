---
name: Anthropic prompt caching
description: All Claude calls go through supabase/functions/_shared/anthropic.ts which adds cache_control breakpoints on tools+system
type: preference
---
Never call `https://api.anthropic.com/v1/messages` with raw `fetch` in edge functions.
Use `callAnthropic()` / `claudeText()` from `supabase/functions/_shared/anthropic.ts`.

**How to apply:**
- Static content (instructions, JSON output schema, tool definitions) MUST live in `system`/`tools` so the prefix is byte-identical and cacheable.
- Variable content (transcript, email body, user message) MUST stay in `messages`.
- Breakpoints are auto-added only when the prefix exceeds the minimum cacheable length (1024 tokens Sonnet/Opus, 2048 Haiku).
- Usage logged per call: `[claude:label] in= out= cache_write= cache_read=`.
