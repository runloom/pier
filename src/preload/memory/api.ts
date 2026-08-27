import type { AssetRootRef } from "@shared/contracts/agent/assets.ts";
import type {
  MemoryEnableResult,
  MemoryListResult,
  MemoryReport,
  MemoryStatusSnapshot,
} from "@shared/contracts/agent/memory.ts";
import { invokePierCommand } from "../ipc-envelope.ts";

export interface PierMemoryAPI {
  clearStore(root: AssetRootRef): Promise<void>;
  deleteObservation(
    root: AssetRootRef,
    entityName: string,
    index: number,
    observation: string
  ): Promise<void>;
  disable(root: AssetRootRef): Promise<MemoryReport>;
  enable(root: AssetRootRef): Promise<MemoryEnableResult>;
  list(root: AssetRootRef): Promise<MemoryListResult>;
  status(root: AssetRootRef): Promise<MemoryStatusSnapshot>;
}

export const memoryApi: PierMemoryAPI = {
  clearStore: (root) =>
    invokePierCommand({ root, type: "memory.clearStore" }).then(
      () => undefined
    ),
  deleteObservation: (root, entityName, index, observation) =>
    invokePierCommand({
      entityName,
      index,
      observation,
      root,
      type: "memory.deleteObservation",
    }).then(() => undefined),
  disable: (root) =>
    invokePierCommand<MemoryReport>({ root, type: "memory.disable" }),
  enable: (root) =>
    invokePierCommand<MemoryEnableResult>({ root, type: "memory.enable" }),
  list: (root) =>
    invokePierCommand<MemoryListResult>({ root, type: "memory.list" }),
  status: (root) =>
    invokePierCommand<MemoryStatusSnapshot>({ root, type: "memory.status" }),
};
