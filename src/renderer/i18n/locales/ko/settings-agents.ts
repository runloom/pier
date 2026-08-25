export const settingsAgents = {
  permissionMode: {
    yolo: "확인 건너뛰기",
    manual: "수동",
    mixed: "혼합",
  },
  defaultPick: {
    auto: "자동",
    blank: "빈 터미널",
  },
  list: {
    title: "에이전트 CLI",
    description: "설치됨 및 감지된 에이전트",
    refresh: "새로고침",
    refreshSuccess: "목록을 새로고침했습니다",
    refreshFailed: "목록을 새로고침하지 못했습니다",
    checkUpdates: "업데이트 확인",
    checkUpdatesSuccess: "업데이트 확인이 끝났습니다",
    checkUpdatesFailed: "업데이트를 확인하지 못했습니다",
    updateAll: "모두 업데이트",
    updateAllDone: "에이전트 업데이트가 끝났습니다",
    updateAllPartial: "일부 에이전트를 업데이트하지 못했습니다",
  },
  status: {
    detected: "감지됨",
    missing: "설치되지 않음",
    disabled: "사용 안 함",
    updateAvailable: "업데이트 있음",
    broken: "설치됐지만 실행되지 않음",
    conflict: "여러 설치",
  },
  action: {
    enable: "사용",
    disable: "사용 안 함",
    setDefault: "기본값으로 설정",
    isDefault: "기본값",
    expand: "자세히",
    website: "웹사이트",
    websiteOpenBusy: "다른 링크를 이미 여는 중입니다",
    websiteOpenFailedDescription: "에이전트 웹사이트를 열지 못했습니다.",
    websiteOpenFailedTitle: "웹사이트를 열 수 없습니다",
    install: "설치",
    update: "업데이트",
    reinstall: "다시 설치",
    uninstall: "제거",
    cancel: "취소",
    copyInstallCommand: "설치 명령 복사",
    copyInstallCommandSuccess: "설치 명령을 복사했습니다",
    copyInstallCommandFailed: "설치 명령을 복사하지 못했습니다",
    installFailed: "에이전트를 설치하지 못했습니다",
    updateFailed: "에이전트를 업데이트하지 못했습니다",
    reinstallFailed: "에이전트를 다시 설치하지 못했습니다",
    uninstallFailed: "에이전트를 제거하지 못했습니다",
    installBusy: "설치 중",
    updateBusy: "업데이트 중",
    reinstallBusy: "다시 설치 중",
    uninstallBusy: "제거 중",
    queueBusy: "대기 중",
    busyStep: "{{current}}/{{total}}",
    busyPercent: "{{percent}}%",
    rowInstallFailed: "설치 실패",
    rowInstallFailedWithStep: "설치 실패({{step}})",
    rowUpdateFailed: "업데이트 실패",
    rowUpdateFailedWithStep: "업데이트 실패({{step}})",
    rowReinstallFailed: "다시 설치 실패",
    rowUninstallFailed: "제거 실패",
    rowUninstallPartial: "기본 설치는 제거했습니다. 나머지는 아직 감지됩니다",
    alreadyInstalled: "이미 설치됨",
    conflictConfirmTitle: "여러 설치를 찾았습니다",
    conflictConfirmBody:
      "지금 기본으로 쓰는 설치만 업데이트합니다. 다른 위치는 그대로입니다.",
    conflictConfirmContinue: "기본값 업데이트",
    reinstallConfirmTitle: "이 에이전트를 다시 설치할까요?",
    reinstallConfirmBody:
      "공식 설치 프로그램으로 「{{name}}」을(를) 다시 넣습니다. 대화와 로컬 설정은 남습니다.",
    reinstallConfirmConflictNote:
      "지금 기본으로 쓰는 설치만 새로고칩니다. 다른 위치는 그대로입니다.",
    reinstallConfirmContinue: "다시 설치",
    uninstallConfirmTitle: "이 에이전트를 제거할까요?",
    uninstallConfirmBody:
      "이 Mac에서 「{{name}}」을(를) 제거합니다({{source}}: {{path}}). 대화와 로컬 설정은 남습니다. 실행 중인 터미널은 멈출 수 있습니다.",
    uninstallConfirmBodyNameOnly:
      "이 Mac에서 「{{name}}」을(를) 제거합니다. 대화와 로컬 설정은 남습니다. 실행 중인 터미널은 멈출 수 있습니다.",
    uninstallConfirmConflictNote:
      "지금 기본으로 쓰는 설치만 제거합니다. 다른 위치는 그대로입니다.",
    uninstallConfirmContinue: "제거",
    uninstallSuccess: "{{name}}을(를) 제거했습니다",
    uninstallSkipped: "설치되어 있지 않습니다",
    uninstallUnsupported:
      "이 설치 방식은 자동으로 제거할 수 없습니다. 아래에 사용자 지정 명령을 추가하거나 웹사이트를 여세요.",
  },
  lifecycle: {
    version: "버전",
    latest: "최신",
    installGuide: "설치 명령",
    installs: "설치 위치",
    reinstallHint: "다시 설치로 현재 설치를 새로고칠 수 있습니다.",
    errors: {
      unsupported:
        "이 에이전트는 자동 설치할 수 없습니다. 안내를 쓰거나 웹사이트를 여세요.",
      unavailable: "설치 서비스를 지금 쓸 수 없습니다. 나중에 다시 시도하세요.",
      no_command: "이 시스템용 설치 명령이 설정되어 있지 않습니다.",
      command_failed:
        "설치, 업데이트 또는 제거 명령이 실패했습니다. 자세한 내용은 아래를 보세요.",
      version_unchanged:
        "버전이 바뀌지 않았습니다. 다른 설치가 아직 쓰이고 있을 수 있습니다.",
      not_runnable:
        "설치됐지만 시작하지 못했습니다. 터미널에서 해당 명령을 실행해 원인을 확인하세요.",
      not_found_after_install:
        "설치는 끝났지만 명령을 아직 찾지 못했습니다. 목록을 새로고침하거나 새 터미널을 여세요.",
      already_installed: "이 에이전트는 이미 설치되어 있습니다.",
      busy: "이 에이전트의 설치, 업데이트 또는 제거가 이미 실행 중입니다.",
      cancelled: "설치, 업데이트 또는 제거를 취소했습니다.",
      timeout:
        "설치, 업데이트 또는 제거가 시간 초과되었습니다. 네트워크가 안정된 뒤 다시 시도하세요.",
      env_unavailable:
        "셸 환경을 준비하지 못했습니다. 새로고침한 뒤 다시 시도하세요.",
      package_manager_missing:
        "필요한 패키지 관리자(npm, Homebrew, pipx, uv)를 찾지 못했습니다. 설치한 뒤 다시 시도하세요.",
      still_detected: "제거는 끝났지만 에이전트가 아직 감지됩니다.",
    },
  },
  row: {
    launchCmd: "시작 명령",
    detectCmd: "감지 명령",
    expectedProcess: "프로세스",
    commandOverride: "명령 재정의",
    commandOverrideDesc: "이 에이전트의 실행 파일 경로",
    args: "시작 인자",
    argsDesc: "시작 명령 뒤에 붙는 인자",
    installCommand: "설치 명령",
    installCommandDesc:
      "한 번 클릭 설치용 셸 명령. 비우면 Pier 기본 절차입니다.",
    installCommandPlaceholder: "비우면 Pier 기본 설치 절차",
    updateCommand: "업데이트 명령",
    updateCommandDesc:
      "한 번 클릭 업데이트용 셸 명령. 비우면 Pier 기본 절차입니다.",
    updateCommandPlaceholder: "비우면 Pier 기본 업데이트 절차",
    uninstallCommand: "제거 명령",
    uninstallCommandDesc:
      "한 번 클릭 제거용 셸 명령. 비우면 Pier 기본 절차입니다.",
    uninstallCommandPlaceholder: "비우면 Pier 기본 제거 절차",
    env: "추가 환경 변수",
    envDesc: "이 에이전트를 시작할 때 더하는 변수",
  },
  sessionTitleRefine: {
    label: "세션 이름을 자동으로 지정",
    description:
      "첫 답장 후 탭 이름을 작업에 맞춥니다. 끄면 첫 메시지를 이름으로 씁니다.",
    failed: "세션 이름 지정 방식을 업데이트하지 못했습니다",
  },
  statusHooks: {
    label: "에이전트 상태 알림",
    description:
      "실행/대기 상태를 패널에 보이고 처리가 필요할 때 알립니다. 끄면 둘 다 멈춥니다.",
    failed: "에이전트 상태 알림을 업데이트하지 못했습니다",
  },
} as const;
