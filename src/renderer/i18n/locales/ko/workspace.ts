export const workspace = {
  closeFailure: {
    starting: "워크스페이스가 아직 시작 중이라 배치를 저장하지 못했습니다.",
    title: "윈도우를 닫을 수 없습니다",
    unavailable:
      "워크스페이스를 쓸 수 없어 배치를 안전하게 저장하지 못했습니다.",
  },
  pluginPanel: {
    appletHostUnavailable: "지금은 이 뷰를 표시할 수 없습니다.",
    appletLoadDetails: "자세히 보기",
    appletLoadFailed: "작업 뷰를 불러오지 못했습니다",
    appletLoadFailedBody:
      "다시 시도하세요. 계속 실패하면 Pier를 다시 시작하세요.",
    appletLoadRetry: "다시 시도",
    appletNoProject: "먼저 프로젝트 폴더를 여세요.",
    crashDescription:
      "플러그인 UI에 오류가 발생했습니다. 다른 패널은 영향을 받지 않습니다. 플러그인을 비활성화하거나 다시 로드하면 복구됩니다.",
    crashTitle: "플러그인 패널이 충돌했습니다",
    loadingDescription:
      "플러그인을 불러오는 중입니다. 준비되면 내용이 나타납니다.",
    loadingTitle: "플러그인 패널 불러오는 중",
    missingRendererDescription: "이 플러그인에는 표시할 화면이 없습니다.",
    unavailableTitle: "플러그인 패널을 쓸 수 없습니다",
  },
  startupError: {
    description: "다시 불러와 한 번 더 시도하세요.",
    retry: "다시 불러오기",
    title: "Pier를 시작하지 못했습니다",
  },
  runtimeError: {
    description: "터미널 세션은 유지됩니다. 다시 불러와 계속하세요.",
    retry: "다시 불러오기",
    title: "화면 오류",
  },
  tab: {
    activeTask: "작업 실행 중",
    close: "탭 닫기",
    create: "새로 만들기",
    hiddenTabs: "숨긴 탭",
    maximize: "최대화",
    restore: "복원",
    unsaved: "저장하지 않은 변경",
  },
  addPanelMenu: {
    actionFailed: "작업을 완료하지 못했습니다. 다시 시도하세요",
    detectAgentsFailed: "에이전트를 감지하지 못했습니다. 다시 시도하세요",
    noMatches: "일치하는 항목이 없습니다",
    searchPlaceholder: "패널 종류 또는 에이전트 검색…",
    title: "이 패널 그룹에 만들기",
    startAgentFailed: "에이전트를 시작하지 못했습니다. 다시 시도하세요",
    startAgentInjectFailed:
      "터미널은 열렸지만 시작 명령을 입력하지 못했습니다. 터미널에 직접 입력하거나 에이전트를 다시 시작하세요.",
  },
  panelTransfer: {
    dropFailedTitle: "탭을 옮기지 못했습니다",
    dropFailedBody:
      "해당 윈도우로 옮기지 못했습니다. 원래 탭은 그대로 열려 있습니다.",
    dropFailedUnknownComponentBody:
      "다른 윈도우로 옮기지 못했습니다. 원래 탭은 그대로 열려 있습니다.",
    copyToNewWindowFailed: "새 윈도우로 복사하지 못했습니다. 다시 시도하세요",
    copyToWindowFailed: "해당 윈도우로 복사하지 못했습니다. 다시 시도하세요",
    moveToNewWindowFailed: "새 윈도우에서 열지 못했습니다. 다시 시도하세요",
    moveToWindowFailed: "해당 윈도우로 옮기지 못했습니다. 다시 시도하세요",
    emptyWindowDescription: "빈 윈도우",
    noOtherWindowsTitle: "다른 윈도우가 없습니다",
    noOtherWindows: "다른 윈도우를 먼저 연 다음 다시 시도하세요.",
    pickWindowFailed: "윈도우 목록을 가져오지 못했습니다. 다시 시도하세요",
    sameNameIndex: " · {{n}}",
    windowLabel: "윈도우 {{n}}",
    unsupportedTitle: "이 탭은 다른 윈도우로 옮길 수 없습니다",
    unsupportedBody:
      "이 종류의 탭은 윈도우 사이를 이동할 수 없습니다. 여기에서는 그대로 열려 있습니다.",
    unavailableSourceTitle: "여기에서는 탭을 더 이상 쓸 수 없습니다",
    unavailableSourceBody:
      "다른 곳으로 옮겼지만 원본을 닫지 못했습니다. 필요하면 직접 닫으세요.",
    unavailableTargetTitle: "탭을 복원하지 못했습니다",
    unavailableTargetBody:
      "이 윈도우로 옮겼지만 원본을 여기서 쓸 수 없습니다. 관련 확장 기능을 켠 뒤 다시 불러오세요.",
  },
} as const;
