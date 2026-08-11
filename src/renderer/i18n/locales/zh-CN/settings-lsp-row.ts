/** 语言服务相关 `settings.row.*` 文案（独立文件控制体积）。 */
export const settingsLspRow = {
  lspHostSectionTitle: "语言服务（宿主）",
  lspHostSectionDesc:
    "控制是否启动语言服务器进程。可选语言（Zig / Java / C++ / C# 等）在「插件」中安装语言包；缺本机工具时打开文件，编辑器状态栏会提示安装命令。上方「编辑器语言功能」只影响 Files 是否使用这些服务。",
  lspEnabled: "运行语言服务器",
  lspEnabledDesc: "关闭后所有项目都不会启动补全与诊断进程，省资源。",
  lspIdleReleaseMinutes: "空闲释放（分钟）",
  lspIdleReleaseMinutesDesc: "多久无编辑后释放进程（1–1440）",
  lspMaxLocalWorkspaces: "本地项目上限",
  lspMaxLocalWorkspacesDesc:
    "同时跑语言服务的本地项目数（0 表示不限制关闭语义）",
  lspMaxRemoteWorkspaces: "远程项目上限",
  lspMaxRemoteWorkspacesDesc: "同时跑语言服务的远程项目数",
  lspUpdateFailed: "无法更新语言服务设置，请重试",
  lspWorktreesEnabled: "在工作树中运行",
  lspWorktreesEnabledDesc: "智能体工作树默认关闭，避免多工作树同时占资源",
  lspAdvancedTitle: "资源与上限",
  lspAdvancedDesc: "一般保持默认即可。",
} as const;
