/** Settings → Terminal card for installing the packaged `pier` command. */
export const settingsCliCommand = {
  title: "pier 명령",
  description:
    "설치하면 터미널에서 pier를 실행해 이 Pier 윈도우를 제어할 수 있습니다.",
  statusLabel: "상태:",
  status: {
    installed: "{{path}}에 설치됨",
    notInstalled: "설치되지 않음",
    loading: "확인 중…",
  },
  reason: {
    dev: "개발 빌드는 pier 명령을 추가하지 않습니다. Pier 저장소에서 pnpm --silent cli:dev -- … 를 실행하세요.",
    unsupported: "이 시스템은 아직 pier 명령 설치를 지원하지 않습니다.",
    missingSource: "이 Pier 빌드에 pier 명령 파일이 없습니다.",
    conflict:
      "{{path}}에 다른 pier가 이미 있습니다. 제거한 뒤 다시 시도하세요.",
    needsAdmin: "macOS가 {{path}}에 pier를 추가하려고 암호를 묻습니다.",
  },
  install: "pier 명령 설치",
  installing: "설치 중…",
  uninstall: "pier 명령 제거",
  uninstalling: "제거 중…",
  installConfirmTitle: "pier 명령을 설치할까요?",
  installConfirmBody: "macOS가 {{path}}에 pier를 추가하려고 암호를 묻습니다.",
  uninstallConfirmTitle: "pier 명령을 제거할까요?",
  uninstallConfirmBody:
    "{{path}}에서 pier를 제거합니다. 나중에 다시 설치할 수 있습니다.",
  installFailed: "pier 명령을 설치하지 못했습니다",
  uninstallFailed: "pier 명령을 제거하지 못했습니다",
  statusFailed: "pier 명령 상태를 읽지 못했습니다. 다시 시도하세요",
  toastInstalled: "pier 명령을 설치했습니다",
  toastAlreadyInstalled: "pier 명령이 이미 설치되어 있습니다",
  toastRemoved: "pier 명령을 제거했습니다",
} as const;
