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
import "./site-balance-and-suggestions";

// GitHub Pages production shell; search enhancements are installed before React mounts.
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
