/**
 * agentStatusHooks 偏好的摄入门闸（与 install/uninstall 同步）。
 * 独立小模块，避免 registry ↔ foreground-activity IPC 循环依赖。
 */
let agentStatusHooksIngestEnabled = true;

export function setAgentStatusHooksIngestEnabled(enabled: boolean): void {
  agentStatusHooksIngestEnabled = enabled;
}

export function isAgentStatusHooksIngestEnabled(): boolean {
  return agentStatusHooksIngestEnabled;
}
