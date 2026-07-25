export const notificationsCenter = {
  action: {
    goToAgent: "前往处理",
  },
  actionFailed: "无法更新消息",
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
  source: {
    pluginDetail: "插件 {{source}}",
    agent: "智能体",
    plugin: "插件",
    system: "系统",
    task: "任务",
  },
} as const;
