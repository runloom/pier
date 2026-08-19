import {
  CANVAS_HOST_FOREGROUND_ACTIVITY_SNAPSHOT,
  canvasHostInspect,
  canvasHostPermissionError,
  canvasHostUnsupportedError,
  isCanvasHostChannelAllowed,
  isCanvasHostCommandAllowed,
  normalizeCanvasHostSnapshotId,
} from "@shared/contracts/canvas-host.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { invokeCanvasPierCommand, subscribeIpc } from "./ipc-envelope.ts";

export interface PierCanvasHostAPI {
  inspect: () => ReturnType<typeof canvasHostInspect>;
  invoke: (command: PierCommand) => Promise<unknown>;
  snapshot: (channel: string) => Promise<unknown>;
  subscribe: (
    channel: string,
    listener: (payload: unknown) => void
  ) => () => void;
}

export const canvasHostApi: PierCanvasHostAPI = {
  inspect: canvasHostInspect,
  invoke: async (command) => {
    if (!isCanvasHostCommandAllowed(command.type)) {
      throw canvasHostPermissionError(`canvas host denies ${command.type}`);
    }
    return invokeCanvasPierCommand(command);
  },
  snapshot: async (channel) => {
    const id = normalizeCanvasHostSnapshotId(channel);
    if (id === "foreground-activity") {
      return ipcRenderer.invoke(CANVAS_HOST_FOREGROUND_ACTIVITY_SNAPSHOT);
    }
    if (id === "resources") {
      return ipcRenderer.invoke(PIER.PIER_RESOURCE_SNAPSHOT);
    }
    if (id === "usage-data") {
      return ipcRenderer.invoke(PIER.USAGE_DATA_SNAPSHOT);
    }
    throw canvasHostUnsupportedError(
      `canvas host has no snapshot for ${channel}`
    );
  },
  subscribe: (channel, listener) => {
    if (!isCanvasHostChannelAllowed(channel)) {
      throw canvasHostPermissionError(`canvas host denies ${channel}`);
    }
    return subscribeIpc(channel, listener);
  },
};
