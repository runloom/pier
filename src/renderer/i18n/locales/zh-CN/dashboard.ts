export const dashboard = {
  addWidget: "添加组件",
  empty: "大盘还是空的",
  emptyDescription: "添加组件以监控活动和管理工作区。",
  panelTitle: "大盘",
  panelTitleShort: "大盘",
  picker: {
    coreSection: "核心",
    pluginSection: "插件",
  },
  widget: {
    activityOverview: {
      description: "实时面板与会话指标",
      empty: "无活跃面板",
      emptyHint: "打开终端或代码面板后会在这里出现",
      kind: {
        agent: "智能体",
        idle: "空闲",
        shell: "终端",
        task: "任务",
      },
      running: "运行中",
      title: "活动总览",
      total: "总计",
      waiting: "等待中",
    },
    loading: "加载中…",
    pluginDisabled: "所属插件已禁用",
    remove: "移除",
    unknown: "组件不可用（插件已卸载）",
  },
} as const;
