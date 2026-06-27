import { AppShell } from "@/components/common/app-shell.tsx";
import { TooltipProvider } from "@/components/primitives/tooltip.tsx";

export function App() {
  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <AppShell />
    </TooltipProvider>
  );
}
