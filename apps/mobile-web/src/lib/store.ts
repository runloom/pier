/**
 * 移动端壳状态（zustand，对齐宿主 renderer stores 惯例）：
 * - snapshot：control.watch 快照整帧替换，不逐字段 merge（规格 §8 快照语义）；
 * - revision：最近一次应用快照的 revision（无快照为 0），供断线续接/展示；
 * - connection：帧客户端连接态镜像。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { create } from "zustand";
import type { MobileConnectionStatus } from "./client-types.ts";

export interface MobileWebState {
  /** 整帧替换：同一对象引用直达，不做 diff/merge。 */
  applySnapshot: (payload: ControlSnapshotPayload) => void;
  connection: MobileConnectionStatus;
  reset: () => void;
  revision: number;
  setConnection: (status: MobileConnectionStatus) => void;
  snapshot: ControlSnapshotPayload | null;
}

export const useMobileWebStore = create<MobileWebState>()((set) => ({
  connection: "idle",
  snapshot: null,
  revision: 0,
  setConnection: (connection) => set({ connection }),
  applySnapshot: (payload) =>
    set({ snapshot: payload, revision: payload.revision }),
  reset: () => set({ connection: "idle", snapshot: null, revision: 0 }),
}));
