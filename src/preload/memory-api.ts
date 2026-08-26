import type { AssetRootRef } from "@shared/contracts/agent/assets.ts";
import type {
  MemoryEnableResult,
  MemoryReport,
  MemoryStatusSnapshot,
} from "@shared/contracts/memory.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierMemoryAPI {
  disable(root: AssetRootRef): Promise<MemoryReport>;
  enable(
    root: AssetRootRef,
    options?: { acknowledged?: boolean }
  ): Promise<MemoryEnableResult>;
  status(root: AssetRootRef): Promise<MemoryStatusSnapshot>;
}

export const memoryApi: PierMemoryAPI = {
  disable: (root) =>
    invokePierCommand<MemoryReport>({ root, type: "memory.disable" }),
  enable: (root, options) =>
    invokePierCommand<MemoryEnableResult>({
      ...(options?.acknowledged ? { acknowledged: true } : {}),
      root,
      type: "memory.enable",
    }),
  status: (root) =>
    invokePierCommand<MemoryStatusSnapshot>({ root, type: "memory.status" }),
};
