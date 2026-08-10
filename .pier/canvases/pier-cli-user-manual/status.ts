export type CmdStatus = "shipped" | "planned" | "blocked" | string;

export function statusLabel(status: CmdStatus): string {
  if (status === "shipped") {
    return "已实现";
  }
  if (status === "planned") {
    return "暂未实现";
  }
  if (status === "blocked") {
    return "CLI 默认不可用";
  }
  return status;
}

export function statusVariant(
  status: CmdStatus
): "success" | "warning" | "destructive" | "outline" | "info" {
  if (status === "shipped") {
    return "success";
  }
  if (status === "planned") {
    return "warning";
  }
  if (status === "blocked") {
    return "destructive";
  }
  return "outline";
}
