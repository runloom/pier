import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app/globals.css";

function bootstrap() {
  try {
    const rootEl = document.getElementById("root");
    if (rootEl) {
      createRoot(rootEl).render(
        <StrictMode>
          <App />
        </StrictMode>
      );
    }
  } catch (err) {
    console.error("[pier] bootstrap failed:", err);
  }
}

bootstrap();
