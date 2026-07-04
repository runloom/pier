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
    },
    manage: "管理状态栏…",
  },
} as const;
