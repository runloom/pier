import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  FileConfirmDurabilityRequest,
  FileConfirmDurabilityResult,
  FileCopyRequest,
  FileCopyResult,
  FileDocumentReadResult,
  FileDocumentWriteResult,
  FileDraftClaimResult,
  FileDraftDiagnostic,
  FileDraftSnapshot,
  FileDraftWriteResult,
  FileExistsRequest,
  FileExistsResult,
  FileInspectPathImpactRequest,
  FileInspectWriteTargetRequest,
  FileListRequest,
  FileListResult,
  FileMkdirRequest,
  FileMkdirResult,
  FileMoveRequest,
  FileMoveResult,
  FilePathImpact,
  FileReadDocumentRequest,
  FileReadTextRequest,
  FileRevealRequest,
  FileRevealResult,
  FileStatRequest,
  FileStatResult,
  FileTrashRequest,
  FileTrashResult,
  FileWriteDocumentRequest,
  FileWriteTargetInspection,
  FileWriteTextRequest,
  FileWriteTextResult,
} from "@shared/contracts/file.ts";
import {
  fileConfirmDurabilityResultSchema,
  fileDocumentReadResultSchema,
  fileDocumentWriteResultSchema,
  fileDraftClaimResultSchema,
  fileDraftDiagnosticSchema,
  fileDraftSnapshotSchema,
  fileDraftWriteResultSchema,
  filePathImpactSchema,
  fileWriteTargetInspectionSchema,
} from "@shared/contracts/file.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import {
  fileSaveTargetApi,
  type PierFileSaveTargetAPI,
} from "./file-save-target-api.ts";
import { subscribeFileWatch } from "./file-watch-subscription.ts";

export interface PierFilesAPI extends PierFileSaveTargetAPI {
  confirmDurability: (
    request: FileConfirmDurabilityRequest
  ) => Promise<FileConfirmDurabilityResult>;
  copy: (request: FileCopyRequest) => Promise<FileCopyResult>;
  drafts: {
    claimLegacy: (key: string) => Promise<FileDraftClaimResult>;
    delete: (key: string) => Promise<boolean>;
    get: (key: string) => Promise<FileDraftSnapshot | null>;
    listKeys: () => Promise<readonly string[]>;
    listDiagnostics: () => Promise<readonly FileDraftDiagnostic[]>;
    set: (
      key: string,
      generation: number,
      value: string
    ) => Promise<FileDraftWriteResult>;
  };
  exists: (request: FileExistsRequest) => Promise<FileExistsResult>;
  inspectPathImpact: (
    request: FileInspectPathImpactRequest
  ) => Promise<FilePathImpact>;
  inspectWriteTarget: (
    request: FileInspectWriteTargetRequest
  ) => Promise<FileWriteTargetInspection>;
  list: (request: FileListRequest) => Promise<FileListResult>;
  mkdir: (request: FileMkdirRequest) => Promise<FileMkdirResult>;
  move: (request: FileMoveRequest) => Promise<FileMoveResult>;
  readDocument: (
    request: FileReadDocumentRequest
  ) => Promise<FileDocumentReadResult>;
  /** @deprecated 新代码使用 readDocument。 */
  readText: (request: FileReadTextRequest) => Promise<string>;
  reveal: (request: FileRevealRequest) => Promise<FileRevealResult>;
  stat: (request: FileStatRequest) => Promise<FileStatResult>;
  trash: (request: FileTrashRequest) => Promise<FileTrashResult>;
  watch: (
    root: string,
    listener: (event: FileWatchEvent) => void,
    options?: { excludes?: readonly string[] }
  ) => () => void;
  writeDocument: (
    request: FileWriteDocumentRequest
  ) => Promise<FileDocumentWriteResult>;
  /** @deprecated 新代码使用 writeDocument。 */
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
  ...fileSaveTargetApi,
  confirmDurability: (request) =>
    invokePierCommand<FileConfirmDurabilityResult>({
      expectedRevision: request.expectedRevision,
      path: request.path,
      root: request.root,
      type: "file.confirmDurability",
    }).then((result) => fileConfirmDurabilityResultSchema.parse(result)),
  copy: (request) =>
    invokePierCommand<FileCopyResult>({
      newPath: request.newPath,
      path: request.path,
      root: request.root,
      type: "file.copy",
    }),
  drafts: {
    claimLegacy: (key) =>
      invokePierCommand<FileDraftClaimResult>({
        key,
        type: "file.drafts.claimLegacy",
      }).then((result) => fileDraftClaimResultSchema.parse(result)),
    delete: (key) =>
      invokePierCommand<boolean>({
        key,
        type: "file.drafts.delete",
      }),
    get: (key) =>
      invokePierCommand<FileDraftSnapshot | null>({
        key,
        type: "file.drafts.get",
      }).then((result) =>
        result === null ? null : fileDraftSnapshotSchema.parse(result)
      ),
    listKeys: () =>
      invokePierCommand<readonly string[]>({ type: "file.drafts.listKeys" }),
    listDiagnostics: () =>
      invokePierCommand<readonly FileDraftDiagnostic[]>({
        type: "file.drafts.listDiagnostics",
      }).then((diagnostics) =>
        diagnostics.map((diagnostic) =>
          fileDraftDiagnosticSchema.parse(diagnostic)
        )
      ),
    set: (key, generation, value) =>
      invokePierCommand<FileDraftWriteResult>({
        generation,
        key,
        type: "file.drafts.set",
        value,
      }).then((result) => fileDraftWriteResultSchema.parse(result)),
  },
  exists: (request) =>
    invokePierCommand<FileExistsResult>({
      path: request.path,
      root: request.root,
      type: "file.exists",
    }),
  inspectWriteTarget: (request) =>
    invokePierCommand<FileWriteTargetInspection>({
      path: request.path,
      root: request.root,
      type: "file.inspectWriteTarget",
    }).then((result) => fileWriteTargetInspectionSchema.parse(result)),
  inspectPathImpact: (request) =>
    invokePierCommand<FilePathImpact>({
      path: request.path,
      root: request.root,
      type: "file.inspectPathImpact",
    }).then((result) => filePathImpactSchema.parse(result)),
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
  readDocument: (request) =>
    invokePierCommand<FileDocumentReadResult>({
      path: request.path,
      root: request.root,
      type: "file.readDocument",
    }).then((result) => fileDocumentReadResultSchema.parse(result)),
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
  watch: (root, listener, options) =>
    subscribeFileWatch({
      ...(options?.excludes?.length ? { excludes: [...options.excludes] } : {}),
      ipcRenderer,
      listener,
      root,
    }),
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
  writeDocument: (request) =>
    invokePierCommand<FileDocumentWriteResult>({
      contents: request.contents,
      eol: request.eol,
      expected: request.expected,
      format: request.format,
      ...(request.operationId ? { operationId: request.operationId } : {}),
      path: request.path,
      root: request.root,
      type: "file.writeDocument",
    }).then((result) => fileDocumentWriteResultSchema.parse(result)),
};
