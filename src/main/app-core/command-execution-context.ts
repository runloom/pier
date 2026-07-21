export interface CommandExecutionContext {
  clientEnv?: Record<string, string> | undefined;
  clientId?: string | undefined;
  navigationGeneration?: number | undefined;
  requestStartedAtMs?: number | undefined;
  runtimeWindowId?: string | undefined;
  webContentsId?: number | undefined;
  windowRecordId?: string | undefined;
}
