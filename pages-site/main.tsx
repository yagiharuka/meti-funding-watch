import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Home from "@/app/page";
import SiteNotice from "@/app/SiteNotice";
import "@/app/globals.css";
import "./funding-search-bridge";
import "./company-search-experience.css";
import "./company-search-alternatives.css";
import "./company-evidence-ui.css";
import "./subsidy-semantics-ui.css";
import "./data-reading-guide.css";
import "./site-balance-and-suggestions.css";
import "./company-search-ui";
import "./company-evidence-ui";
import "./subsidy-semantics-ui";

// GitHub Pages production shell. DOM-balancing copy is installed after React's
// first paint so it always sees the rendered filter notes and other targets.
const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root was not found");
}

createRoot(root).render(
  <StrictMode>
    <SiteNotice />
    <Home />
  </StrictMode>,
);

requestAnimationFrame(() => {
  void import("./site-balance-and-suggestions");
});
