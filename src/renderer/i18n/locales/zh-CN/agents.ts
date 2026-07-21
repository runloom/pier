export const agents = {
  focusEmpty: "没有需要处理的智能体",
  focusFailed: "无法聚焦智能体",
  focusPanelGone: "面板已关闭",
  focusWindowGone: "窗口已关闭",
  indexListFailed: "无法加载智能体列表",
  notificationPermissionDenied: "系统通知未开 — 请用智能体列表或跳转快捷键",
  notificationUnsupported: "系统不支持通知 — 请用智能体列表或跳转快捷键",
  quickPick: {
    empty: "当前没有运行中的智能体",
    emptyDetail: "启动智能体后会显示在这里",
    emptyNew: "启动默认智能体",
    emptyNewDetail: "当前没有运行中的智能体",
    focusNextNeedsYou: "跳到下一个需要你的",
    placeholder: "搜索智能体…",
    thisWindow: "本窗口",
    title: "智能体",
    windowLabel: "窗口 {{id}}",
  },
  section: {
    needsYou: "需要你",
    readyHint: "等待输入（不会通知）",
    running: "运行中",
  },
  titleBar: {
    countsAria: "本机智能体：{{needsYou}} 需要你，{{running}} 运行中",
  },
} as const;
