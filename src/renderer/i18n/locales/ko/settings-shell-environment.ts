/** Shell environment Terminal settings card (split from settings.ts for file-size). */
export const settingsShellEnvironment = {
  title: "셸 환경",
  description:
    "Pier는 로그인 셸을 불러와 작업과 에이전트가 터미널과 같은 도구를 찾도록 합니다.",
  windowsNote:
    "Windows에서는 로그인 셸 불러오기를 건너뜁니다. 명령은 프로세스 환경에서 옵니다.",
  statusLabel: "상태:",
  status: {
    resolved: "터미널과 일치",
    failed: "기본 환경 사용 중",
    skipped: "건너뜀",
    unknown: "아직 사용할 수 없음",
  },
  skipReason: {
    cli: "터미널에서 시작했으므로 현재 환경을 사용합니다",
    disabled: "로그인 셸 불러오기가 꺼져 있습니다",
    "no-shell": "쓸 수 있는 셸이 없습니다",
    windows: "Windows는 로그인 셸을 해석하지 않습니다",
  },
  refresh: "다시 불러오기",
  refreshing: "다시 불러오는 중…",
  disabled: "로그인 셸 환경을 불러오지 않기",
  disabledDesc:
    "켜면 Pier가 로그인 셸을 건너뜁니다. 작업이 Node 같은 도구를 찾지 못할 수 있습니다.",
  timeout: "불러오기 제한 시간",
  timeoutDesc: "로그인 셸이 끝날 때까지 기다리는 초. 범위 1–120.",
  statusFailed: "상태를 읽지 못했습니다. 다시 시도하세요",
  refreshFailed: "다시 불러오기가 끝나지 않아 현재 환경을 그대로 씁니다",
  updateFailed: "설정을 업데이트하지 못했습니다. 다시 시도하세요",
} as const;
