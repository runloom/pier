/** 设置 · 通知分区文案（从 settings.ts 拆出，规避单文件行数上限）。 */
export const settingsNotifications = {
  enabled: "需要你处理时通知",
  enabledDesc:
    "智能体在等你确认或继续时，通过本机系统通知提醒（关闭后标题栏计数仍更新）。",
  turnNotifyMode: "回合完成时通知",
  turnNotifyModeDesc: "智能体回合结束后是否提醒。默认仅在窗口未聚焦时。",
  turnNotifyModeOptions: {
    off: "从不",
    unfocused: "仅窗口未聚焦时",
    always: "始终",
  },
  error: "出错时通知",
  errorDesc: "智能体进入错误状态时也发送系统通知。默认关闭。",
  suppress: "专注时抑制",
  suppressDesc:
    "目标智能体面板已聚焦时，不发送「需要你处理」与「出错」类系统通知（回合完成由上方三档单独控制）。",
  cooldownLabel: "同一智能体冷却",
  cooldownDesc: "同一智能体面板两次系统通知之间的最短间隔。",
  cooldown: {
    "60000": "1 分钟",
    "180000": "3 分钟",
    "600000": "10 分钟",
  },
  sendTest: "发送测试通知",
  openSystemSettings: "打开系统设置",
  testSent: "已发送测试通知",
  testFailed: "测试通知失败",
  testFailedShort: "无法展示测试通知",
  testFailedDetail:
    "无法投递系统通知（{{reason}}）。请到「系统设置 → 通知」允许本应用，然后重试。",
  testHint:
    "成功表示已按当前提示音策略交给系统。前台可能看不到横幅，可到通知中心确认。",
  openSettingsFailed: "无法打开系统设置",
  openSettingsManual:
    "请手动打开系统通知设置并为 Pier 开启允许，然后发送测试通知验证。",
  saveFailed: "无法保存通知设置",
  hooksOffTitle: "智能体状态提示已关闭",
  hooksOffBody:
    "关闭后不会发送“需要你处理”的系统通知。已在运行的智能体会话可能仍会上报，重开会话后完全生效。",
  permission: {
    deniedTitle: "系统通知未授权",
    deniedBody: "请在系统设置中为 Pier 开启通知，然后发送测试通知验证。",
    unsupportedTitle: "系统不支持通知",
    unsupportedBody:
      "当前环境无法展示系统通知。请使用标题栏“需要你处理”计数与智能体列表。",
    unknownTitle: "尚未确认通知权限",
    unknownBody: "发送测试通知以检查 Pier 能否投递系统提醒。",
  },
  soundGroup: "提示音",
  soundGroupDesc:
    "系统通知成功展示时播放。标题栏「需要你处理」计数不依赖此项。",
  soundEnabled: "启用提示音",
  soundEnabledDesc:
    "关闭后仍可显示系统通知横幅，但不播放提示音（系统通知将静音）。",
  soundId: "音色",
  soundIdDesc:
    "系统默认跟随操作系统。内置音在应用内播放，不一定遵循系统专注模式对通知音的全部抑制。",
  soundPreview: "试听所选应用音效",
  soundPreviewSystemHint:
    "系统默认音无法在应用内试听，请使用下方「发送测试通知」。",
  soundPreviewFailed: "无法播放提示音",
  sound: {
    system: "系统默认",
    "abstract-sound1": "抽象音 1",
    "abstract-sound2": "抽象音 2",
    "abstract-sound3": "抽象音 3",
    "abstract-sound4": "抽象音 4",
    "cow-mooing": "牛叫",
    "phone-vibration": "手机振动",
    rooster: "公鸡打鸣",
    fahhhhh: "呐喊",
  },
} as const;
