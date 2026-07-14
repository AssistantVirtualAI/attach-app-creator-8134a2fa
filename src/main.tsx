import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "@fontsource/urbanist/500.css";
import "@fontsource/urbanist/600.css";
import "@fontsource/urbanist/700.css";
import "@fontsource/epilogue/400.css";
import "@fontsource/epilogue/500.css";
import "@fontsource/epilogue/600.css";
import "./lib/reloadDiagnostics";
import "./lib/devPreviewGuard";
import "./lib/styleHealthGuard";
import "./lib/buildVersionPoller";
import { initPerfMetrics } from "./lib/perfMetrics";
import { scheduleIdlePrefetch } from "./lib/routePrefetch";
import App from "./App.tsx";
import { initSentry } from "./lib/sentry";
import { consumeAppLoginToken } from "./lib/auth/consumeAppLoginToken";

// Initialize Sentry for error monitoring (if configured)
initSentry();

// Auto-login via ?ava_token=... (mobile/desktop app invites). Best-effort; runs
// before React mounts so the session is ready when ProtectedRoute evaluates.
consumeAppLoginToken().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
