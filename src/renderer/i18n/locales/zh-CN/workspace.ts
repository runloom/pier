export const workspace = {
  closeFailure: {
    starting: "工作区仍在启动，暂时无法安全保存布局。",
    title: "无法关闭窗口",
    unavailable: "工作区当前不可用，无法安全保存布局。",
  },
  pluginPanel: {
    loadingDescription: "插件仍在加载；准备完成后，此处会显示面板内容。",
    loadingTitle: "正在加载插件面板",
    missingRendererDescription: "该插件没有为此面板提供 renderer 组件。",
    unavailableTitle: "插件面板不可用",
  },
  startupError: {
    description:
      "Pier 无法完成核心初始化。请重试；如果问题持续存在，请保留下面的错误详情。",
    details: "错误详情",
    retry: "重新加载",
    title: "Pier 启动失败",
  },
  tab: {
    unsaved: "未保存的更改",
  },
  addPanelMenu: {
    trigger: "添加面板",
    newMissionControl: "新建指挥中心",
    newTerminal: "新终端",
    newTask: "新任务",
    newWorktree: "新建工作树",
    agentSection: "智能体",
    noAgentDetected: "未检测到可用智能体",
  },
} as const;
