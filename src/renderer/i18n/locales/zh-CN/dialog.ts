export const dialog = {
  appQuit: {
    activityKind: {
      agent: "智能体",
      shell: "终端",
      task: "任务",
    },
    activityListWithOverflow: "{{activities}}，以及另外 {{count}} 个活动",
    activityName: "{{label}}（{{kind}}）",
    activitySeparator: "、",
    cancel: "取消",
    noActivityDetail: "退出前会保存当前窗口布局。",
    multipleActivityDetail:
      "{{activities}}仍在运行。\n退出 Pier 会终止这些进程。",
    quit: "退出",
    shellFallback: "Shell 命令",
    singleActivityDetail: "{{activity}}仍在运行。\n退出 Pier 会终止该进程。",
    title: "退出 Pier？",
  },
  panelClose: {
    cancel: "取消",
    close: "关闭面板",
    multipleActivityDetail:
      "{{activities}}仍在运行。\n关闭此面板会终止这些进程。",
    singleActivityDetail: "{{activity}}仍在运行。\n关闭此面板会终止该进程。",
    title: "关闭面板？",
  },
  cancel: "取消",
  close: "关闭",
  error: {
    invalid: "输入无效",
  },
  imagePreview: {
    actualSize: "实际大小",
    controlsLabel: "图片控件",
    fit: "适应窗口",
    loadFailedDescription: "无法加载该图片，或打开后文件已发生变化。",
    loadFailedTitle: "无法显示图片",
    loading: "正在加载图片",
    title: "图片预览",
    viewerLabel: "图片预览",
    zoomIn: "放大",
    zoomLevel: "缩放级别",
    zoomOut: "缩小",
  },
  contentPreview: {
    title: "预览",
  },
  ok: "确定",
} as const;
