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
    displayPrimary,
    effectiveContext,
    effectiveCwd,
    effectiveTab,
    sessionLoaded,
    terminalTitle,
  } = input;
  const descriptor = useMemo(
    () =>
      terminalPanelDescriptor({
        ...(displayPrimary == null ? {} : { displayPrimary }),
        effectiveContext,
        effectiveCwd,
        effectiveTab,
        sessionLoaded,
        ...(terminalTitle == null ? {} : { terminalTitle }),
      }),
    [
      displayPrimary,
      effectiveContext,
      effectiveCwd,
      effectiveTab,
      sessionLoaded,
      terminalTitle,
    ]
  );
  usePanelDescriptor(api, descriptor);
}
