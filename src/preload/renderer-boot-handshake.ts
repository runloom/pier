import { PIER } from "@shared/ipc-channels.ts";
import type { IpcRenderer } from "electron";

export function installRendererBootHandshake(
  ipcRenderer: Pick<IpcRenderer, "on" | "send">
): () => void {
  let challenge: string | null = null;
  let mounted = false;
  const acknowledge = () => {
    if (!(mounted && challenge)) return;
    ipcRenderer.send(PIER.WINDOW_RENDERER_READY, challenge);
    challenge = null;
  };
  ipcRenderer.on(
    PIER.WINDOW_RENDERER_BOOT_CHALLENGE,
    (_event, candidate: unknown) => {
      if (typeof candidate !== "string" || candidate.length === 0) return;
      challenge = candidate;
      acknowledge();
    }
  );
  return () => {
    if (mounted) return;
    mounted = true;
    ipcRenderer.send(PIER.WINDOW_RENDERER_BOOT_REQUEST);
    acknowledge();
  };
}
