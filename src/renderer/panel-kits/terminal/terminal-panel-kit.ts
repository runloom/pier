import { SquareTerminal } from "lucide-react";
import { TerminalPanel } from "./terminal-panel.tsx";

export const terminalPanelKit = {
  component: TerminalPanel,
  icon: SquareTerminal,
  kind: "terminal",
} as const;
