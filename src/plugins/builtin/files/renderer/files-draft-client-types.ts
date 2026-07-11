import type {
  FileDraftClaimResult,
  FileDraftDiagnostic,
  FileDraftSnapshot,
  FileDraftWriteResult,
} from "@shared/contracts/file.ts";

export type FilesDraftProtectionState =
  | { generation: number; status: "protecting" }
  | { generation: number; status: "protected"; updatedAt: number }
  | { generation: number; message: string; status: "failed" }
  | { status: "idle" };

export interface FilesDraftBackend {
  claimLegacy(key: string): Promise<FileDraftClaimResult>;
  delete(key: string): Promise<boolean>;
  get(key: string): Promise<FileDraftSnapshot | null>;
  listDiagnostics?(): Promise<readonly FileDraftDiagnostic[]>;
  listKeys(): Promise<readonly string[]>;
  set(
    key: string,
    generation: number,
    value: string
  ): Promise<FileDraftWriteResult>;
}
