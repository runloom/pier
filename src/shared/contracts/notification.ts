/** 系统级通知(OS 通知中心),与 renderer 内的 toast 是两条独立通道。 */
export interface SystemNotificationRequest {
  body?: string;
  title: string;
}

export interface SystemNotificationResult {
  /** false 表示当前平台不支持系统通知,调用方可自行降级为应用内提示。 */
  shown: boolean;
}
