import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Home from "@/app/page";
import SiteNotice from "@/app/SiteNotice";
import "@/app/globals.css";
import "./funding-search-bridge";
import "./company-search-experience.css";
import "./company-search-alternatives.css";
import "./company-search-ui";
import "./company-search-alternatives";

// This entrypoint is the GitHub Pages production shell.
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
