import { useEffect } from "react";

const PLANIPRET_FAVICON = "/favicon.png?v=3";
const PLANIPRET_TOUCH_ICON = "/icon-192.png?v=5";

function lockPlanipretIcons() {
  let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.appendChild(favicon);
  }
  favicon.type = "image/png";
  if (favicon.getAttribute("href") !== PLANIPRET_FAVICON) favicon.href = PLANIPRET_FAVICON;

  document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]').forEach((link) => {
    if (link.getAttribute("href") !== PLANIPRET_TOUCH_ICON) link.href = PLANIPRET_TOUCH_ICON;
  });
}

/** Keeps Planiprêt branding from being replaced by global white-label settings. */
export function usePlanipretFavicon() {
  useEffect(() => {
    lockPlanipretIcons();
    const observer = new MutationObserver(lockPlanipretIcons);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    return () => observer.disconnect();
  }, []);
}