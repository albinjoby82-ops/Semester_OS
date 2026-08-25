import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registered after render so it never delays first paint. Dev is excluded:
// a cached shell during development hides the change you just made.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
