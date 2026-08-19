/** Language-service rows under `settings.row.*` (file-size isolation). */
export const settingsLspRow = {
  lspHostSectionTitle: "언어 서비스(호스트)",
  lspHostSectionDesc:
    "Pier가 언어 서버 프로세스를 시작할지 여부입니다. 언어 인식과 강조는 내장입니다. 서버는 PATH의 도구에서 실행됩니다. 도구가 없으면 해당 파일을 열 때 편집기 상태 칩에 설치 명령이 나옵니다. 위의 「편집기 언어 기능」은 Files 편집기가 이 서비스를 쓸지만 제어합니다.",
  lspEnabled: "언어 서버 실행",
  lspEnabledDesc:
    "끄면 어떤 프로젝트에서도 완성이나 진단 프로세스가 시작되지 않습니다.",
  lspIdleReleaseMinutes: "유휴 해제",
  lspIdleReleaseMinutesDesc: "이 분 동안 유휴면 서버를 해제합니다. 범위 1–1440",
  lspMaxLocalWorkspaces: "로컬 프로젝트 한도",
  lspMaxLocalWorkspacesDesc: "언어 서버를 동시에 둘 수 있는 로컬 프로젝트 수",
  lspMaxRemoteWorkspaces: "원격 프로젝트 한도",
  lspMaxRemoteWorkspacesDesc: "언어 서버를 동시에 둘 수 있는 원격 프로젝트 수",
  lspMemoryBudgetMb: "메모리 예산",
  lspMemoryBudgetMbDesc:
    "언어 서버 전체 메모리 한도입니다. 초과하면 가장 오래 쓰지 않은 프로젝트를 중지하고, 필요할 때 다시 시작합니다. 0은 한도 없음입니다",
  lspUpdateFailed:
    "언어 서비스 설정을 업데이트하지 못했습니다. 다시 시도하세요",
  lspWorktreesEnabled: "작업 트리에서도 실행",
  lspWorktreesEnabledDesc:
    "에이전트 작업 트리에서도 언어 서버를 시작합니다. 작업 트리가 늘면 자원도 더 씁니다.",
  lspAdvancedTitle: "자원과 한도",
  lspAdvancedDesc: "대부분의 환경에서는 기본값으로 충분합니다.",
  lspToolsTitle: "로컬 도구",
  lspToolsDesc:
    "이 Mac의 언어 서버를 읽기 전용으로 확인합니다. 없는 도구는 직접 설치하세요(PATH). Pier는 내려받지 않습니다.",
  lspToolsLoading: "로컬 도구 확인 중…",
  lspToolsEmpty: "도구 상태를 불러오지 못했습니다",
  lspToolsEmptyDesc:
    "잠시 후 다시 시도하거나 Pier를 재시작한 뒤 이 페이지를 다시 여세요.",
  lspToolsNone: "나열할 로컬 도구가 없습니다",
  lspToolsNoneDesc: "지금 확인할 항목이 없습니다.",
  lspToolsStatusBundled: "내장",
  lspToolsStatusAvailable: "PATH에 있음",
  lspToolsStatusMissing: "없음",
  lspToolsCopyInstall: "{{name}} 설치 명령 복사",
  lspToolsCopied: "복사함",
  lspToolsCopyFailed: "설치 명령을 복사하지 못했습니다",
} as const;
