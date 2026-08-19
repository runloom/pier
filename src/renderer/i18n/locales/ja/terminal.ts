export const terminal = {
  closeFailed: "ターミナルを閉じられませんでした。もう一度お試しください",
  initialInput: {
    promptEnterFailed:
      "テキストはすでに入力されています。Return で送信してください。",
    promptFailed:
      "ターミナルは開きましたが、タスクのテキストを入力できませんでした。ターミナルに入力してください。",
    setupEnterFailed:
      "コマンドはすでに入力されています。Return で実行してください。",
    setupFailed:
      "ターミナルは開きましたが、セットアップコマンドを実行できませんでした。ターミナルで実行するか、もう一度作成してください。",
  },
  frameWaitFailed:
    "ターミナル画面が表示されませんでした。もう一度試すか、このターミナルを開き直してください。",
  openPathFailed: "パスを開けませんでした。もう一度お試しください",
  openPathInvalid: "このパスを開けませんでした",
  openPathRelativeWithoutCwd:
    "このターミナルには作業ディレクトリがないため、相対パスを開けません。",
  openPathUnsupportedScheme: "このリンクを Pier で開けませんでした",
  agentSession: {
    coldStart:
      "前回のセッションを再開できませんでした。新しいエージェントを起動しました。",
    endedBody: "前回のセッションは終了しています。再起動して続けてください。",
    endedTitle: "エージェントセッションが終了しました",
    fieldAgent: "エージェント",
    fieldCommand: "コマンド",
    fieldCwd: "作業ディレクトリ",
    fieldDuration: "所要時間",
    fieldExitCode: "終了コード",
    fieldStatus: "状態",
    restart: "エージェントを再起動",
    restartFailed:
      "エージェントを再起動できませんでした。もう一度お試しください",
    statusEnded: "正常に終了",
    statusFailed: "失敗",
    summaryTitle: "セッション概要",
    tryResumeLast: "このフォルダの最新を再開",
    tryResumeLastFailed:
      "このフォルダの最新セッションを再開できませんでした。もう一度お試しください",
    unsupported:
      "このエージェントは前回のセッションを再開できません。新しいエージェントを起動しました。",
  },
  agentStatus: {
    error: "エラー",
    processing: "考え中",
    ready: "入力待ち",
    /** Launch prior with no hook status and no catalog label. */
    starting: "起動中…",
    subagentCount: "サブエージェント {{count}} 件",
    subagentCount_one: "サブエージェント {{count}} 件",
    subagentCount_other: "サブエージェント {{count}} 件",
    tool: "ツール実行中",
    waiting: "確認待ち",
  },
  composer: {
    attachFailed: "ファイルを追加できませんでした。もう一度お試しください",
    attachFile: "ファイルを追加",
    // Only warn for verified TUIs; cursor risk never disables sending by itself.
    blockedUnfocused: "ターミナル入力にフォーカスがない可能性があります",
    blockedUnfocusedBody:
      "先にセッション入力をクリックするか、入力できると分かっている場合は続けてください。",
    blockedUnfocusedTitle: "ターミナル入力にフォーカスがない可能性があります",
    invalidAttachmentRef: "添付が無効です。削除して追加し直してください",
    keyHint: "⇧⏎ 改行 · {{attach}} 添付 · Esc 閉じる",
    label: "リッチ入力",
    largePasteAttachFailed:
      "貼り付けを添付できませんでした。もう一度お試しください",
    editPasteTitle: "貼り付け内容を編集",
    editPasteLabel: "内容",
    editPasteEmptyHint: "空にして保存すると、この貼り付けは削除されます",
    editPasteSave: "保存",
    editPasteSaveFailed:
      "貼り付け内容を保存できませんでした。もう一度お試しください",
    pasteAttachmentAria: "貼り付け内容、添付 {{n}}",
    attachmentAutocompleteEmptyBody:
      "先にファイルを追加してから、# でここに挿入してください。",
    attachmentAutocompleteEmptyTitle: "添付はまだありません",
    attachmentAutocompleteNoResults: "一致する添付はありません",
    mentionEmptyProjectBody:
      "先にプロジェクトフォルダを開くと、@ でファイルを指定できます。",
    mentionEmptyProjectTitle: "プロジェクトが開かれていません",
    mentionNoResults: "一致するファイルはありません",
    mentionPlaceholder: "ファイルまたはフォルダを指定…",
    noActiveTerminal:
      "先に対象のターミナルタブに切り替えてから、リッチ入力を開いてください。",
    pasteInsertAnyway: "それでもメッセージに挿入",
    pathUnreadable: "そのファイルを読めませんでした。パスを確認してください",
    placeholder: "ここに入力すると、ターミナルのセッションへ送られます",
    removeAttachment: "添付を削除",
    send: "送信",
    sendAnyway: "それでも送信",
    sendFailed: "送信できませんでした。もう一度お試しください",
    sendTooLong: "メッセージが長すぎます。短くしてもう一度お試しください",
    skillEmptyProjectBody:
      "プロジェクトフォルダを開くと、プロジェクトのスキルを探せます。内蔵コマンドはエージェントターミナルでそのまま使えます。",
    skillEmptyProjectTitle: "プロジェクトが開かれていません",
    skillNoAgentBody:
      "エージェントターミナルに切り替えてから、/ でスキルまたはコマンドを挿入してください。",
    skillNoAgentTitle: "アクティブなエージェントはありません",
    skillNoResults: "一致するスキルまたはコマンドはありません",
    skillNoneAvailableBody:
      "このエージェントにスキルまたはコマンドはありません。設定 → プロジェクト → スキルで有効にするか、エージェントを切り替えてください。",
    skillNoneAvailableTitle:
      "このエージェントにスキルまたはコマンドはありません",
    skillPlaceholder: "このエージェントのスキルまたはコマンドを選ぶ…",
    commandDesc: {
      aider: {
        add: "ファイルをチャットに追加し、aider が編集できるようにする",
        drop: "チャットからファイルを外す（引数がなければすべて）",
        ask: "ファイルを編集せずにコードベースについて尋ねる",
        architect: "アーキテクト／エディタのモデル組で尋ねる",
        code: "コードの変更を依頼する",
        diff: "前回のメッセージ以降の差分を表示する",
        undo: "aider が行った直近の git コミットを取り消す",
        clear: "チャット履歴を消去する",
      },
      claude: {
        plan: "計画モードに入る。説明から始めてもよい",
        btw: "会話に触れず、短い横の質問をする",
        compact: "会話を要約して空きを作る",
        init: "CLAUDE.md ガイドでプロジェクトを初期化する",
        clear: "空の履歴で新しい会話を始める",
      },
      cline: {
        compact: "現在の内容を圧縮する",
        undo: "ワークスペースを以前のチェックポイントに戻す",
        clear: "新しいセッションを始める",
      },
      codebuddy: {
        plan: "現在の計画ファイルの内容をプレビューする",
        btw: "作業を中断せず、短い横の質問をする",
        compact: "会話を要約して使用量を減らす",
        init: "このリポジトリのプロジェクト指示を初期化する",
        review: "プルリクエストを確認する",
        clear: "新しい会話を始める",
      },
      "command-code": {
        plan: "計画モードに入る。計画するタスクを付けてもよい",
        compact: "会話履歴を圧縮する",
        clear: "空の履歴で新しいセッションを始める",
        init: "このプロジェクトの AGENTS.md を初期化する",
        review: "プルリクエストを確認する",
        fork: "会話を新しいセッションに分岐する",
        clone: "現在のブランチを新しいセッションに複製する",
      },
      codex: {
        plan: "計画モードに切り替え、プロンプトを送ってもよい",
        btw: "一時的なサイドチャットを始め、一点に絞って続ける",
        compact: "表示中のチャットを要約してトークンを空ける",
        init: "現在のディレクトリに AGENTS.md のひな形を作る",
        review: "Codex に作業ツリーの確認を依頼する",
      },
      continue: {
        init: "このプロジェクトの AGENTS.md を作成する",
        compact: "チャット履歴を短い形にまとめる",
        clear: "チャット履歴を消去する",
      },
      copilot: {
        plan: "実装前に実装計画を作る",
        ask: "会話履歴の外で短い横の質問をする",
        compact: "会話履歴を要約して使用量を減らす",
        init: "このリポジトリの Copilot 指示を初期化する",
        review: "現在の変更にコードレビューエージェントを実行する",
        "security-review": "ステージ済みと未ステージの変更の脆弱性を調べる",
      },
      cursor: {
        plan: "計画モードに切り替え、プロンプトを送ってもよい",
        ask: "読み取り専用の質問モードを切り替える",
        summarize: "会話を要約して履歴を短くする",
        clear: "新しいチャットセッションを始める",
      },
      droid: {
        btw: "主記録を汚さず横の質問をする",
        review: "AI によるコードレビューの流れを始める",
        clear: "会話内容を消し、モデルと自律設定は残す",
        new: "既定のモデルと自律設定で新しいセッションを始める",
      },
      gemini: {
        plan: "計画モードに切り替え、現在の計画を見る",
        compress: "会話内容を要約に置き換える",
        init: "プロジェクトを分析し、合わせた GEMINI.md を作る",
        clear: "画面を消して新しいセッションを始める",
      },
      goose: {
        plan: "計画モードに入る。メッセージから始めてもよい",
        endplan: "計画モードを抜けて通常モードに戻る",
        compact: "会話を要約して長さを減らす",
        clear: "現在のチャット履歴を消去する",
      },
      grok: {
        plan: "計画モードに切り替える",
        btw: "短い横の質問をする",
        compact: "会話履歴を圧縮する。残す内容を指定してもよい",
        new: "新しいセッションを始める",
      },
      kilo: {
        review: "コード変更を確認する（未コミット、ステージ済み、ブランチ…）",
      },
      kimi: {
        plan: "計画モードを切り替える（オン／オフ／表示／消去）",
        btw: "主チャットを中断せず横の質問をする",
        compact: "内容を圧縮する。注目点を指定してもよい",
        init: "コードベースを分析し、AGENTS.md を作る",
        clear: "内容を消去する",
      },
      omp: {
        plan: "計画モードを切り替える。エージェントは実行前に草案を書く",
        btw: "記録を汚さず、一時的な横の質問をする",
        compact: "古い会話を要約する。注目点を指定してもよい",
        new: "新しいセッションを始める",
        retry: "失敗したあと、同じ入力を再送する",
        loop: "作業が終わるか上限に達するまで繰り返す",
        handoff: "締めの説明を書いてこの回を終える",
      },
      opencode: {
        init: "プロジェクト案内 AGENTS.md を作成または更新する",
        compact: "現在のセッション内容を圧縮する",
        new: "新しいセッションを始める",
        undo: "直前のメッセージとそのファイル変更を取り消す",
        redo: "取り消したメッセージをやり直す",
        share: "公開リンクで現在のセッションを共有する",
      },
      pi: {
        new: "新しいセッションを始める",
        compact: "古い内容を要約する。注目点を指定してもよい",
        fork: "以前のユーザーメッセージから新しいセッションを作る",
        clone: "現在のブランチを新しいセッションに複製する",
        reload: "キー割り当て、拡張、スキル、説明ファイルを再読み込みする",
      },
      "qwen-code": {
        plan: "計画モードに入る。計画するタスクを付けてもよい",
        btw: "主の流れに触れず、短い横の質問をする",
        compress: "会話履歴を要約に置き換える",
        init: "プロジェクトを分析し、QWEN.md 説明ファイルを作る",
        review: "現在の変更を複数エージェントでコードレビューする",
        clear: "会話履歴を消して空きを作る",
      },
    },
    skillDesc: {
      claude: {
        "code-review": "変更の品質、リスク、フォローアップを確認する",
        doctor: "Claude Code のセットアップと環境の状態を診断する",
        debug: "構造化した手順で失敗を調べる",
        verify: "アプリをビルドして実行し、変更が動くことを確認する",
        batch: "ファイルをまたぐ複数ステップの一括作業を実行する",
        loop: "停止条件を満たすまで作業を繰り返す",
      },
      codex: {
        "skill-creator": "Codex スキルパッケージを作成または改善する",
      },
    },
    skillSourceBundled: "内蔵",
    skillSourceCommand: "コマンド",
    skillSourceGlobal: "この Mac",
    skillSourceInRepo: "プロジェクト内",
    skillSourceProject: "管理対象",
  },
  search: {
    close: "検索を閉じる",
    label: "ターミナル内を検索",
    matchCount: "{{index}} / {{total}}",
    next: "次の一致",
    noMatches: "一致なし",
    placeholder: "検索",
    previous: "前の一致",
  },
  runtimeControl: {
    blocked: "ブロック中",
    cancelled: "キャンセル済み",
    close: "タスクパネルを閉じる",
    controlLabel: "タスク実行の操作: {{label}}",
    dismiss: "閉じる",
    duration: "経過時間: {{duration}}",
    failed: "失敗",
    finishedBlocked: "タスクはブロック中",
    finishedCancelled: "タスクはキャンセルされました",
    finishedDetailDuration: "{{label}} · {{duration}} かかりました",
    finishedDetailFailed:
      "{{label}} · 終了コード {{code}} · {{duration}} かかりました",
    finishedDetailRanFor: "{{label}} · {{duration}} 実行",
    finishedDetailBlocked:
      "{{label}} · 先行タスクを待機、{{duration}} かかりました",
    finishedFailed: "タスクは失敗しました",
    finishedForceCancelled: "タスクを強制停止しました",
    finishedStopped: "タスクは停止しました",
    finishedSuccess: "タスクは完了しました",
    forceStop: "強制停止",
    forceStopBody:
      "タスクがきれいに止まりませんでした。強制停止するとすぐに終了します。出力はまだ開けます。",
    forceStopConfirm: "強制停止",
    forceStopTitle: "タスクを強制停止しますか？",
    inputResolutionFailed: "必要な入力がまだ足りません",
    missingRunIdentity:
      "タスクは始まりましたが、状態が表示されていません。再実行するか出力を開いてください。",
    move: "実行操作を移動",
    openOutput: "タスク出力を開く",
    openOutputFailed: "タスク出力を開けませんでした。もう一度お試しください",
    pending: "待機中",
    progress: "{{completed}} / {{total}}",
    progressLabel: "{{completed}} / {{total}} 件のタスクが完了",
    restart: "タスクを再実行",
    reveal: "タスクターミナルを表示",
    revealFailed:
      "タスクターミナルを見つけられませんでした。もう一度お試しください",
    revealUnavailableBody: "タスクターミナルはもう使えません。",
    running: "実行中",
    selectRunCurrent: "タスクを切り替え、現在: {{label}}",
    startFailed: "タスクを起動できませんでした。もう一度お試しください",
    stateUnavailableDismiss: "閉じる",
    stateUnavailableRetry: "再試行",
    stateUnavailableTitle: "タスク状態を使えません",
    stop: "タスクを停止",
    stopFailed: "タスクを停止できませんでした。もう一度お試しください",
    stopping: "停止中",
    succeeded: "成功",
    viewDetails: "詳細を見る",
  },
  statusBar: {
    item: {
      agentStatus: {
        title: "エージェントの状態",
      },
      comments: {
        chipLabel: "コメント · {{count}}",
        clear: "消去",
        clearBody:
          "この一覧のコメント（変更、ドキュメント、キャンバス）をすべて削除します。元に戻せません。",
        clearConfirm: "消去",
        clearFailed: "コメントを消去できませんでした",
        clearPartialBody:
          "{{deleted}} 件のコメントを削除しました。{{remaining}} 件は削除できませんでした。残りをもう一度お試しください。",
        clearPartialTitle: "一部のコメントが残っています",
        clearTitle: "コメントをすべて消去しますか？",
        deleteFailed: "コメントを削除できませんでした",
        deleteOne: "コメントを削除",
        dialogTitle: "コメント",
        empty: "未処理のコメントはありません",
        emptyBody:
          "変更、ドキュメント、キャンバスにコメントを付けると、ここで処理できます。",
        emptyTitle: "処理するコメントはありません",
        failure: {
          commentNotFound: "そのコメントはもうありません。",
          internal: "問題が発生しました。もう一度お試しください。",
          invalidSource: "これらのコメントはこのプロジェクトでは使えません。",
          targetImmutable: "そのコメントは変更できません。",
          threadNotFound: "そのコメントスレッドはもうありません。",
        },
        itemTitle: "{{path}}:{{line}}",
        itemTitlePathOnly: "{{path}}",
        sourceCanvas: "キャンバス",
        sourceGit: "diff",
        sourceMarkdown: "ドキュメント",
        jumpFailed: "変更を開けませんでした",
        jumpFailedBody:
          "このプロジェクトの変更表示を開いてから、もう一度移動してください。",
        jumpUnsupportedBody:
          "この種類のコメントへの移動はまだ使えません。この一覧からエージェントに送ることはできます。",
        jumpUnsupportedTitle: "移動はまだ使えません",
        loadingLabel: "現在の変更を読み込み中…",
        openCount: "未処理コメント {{count}} 件",
        staleJumpBody:
          "そのファイルはすでにコミットされているか、現在の変更にありません。このコメントは削除されます。",
        staleJumpTitle: "コメントは現在の変更にありません",
        submitAndClear: "送信して消去",
        submitFailed: "コメントを送信できませんでした",
        submitPartialBody:
          "コメントを入力欄に追加しました。一覧から {{deleted}} 件を削除し、{{remaining}} 件は削除できませんでした。",
        submitPartialTitle: "送信しましたが、コメントが残っています",
        submitUnavailableBody:
          "先にエージェントの会話を開いてから、もう一度お試しください。",
        title: "コメント",
      },
      history: {
        title: "ターミナル履歴",
      },
    },
    manage: "ステータスバーを管理…",
  },
  history: {
    dialogTitle: "ターミナルの全履歴",
    emptyBody:
      "このターミナルが出力を出すと、ここに完全な記録が残ります（再起動前の履歴も含みます）。",
    emptyTitle: "履歴はまだありません",
    loadFailedBody: "少し待ってもう一度お試しください。",
    loadFailedTitle: "ターミナル履歴を読み込めませんでした",
    open: "全履歴を見る",
    truncatedNotice:
      "全履歴は {{totalMb}} MB です。いちばん新しい部分を表示しています。",
  },
  /**
   * Ghostty / native host messages (see ghostty-host-copy catalog).
   * Prefer product wording over Ghostty brand for user-facing copy.
   */
  ghosttyHost: {
    processExited: "プロセスが終了しました",
    processExitedFailed: "プロセスが終了コード {{code}} で終了しました",
    processExitedAbnormal:
      "コマンドがすぐ終了しました（{{duration}}）。起動に失敗した可能性があります。",
    agentExited: "エージェントセッションが終了しました",
    agentExitedFailed:
      "エージェントセッションが終了コード {{code}} で終了しました",
    agentExitedAbnormal:
      "エージェントがすぐ終了しました（{{duration}}）。起動に失敗した可能性があります。",
    taskExited: "タスクが完了しました",
    taskExitedFailed: "タスクが終了コード {{code}} で失敗しました",
    taskExitedAbnormal:
      "タスクがすぐ終了しました（{{duration}}）。起動に失敗した可能性があります。",
    taskOutputExited: "タスク出力が終了しました",
    taskOutputExitedFailed: "タスク出力が終了コード {{code}} で終了しました",
    taskOutputExitedAbnormal:
      "タスク出力がすぐ終了しました（{{duration}}）。プロセスの起動に失敗した可能性があります。",
    dismissAnyKey: "どれかのキーで閉じる",
    dismissExplicit: "確認が終わったらタブを閉じてください",
    injectExitFailed:
      "ターミナルにセッション終了メッセージを出せませんでした。確認が終わったらタブを閉じてください。",
    launchFailedTitle: "コマンドを起動できませんでした",
    launchFailedRuntime: "実行時間: {{duration}}",
    launchFailedExitCode: "終了コード: {{code}}",
    launchFailedDismiss: "どれかのキーで閉じる",
    ptyExhausted:
      "この Mac はいま別のターミナルを開けません。使っていないターミナルや、ターミナルセッションを使うほかのアプリを閉じてから、もう一度お試しください。",
    inputPathFailed:
      "設定した起動入力ファイルがないか、読めません。ターミナル入力の設定を確認してもう一度お試しください。",
    ioThreadFailed:
      "ターミナルセッションを開始できませんでした（{{error}}）。このタブを閉じてもう一度お試しください。",
    ioThreadOom:
      "メモリが足りず、ターミナルを開始できません。このタブを閉じてもう一度お試しください。",
    pasteConfirmTitle: "ターミナルにペーストしますか？",
    pasteConfirmBody:
      "このペーストは {{lines}} 行あり、コマンドがすぐ実行される可能性があります。",
    pasteConfirmAccept: "ペースト",
    pasteConfirmCancel: "キャンセル",
  },
} as const;
