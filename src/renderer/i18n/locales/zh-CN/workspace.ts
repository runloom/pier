export const workspace = {
  closeFailure: {
    starting: "工作区仍在启动，暂时无法安全保存布局。",
    title: "无法关闭窗口",
    unavailable: "工作区当前不可用，无法安全保存布局。",
  },
  pluginPanel: {
    loadingDescription: "插件仍在加载；准备完成后，此处会显示面板内容。",
    loadingTitle: "正在加载插件面板",
    missingRendererDescription: "该插件没有提供可显示的面板界面。",
    unavailableTitle: "插件面板不可用",
  },
  startupError: {
    description: "请重新加载后再试。",
    retry: "重新加载",
    title: "Pier 启动失败",
  },
  runtimeError: {
    description: "终端会话已保留，请重新加载。",
    retry: "重新加载",
    title: "界面出现错误",
  },
  tab: {
    unsaved: "未保存的更改",
  },
  addPanelMenu: {
    actionFailed: "无法完成操作",
    detectAgentsFailed: "无法探测智能体",
    noMatches: "没有匹配项",
    searchPlaceholder: "搜索面板类型或智能体…",
    title: "在此标签组新建",
    trigger: "在此面板组中新建",
    startAgentFailed: "无法启动智能体",
  },
  panelTransfer: {
    dropFailedTitle: "无法移动该标签",
    dropFailedBody: "该标签无法移动到目标窗口，原标签仍保留在原窗口。",
    dropFailedUnknownComponentBody:
      "该标签无法移动到另一个窗口，原标签仍保留在原窗口。",
    unsupportedTitle: "该标签不能移动到其他窗口",
    unsupportedBody: "这类标签暂不支持跨窗口移动，它仍保留在原窗口中。",
    unavailableSourceTitle: "标签在此窗口已不可用",
    unavailableSourceBody:
      "标签已移动到另一个窗口，但原窗口未能移除它。如有需要，请手动关闭。",
    unavailableTargetTitle: "标签无法恢复",
    unavailableTargetBody:
      "标签已移动到本窗口，但其来源在此窗口不可用。请重新启用相关扩展并重载以恢复。",
  },
} as const;
