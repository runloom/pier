import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { DEFAULT_KEYMAP } from "./lib/keybindings/defaults.ts";
import { keybindingRegistry } from "./lib/keybindings/registry.ts";
import "./app/globals.css";

// 灌入默认 keymap — 在 render 前完成, 首次 keydown 即可命中.
keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

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
