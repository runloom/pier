export const agentsLocales = {
  en: {
    permissionMode: {
      yolo: "Skip prompts",
      manual: "Manual",
      mixed: "Mixed",
    },
    defaultPick: {
      auto: "Auto",
      blank: "Blank terminal",
    },
    list: {
      title: "Agent CLIs",
      description: "Supported and detected agent CLIs",
      refresh: "Refresh",
    },
    status: {
      detected: "Detected",
      missing: "Not installed",
      disabled: "Disabled",
    },
    action: {
      enable: "Enable",
      disable: "Disable",
      setDefault: "Set default",
      isDefault: "Default",
      expand: "Details",
      website: "Website",
    },
    row: {
      launchCmd: "Launch command",
      detectCmd: "Detect command",
      expectedProcess: "Process",
      commandOverride: "Command override",
      commandOverrideDesc: "Override the agent binary path",
      args: "Launch args",
      argsDesc: "Args appended to the launch command",
    },
  },
  zhCN: {
    permissionMode: {
      yolo: "跳过权限确认",
      manual: "手动确认权限",
      mixed: "已自定义",
    },
    defaultPick: {
      auto: "自动",
      blank: "空白终端",
    },
    list: {
      title: "智能体列表",
      description: "支持和检测到的 CLI agent",
      refresh: "刷新",
    },
    status: {
      detected: "已检测",
      missing: "未安装",
      disabled: "已停用",
    },
    action: {
      enable: "启用",
      disable: "停用",
      setDefault: "设为默认",
      isDefault: "默认",
      expand: "详情",
      website: "官网",
    },
    row: {
      launchCmd: "启动命令",
      detectCmd: "探测命令",
      expectedProcess: "进程名",
      commandOverride: "命令覆盖",
      commandOverrideDesc: "覆盖 agent 可执行路径",
      args: "启动参数",
      argsDesc: "追加到启动命令的参数",
    },
  },
} as const;
