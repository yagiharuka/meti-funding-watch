import { StrictMode } from "react";
import { shouldUseSourceView } from "@/scripts/funding-explorer-query.mjs";
import { createRoot } from "react-dom/client";

import Home from "@/app/page";
import FundingExplorer from "@/app/FundingExplorer";
import "./funding-explorer.css";
import SiteNotice from "@/app/SiteNotice";
import "@/app/globals.css";

import "./company-search-experience.css";
import "./company-search-alternatives.css";
import "./company-evidence-ui.css";
import "./subsidy-semantics-ui.css";
import "./data-reading-guide.css";
import "./site-balance-and-suggestions.css";




// GitHub Pages production shell. DOM-balancing copy is installed after React's
// first paint so it always sees the rendered filter notes and other targets.
const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root was not found");
}

// Preserve source bookmarks while new visits start from relationships.
const sourceView = shouldUseSourceView(window.location.search, window.location.hash);
async function render() {
if (sourceView) {
  await import("./funding-search-bridge");
  await import("./company-search-ui");
  await import("./company-evidence-ui");
  await import("./subsidy-semantics-ui");
}
createRoot(root!).render(
  <StrictMode>
    <SiteNotice />
    {sourceView ? <Home /> : <FundingExplorer />}
  </StrictMode>,
);

if (sourceView) requestAnimationFrame(() => {
  void import("./site-balance-and-suggestions");
});

}
void render();
