/** 设置 · 应用更新分区文案（从 settings.ts 拆出，规避单文件行数上限）。 */
export const settingsAppUpdate = {
  title: "앱 업데이트",
  description: "Pier 업데이트를 확인하고 내려받아 설치합니다.",
  available: "버전 {{version}}을(를) 사용할 수 있습니다.",
  progress: "내려받기 {{percent}}%",
  state: {
    disabled: "개발 모드는 앱 업데이트를 확인하지 않습니다.",
    idle: "아직 업데이트 확인을 실행하지 않았습니다.",
    checking: "업데이트를 확인하는 중…",
    available: "업데이트가 있습니다.",
    "not-available": "Pier는 최신입니다.",
    downloading: "업데이트를 내려받는 중…",
    downloaded: "업데이트를 내려받았습니다. 다시 시작해 설치합니다.",
  },
  errorOpenSettings: "업데이트 설정 열기",
  errorHint: {
    offline: "네트워크 연결을 확인한 후 다시 시도하세요.",
    "no-artifact":
      "새 패키지가 아직 게시되지 않았습니다. 나중에 다시 시도하세요.",
    "rate-limited": "나중에 다시 시도하세요.",
    server: "나중에 다시 시도하세요.",
    unknown: "나중에 다시 시도하세요.",
  },
  errorKind: {
    offline: "네트워크 연결에 실패했습니다",
    "no-artifact": "사용 가능한 업데이트 패키지가 없습니다",
    "rate-limited": "업데이트 요청이 너무 많습니다",
    server: "업데이트 서비스를 일시적으로 사용할 수 없습니다",
    unknown: "업데이트에 실패했습니다",
  },
  action: {
    check: "업데이트 확인",
    download: "내려받기",
    restart: "다시 시작하고 설치",
  },
  toast: {
    statusFailed: "업데이트 상태를 읽지 못했습니다. 다시 시도하세요",
    checkFailed: "업데이트를 확인하지 못했습니다. 다시 시도하세요",
    downloadFailed: "업데이트를 내려받지 못했습니다. 다시 시도하세요",
    installFailed: "업데이트를 설치하지 못했습니다. 다시 시도하세요",
    failed: "앱 업데이트 실패",
    ready: "업데이트가 준비됨",
    readyDetail: "Pier {{version}} · 다시 시작해 설치",
  },
  titleBar: {
    update: "업데이트",
    updateAvailable: "v{{version}}",
    availableAria: "Pier {{version}}을(를) 사용할 수 있습니다",
    downloadingAria: "업데이트 내려받는 중 {{percent}}퍼센트",
    restartAria: "다시 시작하고 Pier {{version}} 설치",
  },
} as const;
