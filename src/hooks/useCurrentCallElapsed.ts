import { useEffect, useReducer, useRef } from "react";

/** Presentation only: terminal/ringing states cannot retain a previous duration. */
export function useCurrentCallElapsed(callState: string, startedAt: number | null | undefined, callId?: string | null) {
  const [, tick] = useReducer((value: number) => value + 1, 0);
  const clock = useRef<{ initialized: boolean; callId?: string | null; start: number | null; awaitingAnswer: boolean }>({
    initialized: false, start: null, awaitingAnswer: false,
  });
  const connected = callState === "active" || callState === "held";
  const current = clock.current;
  if (!connected) {
    current.start = null;
    current.awaitingAnswer = true;
  } else if (!current.initialized) {
    // A screen mounted during an already connected call retains its duration.
    current.start = startedAt ?? null;
  } else if (current.awaitingAnswer || (callId && callId !== current.callId)) {
    // The native snapshot can retain the ring/previous-call timestamp.
    current.start = Date.now();
    current.awaitingAnswer = false;
  } else if (current.start == null && startedAt != null) {
    current.start = startedAt;
  }
  current.initialized = true;
  current.callId = callId;
  const start = current.start;
  useEffect(() => {
    if (!connected || start == null) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [connected, start]);

  // Derive on every render so hangup resets synchronously, not after an effect.
  return connected && start != null
    ? Math.max(0, Math.floor((Date.now() - start) / 1000))
    : 0;
}