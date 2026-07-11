import type { IDockviewPanelProps } from "dockview-react";
import { useMemo } from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { terminalPanelDescriptor } from "./terminal-tab-chrome.ts";

type TerminalPanelDescriptorInput = Parameters<
  typeof terminalPanelDescriptor
>[0];

export function useTerminalPanelDescriptor(
  api: IDockviewPanelProps["api"],
  input: TerminalPanelDescriptorInput
): void {
  const {
    effectiveContext,
    effectiveCwd,
    effectiveTab,
    effectiveTitle,
    sessionLoaded,
  } = input;
  const descriptor = useMemo(
    () =>
      terminalPanelDescriptor({
        effectiveContext,
        effectiveCwd,
        effectiveTab,
        effectiveTitle,
        sessionLoaded,
      }),
    [
      effectiveContext,
      effectiveCwd,
      effectiveTab,
      effectiveTitle,
      sessionLoaded,
    ]
  );
  usePanelDescriptor(api, descriptor);
}
