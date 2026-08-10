export type StatusTone = "info" | "outline" | "success" | "warning";

type StatusPresentation = {
  label: string;
  tone: StatusTone;
};

const STATUS_PRESENTATIONS: Record<string, StatusPresentation> = {
  attention: { label: "需要你处理", tone: "warning" },
  blocked: { label: "已阻塞", tone: "warning" },
  error: { label: "出错", tone: "warning" },
  gone: { label: "现场不可见", tone: "outline" },
  interactive: { label: "可继续交互", tone: "info" },
  planned: { label: "待实现", tone: "warning" },
  running: { label: "运行中", tone: "info" },
  starting: { label: "启动中", tone: "info" },
  stopped: { label: "进程已退出", tone: "outline" },
  unknown: { label: "状态未知", tone: "warning" },
  verified: { label: "已核对", tone: "success" },
  waiting_input: { label: "等待输入", tone: "warning" },
  已核对: { label: "已核对", tone: "success" },
  已验证: { label: "已验证", tone: "success" },
  已阻塞: { label: "已阻塞", tone: "warning" },
  三项调研已核对: { label: "三项调研已核对", tone: "success" },
  三项调研待核对: { label: "三项调研待核对", tone: "warning" },
  推荐方案: { label: "推荐方案", tone: "info" },
  待开始: { label: "待开始", tone: "outline" },
  待实现: { label: "待实现", tone: "warning" },
  执行中: { label: "执行中", tone: "info" },
  方案草案: { label: "方案草案", tone: "warning" },
  需要你处理: { label: "需要你处理", tone: "warning" },
};

export function presentStatus(status: string): StatusPresentation {
  return STATUS_PRESENTATIONS[status] ?? { label: "状态未知", tone: "warning" };
}
