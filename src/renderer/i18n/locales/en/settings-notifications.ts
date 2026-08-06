/** 设置 · 通知分区文案（从 settings.ts 拆出，规避单文件行数上限）。 */
export const settingsNotifications = {
  enabled: "Notify when an agent needs attention",
  enabledDesc:
    "When an agent waits for you: in-app card if Pier is frontmost, OS notification otherwise. Title-bar counts still update when off.",
  turnNotifyMode: "Notify when a turn completes",
  turnNotifyModeDesc:
    "Alert when a turn finishes. Default: only if that agent’s window is unfocused. In-app and OS alerts never both fire.",
  turnNotifyModeOptions: {
    off: "Never",
    unfocused: "Only when window is unfocused",
    "panel-unfocused": "Only when panel is unfocused",
    always: "Always",
  },
  error: "Notify on agent errors",
  errorDesc: "Also alert when an agent errors. Off by default.",
  cooldownLabel: "Cooldown per agent",
  cooldownDesc:
    "Minimum gap between OS banners for the same agent (in-app cards are not limited).",
  cooldown: {
    "60000": "1 minute",
    "180000": "3 minutes",
    "600000": "10 minutes",
  },
  sendTest: "Send test notification",
  openSystemSettings: "Open system settings",
  testSent: "Test notification sent",
  testFailed: "Test notification failed",
  testFailedShort: "Could not show test notification",
  testFailedDetail:
    "Could not deliver a system notification ({{reason}}). Allow Pier in System Settings → Notifications, then try again.",
  testHint:
    "Success means delivered to the OS. Frontmost banners may be hidden — check Notification Center.",
  openSettingsFailed: "Couldn't open system settings — try again",
  openSettingsManual:
    "Open OS notification settings, allow Pier, then send a test notification.",
  saveFailed: "Couldn't save notification settings — try again",
  hooksOffTitle: "Agent status alerts are off",
  hooksOffBody:
    "Attention alerts stay off until you re-enable them in Settings → Agents.",
  permission: {
    deniedTitle: "System notifications are blocked",
    deniedBody:
      "Allow notifications for Pier in system settings, then send a test notification.",
    unsupportedTitle: "System notifications are unavailable",
    unsupportedBody:
      "OS notifications unavailable here. Use the title-bar attention count or the agent list.",
    unknownTitle: "Notification permission not verified yet",
    unknownBody: "Send a test notification to check OS delivery.",
  },
  soundGroup: "Alert sound",
  soundGroupDesc:
    "Plays when a system notification is shown. Title-bar counts don’t use this sound.",
  soundEnabled: "Enable alert sound",
  soundEnabledDesc:
    "When off, banners can still appear, but no alert sound plays.",
  soundId: "Tone",
  soundIdDesc: "System default follows the OS. Built-in tones play in-app.",
  soundPreview: "Preview selected tone",
  soundPreviewSystemHint:
    "System default can’t be previewed here. Use “Send test notification” below.",
  soundPreviewFailed: "Couldn't play alert sound — try again",
  centerTitle: "Notification Center",
  centerDesc: "Archive of system messages, linked to the switches below.",
  retention: "Keep messages",
  retentionDesc: "Older messages are cleaned up automatically.",
  retentionOptions: {
    "7": "7 days",
    "30": "30 days",
  },
  showBadge: "Show unread count in title bar",
  showBadgeDesc: "When off, the bell hides the unread badge.",
  contentTitle: "What to Alert",
  contentDesc: "Choose which events should alert you.",
  agentGroup: "Agents",
  taskSystemGroup: "System",
  appUpdate: "App update alerts",
  appUpdateDesc:
    "Alert to restart after a download; still recorded in Notification Center when off.",
  deliveryTitle: "How to Alert",
  deliveryDesc: "Control how messages interrupt you.",
  systemGroup: "System Notifications",
  systemGroupDesc:
    "OS alerts only when no Pier window is frontmost; otherwise only the in-app card.",
  disturbGroup: "Interruption Control",
  disturbGroupDesc:
    "Further reduce interruptions on top of the channels above.",
  dnd: "Do Not Disturb",
  dndDesc:
    "Only error in-app cards pop up; the rest go to Notification Center. Toggle from the title-bar bell.",
  sound: {
    system: "System default",
    "abstract-sound1": "Abstract Sound 1",
    "abstract-sound2": "Abstract Sound 2",
    "abstract-sound3": "Abstract Sound 3",
    "abstract-sound4": "Abstract Sound 4",
    "cow-mooing": "Cow Mooing",
    "phone-vibration": "Phone Vibration",
    rooster: "Rooster",
    fahhhhh: "Fahhhhh",
  },
} as const;
