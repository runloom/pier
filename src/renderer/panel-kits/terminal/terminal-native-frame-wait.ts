import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import { readTerminalAnchorFrame } from "./terminal-viewport.ts";

export function waitForRealSize(
  anchor: HTMLDivElement,
  shouldStop: () => boolean
): Promise<CreateTerminalArgs["frame"] | null> {
  const { promise, resolve } = Promise.withResolvers<
    CreateTerminalArgs["frame"] | null
  >();
  const check = () => {
    if (shouldStop()) {
      resolve(null);
      return;
    }
    const frame = readTerminalAnchorFrame(anchor);
    if (frame) {
      resolve(frame);
      return;
    }
    requestAnimationFrame(check);
  };
  check();
  return promise;
}
