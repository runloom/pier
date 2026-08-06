export const agents = {
  focusEmpty: "没有需要处理的智能体",
  focusFailed: "无法聚焦智能体，请重试",
  focusPanelGone: "面板已关闭",
  focusWindowGone: "窗口已关闭",
  indexListFailed: "无法加载智能体列表，请重试",
  notificationPermissionDenied: "系统通知未开",
  notificationPermissionDeniedDetail:
    "收不到智能体提醒。请在列表中查看，或到系统设置开启通知",
  notificationUnsupported: "系统不支持通知",
  notificationUnsupportedDetail: "收不到系统提醒。请在智能体列表中查看状态",
  quickPick: {
    empty: "当前没有运行中的智能体",
    emptyDetail: "启动智能体后会显示在这里",
    emptyNew: "启动默认智能体",
    emptyNewDetail: "当前没有运行中的智能体",
    focusNextNeedsYou: "跳到下一个需要你处理的",
    placeholder: "搜索智能体…",
    thisWindow: "本窗口",
    title: "智能体",
    windowLabel: "窗口 {{id}}",
  },
  section: {
    needsYou: "需要你处理",
    readyHint: "等待输入",
    running: "运行中",
  },
  titleBar: {
    countsAria: "本机智能体：{{needsYou}} 需要你处理，{{running}} 运行中",
  },
} as const;
