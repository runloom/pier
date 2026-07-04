import {
  type TaskPanelMetadata,
  taskPanelMetadataSchema,
} from "@shared/contracts/tasks.ts";

/**
 * 从 dockview panel params 解析任务面板元数据。
 *
 * 任务面板 = 携带合法 `params.task` 的 terminal 面板 (addTerminal 时写入,
 * dockview 布局持久化会原样带回)。panel 复用重跑只改 relaunch store,
 * 不回写 params — taskId / projectRootPath 恒定, 作为"这是任务面板"的判据可靠。
 */
export function taskPanelMetadataFromParams(
  params: unknown
): TaskPanelMetadata | undefined {
  if (!params || typeof params !== "object" || !("task" in params)) {
    return;
  }
  const parsed = taskPanelMetadataSchema.safeParse(params.task);
  return parsed.success ? parsed.data : undefined;
}
