/** 設定 · 通知（settings.ts から分割）。 */
export const settingsNotifications = {
  enabled: "エージェントが対応を待つときに通知",
  enabledDesc:
    "エージェントがあなたを待つとき：Pier が最前面ならアプリ内カード、そうでなければ OS 通知。オフでもタイトルバーの件数は更新されます。",
  turnNotifyMode: "ターン完了時に通知",
  turnNotifyModeDesc:
    "ターンが終わったときに知らせます。既定：そのエージェントのウインドウが非前面のときだけ。アプリ内と OS は同時には出しません。",
  turnNotifyModeOptions: {
    off: "しない",
    unfocused: "ウインドウが非前面のときだけ",
    "panel-unfocused": "パネルが非前面のときだけ",
    always: "常に",
  },
  error: "エージェントのエラーを通知",
  errorDesc: "エージェントがエラーになったときも知らせます。既定はオフです。",
  cooldownLabel: "エージェントごとの間隔",
  cooldownDesc:
    "同じエージェントの OS バナーの最短間隔（アプリ内カードは制限しません）。",
  cooldown: {
    "60000": "1 分",
    "180000": "3 分",
    "600000": "10 分",
  },
  sendTest: "テスト通知を送る",
  openSystemSettings: "システム設定を開く",
  testSent: "テスト通知を送りました",
  testFailed: "テスト通知に失敗しました",
  testFailedShort: "テスト通知を表示できませんでした",
  testFailedDetail:
    "システム通知を届けられませんでした（{{reason}}）。システム設定 → 通知で Pier を許可してから、もう一度お試しください。",
  testHint:
    "成功は OS に届いたことを意味します。最前面のバナーは隠れることがあります。通知センターを確認してください。",
  openSettingsFailed: "システム設定を開けませんでした。もう一度お試しください",
  openSettingsManual:
    "OS の通知設定を開き、Pier を許可してからテスト通知を送ってください。",
  saveFailed: "通知設定を保存できませんでした。もう一度お試しください",
  hooksOffTitle: "エージェント状態の通知はオフです",
  hooksOffBody:
    "設定 → エージェントで再び有効にするまで、対応の通知は出ません。",
  permission: {
    deniedTitle: "システム通知がブロックされています",
    deniedBody:
      "システム設定で Pier の通知を許可してから、テスト通知を送ってください。",
    unsupportedTitle: "システム通知を使えません",
    unsupportedBody:
      "ここでは OS 通知を使えません。タイトルバーの件数かエージェント一覧を見てください。",
    unknownTitle: "通知の許可はまだ確認していません",
    unknownBody: "テスト通知を送って OS への到達を確認してください。",
  },
  soundGroup: "通知音",
  soundGroupDesc:
    "エージェントの通知が出たときに再生します。メッセージセンターにだけ残すときは無音です。",
  soundEnabled: "通知音を再生",
  soundEnabledDesc: "オフでも通知は出ます。音だけ止まります。",
  soundId: "音色",
  soundIdDesc: "システムの通知音か、Pier 内蔵の音色を使います。",
  soundPreview: "選んだ音色を試聴",
  soundPreviewSystemHint:
    "システムの音色はここでは試聴できません。別のアプリに切り替えてから、下の「テスト通知を送る」を使ってください。",
  soundPreviewFailed: "通知音を再生できませんでした。もう一度お試しください",
  centerTitle: "通知センター",
  centerDesc: "システムメッセージの記録。下のスイッチと連動します。",
  retention: "メッセージの保持",
  retentionDesc: "古いメッセージは自動で整理されます。",
  retentionOptions: {
    "7": "7 日",
    "30": "30 日",
  },
  showBadge: "タイトルバーに未読数を表示",
  showBadgeDesc: "オフにするとベルの未読バッジが隠れます。",
  contentTitle: "何を知らせるか",
  contentDesc: "知らせる出来事を選びます。",
  agentGroup: "エージェント",
  taskSystemGroup: "システム",
  appUpdate: "アプリ更新の通知",
  appUpdateDesc:
    "ダウンロード後の再起動を知らせます。オフでも通知センターには残ります。",
  deliveryTitle: "どう知らせるか",
  deliveryDesc: "割り込みの仕方を制御します。",
  systemGroup: "システム通知",
  systemGroupDesc:
    "Pier のウインドウが最前面でないときだけ OS 通知。それ以外はアプリ内カードだけです。",
  disturbGroup: "割り込みの抑制",
  disturbGroupDesc: "上の経路に加えて、さらに割り込みを減らします。",
  dnd: "集中モード",
  dndDesc:
    "エラーのアプリ内カードだけ出します。ほかは通知センターへ。タイトルバーのベルから切り替えられます。",
  sound: {
    system: "システムの既定",
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
