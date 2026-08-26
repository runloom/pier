/**
 * Test-only `pier/host` module.
 *
 * In the app this specifier is a compile-time stub that reads
 * `__PIER_LIVE_HOST__`. Component tests alias it here so canvases can mount
 * without IPC. Types match `sdk/host.d.ts` / the canvas allowlist.
 */
import {
  type CanvasHost,
  type CanvasHostCommand,
  type CanvasHostWatchTarget,
  canvasHostInspect,
} from "@shared/contracts/canvas-host.ts";
import { decorateCanvasHostInspect } from "@/lib/canvas-host/inspect.ts";

export type {
  CanvasHost,
  CanvasHostChannel,
  CanvasHostCommand,
  CanvasHostCommandType,
  CanvasHostInspect,
  CanvasHostInspectCommand,
  CanvasHostInspectDomain,
  CanvasHostSnapshotId,
  CanvasHostWatchTarget,
} from "@shared/contracts/canvas-host.ts";

export interface HostSnapshotState {
  data: unknown;
  error: string | null;
  status: "error" | "loading" | "ready";
}

export const host: CanvasHost = {
  inspect: () => decorateCanvasHostInspect(canvasHostInspect()),
  invoke(_command: CanvasHostCommand): Promise<unknown> {
    return Promise.reject(new Error("Canvas host is unavailable"));
  },
  snapshot(_id) {
    return Promise.resolve(null);
  },
  subscribe(_channel, _listener) {
    return () => undefined;
  },
};

export function useHostSnapshot(
  _target: CanvasHostWatchTarget | (string & {})
): HostSnapshotState {
  return { data: null, error: null, status: "ready" };
}
