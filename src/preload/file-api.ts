import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  FileCopyRequest,
  FileCopyResult,
  FileDraftsListResult,
  FileExistsRequest,
  FileExistsResult,
  FileListRequest,
  FileListResult,
  FileMkdirRequest,
  FileMkdirResult,
  FileMoveRequest,
  FileMoveResult,
  FileReadTextRequest,
  FileRevealRequest,
  FileRevealResult,
  FileStatRequest,
  FileStatResult,
  FileTrashRequest,
  FileTrashResult,
  FileWriteTextRequest,
  FileWriteTextResult,
} from "@shared/contracts/file.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierFilesAPI {
  copy: (request: FileCopyRequest) => Promise<FileCopyResult>;
  drafts: {
    delete: (key: string) => Promise<void>;
    list: () => Promise<FileDraftsListResult>;
    set: (key: string, value: string) => Promise<void>;
  };
  exists: (request: FileExistsRequest) => Promise<FileExistsResult>;
  list: (request: FileListRequest) => Promise<FileListResult>;
  mkdir: (request: FileMkdirRequest) => Promise<FileMkdirResult>;
  move: (request: FileMoveRequest) => Promise<FileMoveResult>;
  readText: (request: FileReadTextRequest) => Promise<string>;
  reveal: (request: FileRevealRequest) => Promise<FileRevealResult>;
  stat: (request: FileStatRequest) => Promise<FileStatResult>;
  trash: (request: FileTrashRequest) => Promise<FileTrashResult>;
  watch: (
    root: string,
    listener: (event: FileWatchEvent) => void,
    options?: { excludes?: readonly string[] }
  ) => () => void;
  writeText: (request: FileWriteTextRequest) => Promise<FileWriteTextResult>;
}

const TRAILING_SLASHES_PATTERN = /\/+$/;

async function invokePierCommand<T>(command: PierCommand): Promise<T> {
  const result = (await ipcRenderer.invoke(
    PIER.COMMAND_EXECUTE,
    command
  )) as PierCommandResult;
  if (result.ok) {
    return result.data as T;
  }
  const error = new Error(result.error.message) as Error & {
    code?: PierCommandErrorCode;
  };
  error.code = result.error.code;
  throw error;
}

export const filesApi: PierFilesAPI = {
  copy: (request) =>
    invokePierCommand<FileCopyResult>({
      newPath: request.newPath,
      path: request.path,
      root: request.root,
      type: "file.copy",
    }),
  drafts: {
    delete: (key) =>
      invokePierCommand<{ ok: true }>({
        key,
        type: "file.drafts.delete",
      }).then(() => undefined),
    list: () =>
      invokePierCommand<FileDraftsListResult>({ type: "file.drafts.list" }),
    set: (key, value) =>
      invokePierCommand<{ ok: true }>({
        key,
        type: "file.drafts.set",
        value,
      }).then(() => undefined),
  },
  exists: (request) =>
    invokePierCommand<FileExistsResult>({
      path: request.path,
      root: request.root,
      type: "file.exists",
    }),
  list: (request) =>
    invokePierCommand<FileListResult>({
      path: request.path,
      root: request.root,
      type: "file.list",
    }),
  mkdir: (request) =>
    invokePierCommand<FileMkdirResult>({
      path: request.path,
      root: request.root,
      type: "file.mkdir",
    }),
  move: (request) =>
    invokePierCommand<FileMoveResult>({
      newPath: request.newPath,
      path: request.path,
      root: request.root,
      type: "file.move",
    }),
  readText: (request) =>
    invokePierCommand<string>({
      path: request.path,
      root: request.root,
      type: "file.readText",
    }),
  reveal: (request) =>
    invokePierCommand<FileRevealResult>({
      path: request.path,
      root: request.root,
      type: "file.reveal",
    }),
  stat: (request) =>
    invokePierCommand<FileStatResult>({
      path: request.path,
      root: request.root,
      type: "file.stat",
    }),
  trash: (request) =>
    invokePierCommand<FileTrashResult>({
      path: request.path,
      root: request.root,
      type: "file.trash",
    }),
  watch: (root, listener, options) => {
    const normalize = (value: string): string =>
      value.replace(TRAILING_SLASHES_PATTERN, "");
    const expectedRoot = normalize(root);
    const handler = (_event: unknown, payload: FileWatchEvent): void => {
      if (normalize(payload.root) === expectedRoot) {
        listener(payload);
      }
    };
    ipcRenderer.on(PIER_BROADCAST.FILE_CHANGED, handler);
    const started = ipcRenderer
      .invoke(
        PIER.FILE_WATCH_START,
        options?.excludes?.length
          ? { excludes: [...options.excludes], root }
          : root
      )
      .then((ok: unknown) => ok === true)
      .catch(() => false);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.FILE_CHANGED, handler);
      started
        .then((ok) =>
          ok ? ipcRenderer.invoke(PIER.FILE_WATCH_STOP, root) : undefined
        )
        .catch(() => undefined);
    };
  },
  writeText: (request) =>
    invokePierCommand<FileWriteTextResult>({
      contents: request.contents,
      ...(request.expectedMtimeMs == null
        ? {}
        : { expectedMtimeMs: request.expectedMtimeMs }),
      path: request.path,
      root: request.root,
      type: "file.writeText",
    }),
};
