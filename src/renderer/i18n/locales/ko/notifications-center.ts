export const notificationsCenter = {
  action: {
    goToAgent: "지금 처리",
    openAgent: "대화 열기",
    viewAgentOutput: "출력 보기",
  },
  attention: {
    error: "에이전트에 오류가 발생했습니다",
    ready: "턴이 끝났습니다",
    waiting: "처리 필요",
  },
  actionFailed: "알림을 업데이트하지 못했습니다. 다시 시도하세요",
  bell: {
    aria: "알림, 읽지 않음 {{count}}건",
    ariaEmpty: "알림",
  },
  dnd: {
    off: "방해 금지 끄기",
    on: "방해 금지",
  },
  empty: "알림이 없습니다",
  emptyDetail: "시스템 메시지가 여기에 나타납니다",
  header: {
    markAllRead: "모두 읽음으로 표시",
    title: "알림",
    unread: "읽지 않음 {{count}}건",
  },
  loadMore: "스크롤하여 더 보기…",
  repeat: "×{{count}}",
  shellEnv: {
    failedBody:
      "도구 경로가 터미널과 다를 수 있습니다. 설정 → 터미널을 연 다음 다시 불러오세요.",
    failedTitle: "작업 환경이 터미널과 다를 수 있습니다",
    openSettings: "터미널 설정 열기",
  },
  source: {
    pluginDetail: "플러그인 {{source}}",
    agent: "에이전트",
    plugin: "플러그인",
    system: "시스템",
    task: "작업",
  },
} as const;
