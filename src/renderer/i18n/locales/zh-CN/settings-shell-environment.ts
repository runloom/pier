/** Shell 环境 Terminal 设置卡（从 settings.ts 拆出，规避单文件行数上限）。 */
export const settingsShellEnvironment = {
  title: "Shell 环境",
  description:
    "Pier 会加载你的登录 shell 环境，使任务与智能体使用的 Node 和 PATH 与终端一致。",
  windowsNote: "Windows 上不会解析登录 shell 环境，PATH 来自进程环境。",
  statusLabel: "状态：",
  status: {
    resolved: "已加载",
    failed: "加载失败",
    skipped: "已跳过",
    unknown: "尚不可用",
  },
  shellLabel: "Shell：{{shell}}",
  refresh: "重新加载 shell 环境",
  refreshing: "加载中…",
  disabled: "禁用 shell 环境加载",
  disabledDesc:
    "开启后，Pier 不会通过 shell 加载 PATH 与工具链。任务可能找不到 nvm 或 Homebrew 安装的 Node 等工具。",
  timeout: "加载超时（秒）",
  timeoutDesc: "等待 shell 启动完成的最长时间（1–120）。",
  statusFailed: "无法加载 shell 环境状态",
  refreshFailed: "无法重新加载 shell 环境",
  updateFailed: "无法更新 shell 环境设置",
} as const;
