import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Home from "@/app/page";
import SiteNotice from "@/app/SiteNotice";
import "@/app/globals.css";
import "@/app/mobile-search-summary.css";
import "./search-disclosures.css";
import "./search-disclosures";

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
