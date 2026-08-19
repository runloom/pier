export const dialog = {
  appQuit: {
    activityKind: {
      agent: "エージェント",
      shell: "ターミナル",
      task: "タスク",
    },
    activityListWithOverflow: "{{activities}}、ほか {{count}} 件",
    activityName: "{{label}}（{{kind}}）",
    activitySeparator: "、",
    cancel: "キャンセル",
    noActivityDetail: "終了前にウインドウの配置を保存します。",
    multipleActivityDetail:
      "{{activities}} がまだ実行中です。\n終了すると止まります。",
    quit: "終了",
    shellFallback: "ターミナルのコマンド",
    singleActivityDetail:
      "{{activity}} がまだ実行中です。\n終了すると止まります。",
    title: "Pier を終了しますか？",
  },
  panelClose: {
    cancel: "キャンセル",
    close: "パネルを閉じる",
    multipleActivityDetail:
      "{{activities}} がまだ実行中です。\nこのパネルを閉じると止まります。",
    singleActivityDetail:
      "{{activity}} がまだ実行中です。\nこのパネルを閉じると止まります。",
    title: "パネルを閉じますか？",
  },
  cancel: "キャンセル",
  close: "閉じる",
  error: {
    invalid: "入力が正しくありません",
  },
  imagePreview: {
    actualSize: "実際のサイズ",
    controlsLabel: "画像操作",
    fit: "ウインドウに合わせる",
    loadFailedDescription:
      "画像を読み込めなかったか、開いたあとに変更されました。",
    loadFailedTitle: "画像を表示できません",
    loading: "画像を読み込み中",
    title: "画像プレビュー",
    viewerLabel: "画像プレビュー",
    zoomIn: "拡大",
    zoomLevel: "拡大率",
    zoomOut: "縮小",
  },
  contentPreview: {
    title: "プレビュー",
  },
  ok: "OK",
} as const;
