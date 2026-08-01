import type {
  FileDraftClaimResult,
  FileDraftDiagnostic,
  FileDraftSnapshot,
  FileDraftWriteResult,
} from "@shared/contracts/file.ts";

export type {
  FileDraftClaimResult,
  FileDraftSnapshot,
  FileDraftWriteResult,
} from "@shared/contracts/file.ts";

/**
 * v2 草稿存储的 main 侧核心接口。
 *
 * owner 必须由 main 根据稳定窗口记录身份注入，不能信任 renderer 自报。
 */
export interface FileDraftTransferMapping {
  sourceKey: string;
  targetKey: string;
}

export interface FileDraftTransferInput {
  drafts: readonly FileDraftTransferMapping[];
  sourceOwner: string;
  targetOwner: string;
  transferId: string;
}

export interface FileDraftsService {
  claimLegacy(owner: string, key: string): Promise<FileDraftClaimResult>;
  commitTransfer(input: FileDraftTransferInput): Promise<void>;
  delete(owner: string, key: string): Promise<boolean>;
  flush(): Promise<void>;
  get(owner: string, key: string): Promise<FileDraftSnapshot | null>;
  listDiagnostics(owner: string): Promise<readonly FileDraftDiagnostic[]>;
  listKeys(owner: string): Promise<readonly string[]>;
  rollbackTransfer(input: FileDraftTransferInput): Promise<void>;
  set(
    owner: string,
    key: string,
    generation: number,
    value: string
  ): Promise<FileDraftWriteResult>;
  stageTransfer(input: FileDraftTransferInput): Promise<void>;
}

export interface CreateFileDraftsServiceOptions {
  maxDraftValueBytes?: number;
  maxTotalBytes?: number;
  userDataDir: string;
}
