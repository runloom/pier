import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import { AppShell } from "@/components/common/app-shell.tsx";
import {
  registerTerminalElementWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing.store.ts";

const terminalOverlayRegistry = {
  registerElement: registerTerminalElementWebOverlay,
  requestFocus: requestTerminalWebFocus,
};

export function App() {
  return (
    <TerminalOverlayContext.Provider value={terminalOverlayRegistry}>
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <AppShell />
      </TooltipProvider>
    </TerminalOverlayContext.Provider>
  );
}
