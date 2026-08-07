import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import AdoptionsPage from "@/app/adoptions/page";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root was not found");
}

createRoot(root).render(
  <StrictMode>
    <AdoptionsPage />
  </StrictMode>,
);
