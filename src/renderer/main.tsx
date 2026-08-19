import { installDocumentAutoHideScrollbars } from "@pier/ui/auto-hide-scrollbar.ts";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { RendererBootSignal } from "./app/boot-signal.tsx";
import { installBundledFontFaces } from "./app/fonts.ts";
import "./app/globals.css";
import { AppContentDialogHost } from "./components/common/dialogs/content-host.tsx";
import { AppDialogHost } from "./components/common/dialogs/host.tsx";
import {
  StartupErrorScreen,
  StartupScreen,
} from "./components/common/startup-error-screen.tsx";

let applicationRoot: Root | null = null;

function getApplicationRoot(): Root {
  if (applicationRoot) {
    return applicationRoot;
  }
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Pier root element is missing");
  }
  applicationRoot = createRoot(rootElement);
  return applicationRoot;
}

async function bootstrap() {
  installBundledFontFaces();
  installDocumentAutoHideScrollbars();
  const root = getApplicationRoot();
  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get("pierDebug");
  const targetBrowserWindowId = Number(params.get("targetBrowserWindowId"));
  const isTerminalDebug =
    debugMode === "terminal" && Number.isFinite(targetBrowserWindowId);
  // Paint the startup shell (and signal readiness) before importing App,
  // settings, canvas runtime, or mermaid. Those modules are too large for
  // the main-process 15s window-show watchdog on a cold Vite graph.
  root.render(
    isTerminalDebug ? (
      <RendererBootSignal key="terminal-debug" />
    ) : (
      <>
        <AppDialogHost />
        <AppContentDialogHost />
        <RendererBootSignal key="startup" />
        <StartupScreen />
      </>
    )
  );

  const { startApplication } = await import("./app/start-application.tsx");
  await startApplication({
    debugMode,
    root,
    targetBrowserWindowId,
  });
}

bootstrap().catch((err) => {
  console.error("[pier] bootstrap failed:", err);
  try {
    getApplicationRoot().render(
      <>
        <AppDialogHost />
        <AppContentDialogHost />
        <RendererBootSignal key="startup-error" />
        <StartupErrorScreen error={err} />
      </>
    );
  } catch (renderError) {
    console.error("[pier] startup error screen failed:", renderError);
  }
});
