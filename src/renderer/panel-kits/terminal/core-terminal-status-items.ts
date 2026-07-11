import type { CoreTerminalStatusItemDeclaration } from "@shared/contracts/terminal-status-bar.ts";
import {
  CORE_AGENT_STATUS_ITEM_ID,
  CORE_TASK_STATUS_ITEM_ID,
} from "@shared/plugin-core-contribution-ids.ts";

export {
  CORE_AGENT_STATUS_ITEM_ID,
  CORE_TASK_STATUS_ITEM_ID,
} from "@shared/plugin-core-contribution-ids.ts";

/**
 * Core-owned 状态栏项声明。环境不占用终端状态栏；未来任何非插件贡献的核心项
 * 都加到这里,由合并层 / 右键菜单 / 设置页三处数据源统一遍历。
 */
export const CORE_TERMINAL_STATUS_ITEMS: readonly CoreTerminalStatusItemDeclaration[] =
  [
    {
      id: CORE_AGENT_STATUS_ITEM_ID,
      order: -10,
      titleKey: "terminal.statusBar.item.agentStatus.title",
    },
    {
      id: CORE_TASK_STATUS_ITEM_ID,
      order: -9,
      titleKey: "terminal.statusBar.item.taskStatus.title",
    },
  ];
