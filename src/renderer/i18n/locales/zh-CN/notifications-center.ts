export const notificationsCenter = {
  action: {
    goToAgent: "前往处理",
    openAgent: "打开对话",
    viewAgentOutput: "查看输出",
  },
  actionFailed: "无法更新消息，请重试",
  bell: {
    aria: "消息，{{count}} 条未读",
    ariaEmpty: "消息",
  },
  dnd: {
    off: "关闭勿扰模式",
    on: "勿扰模式",
  },
  empty: "暂无消息",
  emptyDetail: "系统消息会出现在这里",
  header: {
    markAllRead: "全部已读",
    title: "消息",
    unread: "{{count}} 未读",
  },
  loadMore: "滚动加载更多…",
  repeat: "×{{count}}",
  shellEnv: {
    failedBody: "工具路径可能与终端不一致。请到「设置 → 终端」重新加载。",
    failedTitle: "任务环境可能与终端不同",
    openSettings: "打开终端设置",
  },
  source: {
    pluginDetail: "插件 {{source}}",
    agent: "智能体",
    plugin: "插件",
    system: "系统",
    task: "任务",
  },
} as const;
