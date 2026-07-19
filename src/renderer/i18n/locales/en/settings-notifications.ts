/** 设置 · 通知分区文案（从 settings.ts 拆出，规避单文件行数上限）。 */
export const settingsNotifications = {
  enabled: "Notify when an agent needs you",
  enabledDesc:
    "Deliver OS notifications when an agent is waiting for confirmation or for you to continue (title bar counts still update when off).",
  turnNotifyMode: "Notify when a turn completes",
  turnNotifyModeDesc:
    "Whether to notify after an agent finishes a turn. Default is only when the window is unfocused.",
  turnNotifyModeOptions: {
    off: "Never",
    unfocused: "Only when window is unfocused",
    always: "Always",
  },
  error: "Notify on agent errors",
  errorDesc: "Also notify when an agent enters an error state. Off by default.",
  suppress: "Suppress when focused",
  suppressDesc:
    "Skip “Needs you” and error OS notifications when the target agent panel is already focused (turn-complete uses the three modes above).",
  cooldownLabel: "Cooldown per agent",
  cooldownDesc:
    "Minimum time between OS notifications for the same agent panel.",
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
    "Could not deliver a system notification ({{reason}}). Allow this app in System Settings → Notifications, then try again.",
  testHint:
    "Success means delivered to the OS with the current alert-sound policy. Frontmost banners may be hidden — check Notification Center.",
  openSettingsFailed: "Could not open system settings",
  openSettingsManual:
    "Open your OS notification settings manually and allow Pier, then send a test notification.",
  saveFailed: "Could not save notification settings",
  hooksOffTitle: "Agent status alerts are off",
  hooksOffBody:
    "“Needs you” system notifications will not appear until agent status alerts are enabled. Running agent sessions may still report until reopened.",
  permission: {
    deniedTitle: "System notifications are blocked",
    deniedBody:
      "Allow notifications for Pier in system settings, then send a test notification to verify.",
    unsupportedTitle: "System notifications are unavailable",
    unsupportedBody:
      "This environment cannot show OS notifications. Use the title bar “Needs you” count and the agent list instead.",
    unknownTitle: "Notification permission not verified yet",
    unknownBody:
      "Send a test notification to check whether Pier can deliver OS alerts.",
  },
  soundGroup: "Alert sound",
  soundGroupDesc:
    "Plays when an OS notification is successfully shown. The title bar “Needs you” count does not depend on this.",
  soundEnabled: "Enable alert sound",
  soundEnabledDesc:
    "When off, system notification banners can still appear, but no alert sound plays (OS notifications are silent).",
  soundId: "Tone",
  soundIdDesc:
    "System default follows the OS. Built-in tones play in-app and may not honor every Focus/Do Not Disturb rule that applies to notification sounds.",
  soundPreview: "Preview selected app tone",
  soundPreviewSystemHint:
    "System default sound cannot be previewed in-app. Use “Send test notification” below.",
  soundPreviewFailed: "Could not play alert sound",
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
