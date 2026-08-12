import { useCallback, useEffect, useState } from "react";

/**
 * "Haute lisibilité" (high readability) accessibility mode for the Planiprêt
 * portals. When enabled we set `data-pp-hr="1"` on <html>, which:
 *  - flattens every 3D chart (no SVG relief filters, opaque fills)
 *  - raises text contrast and font sizes on charts/tables
 *  - thickens strokes, grid lines and focus rings
 * The preference is persisted so it follows the broker across sessions.
 */
const KEY = "pp.highReadability";
const ATTR = "data-pp-hr";

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

function apply(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.setAttribute(ATTR, "1");
  else document.documentElement.removeAttribute(ATTR);
}

export function isHighReadability(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute(ATTR) === "1";
}

export function usePpHighReadability() {
  const [enabled, setEnabled] = useState<boolean>(read);

  useEffect(() => { apply(enabled); }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { enabled, toggle };
}
