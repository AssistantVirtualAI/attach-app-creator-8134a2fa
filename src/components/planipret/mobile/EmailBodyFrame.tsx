import { useEffect, useRef, useState } from "react";

/**
 * Builds the isolated e-mail document. E-mails originate outside Planiprêt and
 * frequently hard-code black text. In the dark application shell, that makes
 * legitimate content invisible, so the reader owns text contrast while keeping
 * the HTML sandboxed and media responsive.
 */
export function buildEmailBodySrcDoc(html: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta name="color-scheme" content="light" />
<base target="_blank" />
<style>
  :root { color-scheme: light; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff !important;
    color: #172033 !important;
    -webkit-text-fill-color: #172033 !important;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    -webkit-text-size-adjust: 100%;
  }
  body { padding: 14px 12px 18px; }
  /* External HTML often includes inline color:#000 or legacy color attributes.
     The reader deliberately wins those colors to preserve contrast on its
     neutral paper surface in both application themes. */
  body, body * {
    color: #172033 !important;
    -webkit-text-fill-color: #172033 !important;
    text-shadow: none !important;
  }
  * { max-width: 100% !important; box-sizing: border-box; }
  img, video, iframe { max-width: 100% !important; height: auto !important; display: inline-block; }
  table { width: 100% !important; max-width: 100% !important; table-layout: fixed !important; border-collapse: collapse; }
  td, th { word-break: break-word; overflow-wrap: anywhere; }
  pre, code { white-space: pre-wrap; word-break: break-word; }
  blockquote {
    margin: 8px 0;
    padding-left: 8px;
    border-left: 3px solid #cbd5e1;
    color: #475569 !important;
    -webkit-text-fill-color: #475569 !important;
  }
  a {
    color: #075985 !important;
    -webkit-text-fill-color: #075985 !important;
    text-decoration: underline;
    word-break: break-all;
  }
</style>
</head>
<body>${html}
<script>
  (function () {
    var lastHeight = 0;
    var frame = 0;
    function report() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
      var h = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      );
      if (Math.abs(h - lastHeight) > 1) {
        lastHeight = h;
        parent.postMessage({ __ppEmailFrame: true, height: h }, "*");
      }
      });
    }
    window.addEventListener("load", report);
    setTimeout(report, 50);
    setTimeout(report, 400);
    setTimeout(report, 1200);
    var ro = new ResizeObserver(report);
    ro.observe(document.body);
  })();
<\/script>
</body></html>`;
}

/**
 * Renders an HTML email body inside a sandboxed iframe with a mobile viewport
 * so tables/images clamp to the screen width (like iOS Mail).
 */
export default function EmailBodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(200);
  const srcDoc = buildEmailBodySrcDoc(html);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d: any = e.data;
      if (!d || d.__ppEmailFrame !== true) return;
      if (typeof d.height === "number") {
        setHeight(Math.min(6000, Math.max(120, Math.ceil(d.height) + 8)));
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <iframe
      ref={ref}
      title="email-body"
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc}
      style={{
        width: "100%",
        border: "0",
        background: "#ffffff",
        borderRadius: 8,
        height,
        display: "block",
      }}
    />
  );
}
