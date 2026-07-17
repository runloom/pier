/**
 * Preload facade for main-process file path query.
 *
 * Renderer surface:
 *   - `window.pier.fileQuery.start(request) → Promise<boolean>`
 *   - `window.pier.fileQuery.cancel(queryId) → Promise<boolean>`
 *   - `window.pier.fileQuery.onEvent(listener) → unsubscribe()`
 *
 * A single `ipcRenderer.on(FILE_QUERY_EVENT)` hub multiplexes to the local
 * listener set — one listener per document is enough; higher-level fanout
 * (per queryId) is a renderer concern.
 */
import type {
  FilePathQueryStart,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcRendererEvent, ipcRenderer } from "electron";

export interface PierFileQueryAPI {
  cancel(queryId: string): Promise<boolean>;
  onEvent(listener: (event: FileQueryEvent) => void): () => void;
  start(request: FilePathQueryStart): Promise<boolean>;
}

const listeners = new Set<(event: FileQueryEvent) => void>();

ipcRenderer.on(
  PIER.FILE_QUERY_EVENT,
  (_ipcEvent: IpcRendererEvent, payload: FileQueryEvent) => {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Listener bugs must not tear the multiplexer down; every other
        // subscriber (and future events) MUST still be delivered.
      }
    }
  }
);

export const fileQueryApi: PierFileQueryAPI = {
  cancel: async (queryId) => {
    try {
      return (
        (await ipcRenderer.invoke(PIER.FILE_QUERY_CANCEL, { queryId })) === true
      );
    } catch {
      return false;
    }
  },
  onEvent: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  start: async (request) => {
    try {
      return (
        (await ipcRenderer.invoke(PIER.FILE_QUERY_START, request)) === true
      );
    } catch {
      return false;
    }
  },
};
