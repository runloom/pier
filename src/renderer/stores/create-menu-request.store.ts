/**
 * 命令 pier.panel.openCreateMenu (默认 Cmd+N) 与 AddPanelAction 弹层之间的
 * 桥梁: 命令派发时把 targetGroupId 写进 store, 各 group 上挂的 AddPanelAction
 * 收到自己的 group id 匹配时打开本地 Popover。
 *
 * requestId 单调递增, 保证同一个 group 被连续请求打开时也能被识别为"新一轮";
 * 消费方调用 markConsumed 把状态清空, 避免其它 group 上的 AddPanelAction 误命中。
 */
import { create } from "zustand";

interface CreateMenuRequestState {
  markConsumed: (requestId: number) => void;
  requestId: number;
  requestOpen: (groupId: string) => void;
  targetGroupId: string | null;
}

export const useCreateMenuRequestStore = create<CreateMenuRequestState>(
  (set) => ({
    markConsumed: (requestId) => {
      set((state) =>
        state.requestId === requestId ? { targetGroupId: null } : {}
      );
    },
    requestId: 0,
    requestOpen: (groupId) => {
      set((state) => ({
        requestId: state.requestId + 1,
        targetGroupId: groupId,
      }));
    },
    targetGroupId: null,
  })
);
