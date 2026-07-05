import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  FileListRequest,
  FileListResult,
  FileMoveRequest,
  FileMoveResult,
  FileReadTextRequest,
  FileTrashRequest,
  FileTrashResult,
  FileWriteTextRequest,
  FileWriteTextResult,
} from "@shared/contracts/file.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierFilesAPI {
  list: (request: FileListRequest) => Promise<FileListResult>;
  move: (request: FileMoveRequest) => Promise<FileMoveResult>;
  readText: (request: FileReadTextRequest) => Promise<string>;
  trash: (request: FileTrashRequest) => Promise<FileTrashResult>;
  writeText: (request: FileWriteTextRequest) => Promise<FileWriteTextResult>;
}

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
  list: (request) =>
    invokePierCommand<FileListResult>({
      path: request.path,
      root: request.root,
      type: "file.list",
    }),
  readText: (request) =>
    invokePierCommand<string>({
      path: request.path,
      root: request.root,
      type: "file.readText",
    }),
  writeText: (request) =>
    invokePierCommand<FileWriteTextResult>({
      contents: request.contents,
      path: request.path,
      root: request.root,
      type: "file.writeText",
    }),
  move: (request) =>
    invokePierCommand<FileMoveResult>({
      newPath: request.newPath,
      path: request.path,
      root: request.root,
      type: "file.move",
    }),
  trash: (request) =>
    invokePierCommand<FileTrashResult>({
      path: request.path,
      root: request.root,
      type: "file.trash",
    }),
};
