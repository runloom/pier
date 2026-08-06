/** Shell 环境 Terminal 设置卡（从 settings.ts 拆出，规避单文件行数上限）。 */
export const settingsShellEnvironment = {
  title: "Shell 环境",
  description:
    "Pier 会加载你的登录 shell，使任务与智能体找到的命令与终端一致。",
  windowsNote: "Windows 上不加载登录 shell，命令来自当前进程环境。",
  statusLabel: "状态：",
  status: {
    resolved: "已与终端对齐",
    failed: "使用基础环境",
    skipped: "已跳过",
    unknown: "尚不可用",
  },
  skipReason: {
    cli: "已从终端启动，沿用当前环境",
    disabled: "已关闭从登录 shell 读取环境",
    "no-shell": "未检测到可用 shell",
    windows: "Windows 不解析登录 shell",
  },
  refresh: "重新加载",
  refreshing: "加载中…",
  disabled: "不从登录 shell 读取环境",
  disabledDesc: "开启后跳过登录 shell。任务可能找不到 Node 等命令。",
  timeout: "加载超时（秒）",
  timeoutDesc: "等待登录 shell 完成的最长时间（1–120）。",
  statusFailed: "暂时无法读取状态，请重试",
  refreshFailed: "重新加载未完成，仍用当前环境",
  updateFailed: "无法更新设置，请重试",
} as const;
