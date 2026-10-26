import { useEffect, useReducer } from "react";

/** Presentation only: terminal/ringing states cannot retain a previous duration. */
export function useCurrentCallElapsed(callState: string, startedAt: number | null | undefined) {
  const [, tick] = useReducer((value: number) => value + 1, 0);
  const connected = callState === "active" || callState === "held";
  useEffect(() => {
    if (!connected || startedAt == null) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [connected, startedAt]);

  // Derive on every render so hangup resets synchronously, not after an effect.
  return connected && startedAt != null
    ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    : 0;
}