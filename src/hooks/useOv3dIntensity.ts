import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* 3D intensity control + runtime profiler for the broker overview.
   The depth multiplier is exposed as the CSS var `--ov3d-d` on <html>
   so every `.ov3d-*` rule scales without re-rendering React trees. */

export type Ov3dLevel = "auto" | "flat" | "light" | "medium" | "max";

export const OV3D_DEPTH: Record<Exclude<Ov3dLevel, "auto">, number> = {
  flat: 0,
  light: 0.45,
  medium: 1,
  max: 1.4,
};

const KEY = "pp.ov3d.level";

function applyDepth(level: Ov3dLevel) {
  const el = document.documentElement;
  if (level === "auto") el.style.removeProperty("--ov3d-d");
  else el.style.setProperty("--ov3d-d", String(OV3D_DEPTH[level]));
}

export function useOv3dIntensity() {
  const [level, setLevelState] = useState<Ov3dLevel>(() => {
    try {
      const v = localStorage.getItem(KEY) as Ov3dLevel | null;
      if (v && ["auto", "flat", "light", "medium", "max"].includes(v)) return v;
    } catch { /* ignore */ }
    return "auto";
  });
  const [autoReduced, setAutoReduced] = useState(false);

  useEffect(() => { applyDepth(level); }, [level]);

  const setLevel = useCallback((v: Ov3dLevel) => {
    setLevelState(v);
    setAutoReduced(false);
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
  }, []);

  /** Called by the profiler when the framerate collapses. */
  const degrade = useCallback(() => {
    setLevelState((cur) => {
      if (cur === "flat" || cur === "light") return cur;
      setAutoReduced(true);
      return "light";
    });
  }, []);

  return { level, setLevel, autoReduced, degrade };
}

/**
 * Measures the framerate of a short interaction window (sort / filter /
 * data refresh). Calls `onSlow` when the median frame budget is blown.
 */
export function useOv3dProfiler(onSlow: () => void, enabled = true) {
  const running = useRef(false);
  const cb = useRef(onSlow);
  cb.current = onSlow;

  return useCallback((durationMs = 700) => {
    if (!enabled || running.current || typeof performance === "undefined") return;
    running.current = true;
    const start = performance.now();
    let last = start;
    let frames = 0;
    let slowFrames = 0;

    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      frames += 1;
      if (dt > 26) slowFrames += 1; // < ~38 fps
      if (t - start < durationMs) {
        requestAnimationFrame(tick);
      } else {
        running.current = false;
        const fps = (frames * 1000) / (t - start);
        if (fps < 42 && slowFrames > frames * 0.35) cb.current();
      }
    };
    requestAnimationFrame(tick);
  }, [enabled]);
}

/**
 * Returns `true` for a short window after `deps` change, so tables can
 * render in "quiet" mode (no transitions, no layered shadows, no chart
 * filters) while rows are reordered — flicker-free sorting/filtering.
 */
export function useOv3dQuiet(deps: unknown[], holdMs = 260) {
  const [quiet, setQuiet] = useState(false);
  const first = useRef(true);
  const key = useMemo(() => {
    try { return JSON.stringify(deps); } catch { return String(deps.length); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setQuiet(true);
    const raf = requestAnimationFrame(() => {
      // release after paint + hold, on an idle callback when available
      const done = () => setQuiet(false);
      const t = setTimeout(() => {
        const ric = (window as any).requestIdleCallback as undefined | ((f: () => void) => number);
        if (ric) ric(done); else done();
      }, holdMs);
      (raf as any).__t = t;
    });
    return () => cancelAnimationFrame(raf);
  }, [key, holdMs]);

  return quiet;
}
