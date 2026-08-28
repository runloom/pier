export const canvas = {
  file: {
    conflict:
      "{{name}}이(가) 디스크에서 변경되었습니다. 다시 저장하기 전에 다시 불러오세요.",
    invalidName: "캔버스는 같은 폴더의 파일만 사용할 수 있습니다.",
    readFailed: "{{name}}을(를) 읽지 못했습니다. 텍스트 파일이 아닙니다.",
    unavailable: "이 캔버스는 파일에서 열리지 않아 저장할 수 없습니다.",
    writeFailed: "{{name}}을(를) 저장하지 못했습니다.",
  },
  command: {
    cancelLabel: "취소",
    confirmBody: "이 캔버스가 실행하려는 명령:\n\n{{command}}",
    confirmLabel: "실행",
    confirmTitle: "이 명령을 실행할까요?",
    failed: "명령을 실행하지 못했습니다.",
    unavailable: "이 캔버스는 파일에서 열리지 않아 명령을 실행할 수 없습니다.",
  },
  blocks: {
    activityEmpty: "이 윈도우에 활동이 없습니다",
    activityEmptyHint: "에이전트를 시작하거나 터미널에서 명령을 실행하세요.",
    activityNeedsYou: "처리가 필요합니다",
    activityRunning: "실행 중",
    activityInProgress: "진행 중",
    resourcesEmpty: "리소스 데이터가 아직 없습니다",
    resourcesEmptyHint:
      "이 캔버스를 열어 두는 동안 Pier가 이 Mac을 측정합니다.",
    resourcesError: "리소스를 읽지 못했습니다",
    resourcesCpu: "관련 CPU",
    resourcesMemory: "관련 메모리",
    resourcesTerminals: "터미널",
    costEmpty: "비용 데이터가 아직 없습니다",
    costEmptyHint: "지원되는 AI CLI를 사용하면 합계가 나타납니다.",
    costError: "비용을 읽지 못했습니다",
    costPeriod: "비용 · 최근 {{count}}일",
    costTokens: "토큰 · 최근 {{count}}일",
  },
} as const;
