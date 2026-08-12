export interface CommandExecutionContext {
  /**
   * 可选：客户端/连接断开时 abort（CLI socket close → local-control 注入）。
   * 长轮询命令（如 notifications.watch）应观察此信号，避免孤儿 poll。
   */
  abortSignal?: AbortSignal | undefined;
  clientEnv?: Record<string, string> | undefined;
  clientId?: string | undefined;
  navigationGeneration?: number | undefined;
  requestStartedAtMs?: number | undefined;
  runtimeWindowId?: string | undefined;
  webContentsId?: number | undefined;
  windowRecordId?: string | undefined;
}
