export const terminal = {
  agentStatus: {
    error: "错误",
    processing: "思考中",
    ready: "等待输入",
    subagentCount: "{{count}} 个子代理",
    subagentCount_one: "{{count}} 个子代理",
    subagentCount_other: "{{count}} 个子代理",
    tool: "执行工具中",
    waiting: "等待确认",
  },
  taskStatus: {
    failed: "{{count}} 个任务失败",
    failed_one: "{{count}} 个任务失败",
    failed_other: "{{count}} 个任务失败",
    idle: "任务",
    inputsUnsupported: "此任务需要输入，状态栏任务面板暂不支持交互式输入",
    loading: "正在加载任务...",
    loadFailed: "任务加载失败",
    noTasks: "未发现可运行任务",
    openInNewTab: "新标签打开",
    rerunInBackground: "后台重新运行",
    running: "{{count}} 个任务运行中",
    running_one: "{{count}} 个任务运行中",
    running_other: "{{count}} 个任务运行中",
    startFailed: "任务启动失败",
    unsupported: "任务不支持",
  },
  search: {
    close: "关闭查找",
    label: "在终端中查找",
    matchCount: "{{index}} / {{total}}",
    next: "下一个匹配",
    noMatches: "无匹配",
    placeholder: "查找",
    previous: "上一个匹配",
  },
  statusBar: {
    item: {
      agentStatus: {
        title: "Agent 状态",
      },
      taskStatus: {
        title: "任务列表",
      },
    },
    manage: "管理状态栏…",
  },
} as const;
