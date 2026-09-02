import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import {
  registerServiceWorker,
  requestPersistentStorage,
} from "./lib/register-sw.ts";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root container");
}

registerServiceWorker();
requestPersistentStorage();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
