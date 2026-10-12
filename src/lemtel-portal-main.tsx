import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "@fontsource/urbanist/600.css";
import "@fontsource/urbanist/700.css";
import "./lemtel-portal-build.css";
import LemtelPortalApp from "./pages/lemtel/onboarding/LemtelPortalApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LemtelPortalApp />
      <Toaster richColors closeButton />
    </BrowserRouter>
  </React.StrictMode>,
);
