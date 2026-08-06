/**
 * 把 renderer 任务诊断桥到 main diagnostics JSONL（与 task.spawn 同一文件）。
 */
export function reportTaskRuntimeDiagnostic(
  scope: string,
  msg: string,
  ctx?: Record<string, unknown>
): void {
  try {
    window.pier.tasks.reportDiagnostic({
      scope,
      msg,
      ...(ctx ? { ctx } : {}),
    });
  } catch {
    // Preload 未就绪时忽略
  }
}
