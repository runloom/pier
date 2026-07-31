/**
 * 插件后台/系统事件落消息中心（kind=plugin.event，source=插件 id）。
 * 仅 options.systemEvent 显式标记时上报；toast 行为不变。
 * builtin（host-context）与 external（external-plugin-context）门面共用。
 */
export function reportPluginSystemEvent(
  pluginId: string,
  severity: "error" | "info" | "success",
  message: string,
  options?: { systemEvent?: boolean }
): void {
  if (!options?.systemEvent) {
    return;
  }
  try {
    window.pier.notificationCenter
      .report({
        kind: "plugin.event",
        severity,
        source: pluginId,
        title: message,
        trigger: "system-event",
      })
      .catch(() => undefined);
  } catch {
    // preload 未就绪时静默（toast 已给出即时反馈）
  }
}
