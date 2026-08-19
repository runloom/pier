/** 설정 · 알림(settings.ts에서 분리). */
export const settingsNotifications = {
  enabled: "에이전트가 처리를 기다릴 때 알림",
  enabledDesc:
    "에이전트가 당신을 기다릴 때: Pier가 맨 앞이면 앱 안 카드, 아니면 OS 알림. 꺼도 제목 표시줄 개수는 갱신됩니다.",
  turnNotifyMode: "턴이 끝나면 알림",
  turnNotifyModeDesc:
    "턴이 끝날 때 알립니다. 기본: 해당 에이전트 윈도우가 앞에 없을 때만. 앱 안과 OS는 동시에 뜨지 않습니다.",
  turnNotifyModeOptions: {
    off: "안 함",
    unfocused: "윈도우가 앞에 없을 때만",
    "panel-unfocused": "패널이 앞에 없을 때만",
    always: "항상",
  },
  error: "에이전트 오류 알림",
  errorDesc: "에이전트가 오류일 때도 알립니다. 기본은 꺼짐입니다.",
  cooldownLabel: "에이전트별 간격",
  cooldownDesc:
    "같은 에이전트 OS 배너의 최소 간격(앱 안 카드는 제한하지 않음).",
  cooldown: {
    "60000": "1분",
    "180000": "3분",
    "600000": "10분",
  },
  sendTest: "테스트 알림 보내기",
  openSystemSettings: "시스템 설정 열기",
  testSent: "테스트 알림을 보냈습니다",
  testFailed: "테스트 알림에 실패했습니다",
  testFailedShort: "테스트 알림을 표시하지 못했습니다",
  testFailedDetail:
    "시스템 알림을 전달하지 못했습니다({{reason}}). 시스템 설정 → 알림에서 Pier를 허용한 뒤 다시 시도하세요.",
  testHint:
    "성공은 OS에 전달됐다는 뜻입니다. 맨 앞 배너는 숨겨질 수 있습니다. 알림 센터를 확인하세요.",
  openSettingsFailed: "시스템 설정을 열지 못했습니다. 다시 시도하세요",
  openSettingsManual:
    "OS 알림 설정을 열고 Pier를 허용한 다음 테스트 알림을 보내세요.",
  saveFailed: "알림 설정을 저장하지 못했습니다. 다시 시도하세요",
  hooksOffTitle: "에이전트 상태 알림이 꺼져 있습니다",
  hooksOffBody:
    "설정 → 에이전트에서 다시 켜기 전까지 처리 알림은 나오지 않습니다.",
  permission: {
    deniedTitle: "시스템 알림이 차단되어 있습니다",
    deniedBody: "시스템 설정에서 Pier 알림을 허용한 뒤 테스트 알림을 보내세요.",
    unsupportedTitle: "시스템 알림을 쓸 수 없습니다",
    unsupportedBody:
      "여기서는 OS 알림을 쓸 수 없습니다. 제목 표시줄 개수나 에이전트 목록을 보세요.",
    unknownTitle: "알림 권한을 아직 확인하지 않았습니다",
    unknownBody: "테스트 알림을 보내 OS 전달을 확인하세요.",
  },
  soundGroup: "알림음",
  soundGroupDesc:
    "에이전트 알림이 뜰 때 재생합니다. 알림 센터에만 남길 때는 무음입니다.",
  soundEnabled: "알림음 재생",
  soundEnabledDesc: "꺼도 알림은 나옵니다. 소리만 멈춥니다.",
  soundId: "음색",
  soundIdDesc: "시스템 알림음 또는 Pier 내장 음색을 씁니다.",
  soundPreview: "선택한 음색 미리 듣기",
  soundPreviewSystemHint:
    "시스템 음색은 여기서 미리 들을 수 없습니다. 다른 앱으로 전환한 뒤 아래 「테스트 알림 보내기」를 쓰세요.",
  soundPreviewFailed: "알림음을 재생하지 못했습니다. 다시 시도하세요",
  centerTitle: "알림 센터",
  centerDesc: "시스템 메시지 기록. 아래 스위치와 연결됩니다.",
  retention: "메시지 보관",
  retentionDesc: "오래된 메시지는 자동으로 정리됩니다.",
  retentionOptions: {
    "7": "7일",
    "30": "30일",
  },
  showBadge: "제목 표시줄에 읽지 않음 수 표시",
  showBadgeDesc: "끄면 종의 읽지 않음 배지가 숨습니다.",
  contentTitle: "무엇을 알릴지",
  contentDesc: "알릴 일을 고릅니다.",
  agentGroup: "에이전트",
  taskSystemGroup: "시스템",
  appUpdate: "앱 업데이트 알림",
  appUpdateDesc: "내려받은 뒤 재시작을 알립니다. 꺼도 알림 센터에는 남습니다.",
  deliveryTitle: "어떻게 알릴지",
  deliveryDesc: "끼어드는 방식을 제어합니다.",
  systemGroup: "시스템 알림",
  systemGroupDesc:
    "Pier 윈도우가 맨 앞이 아닐 때만 OS 알림. 그 외에는 앱 안 카드만입니다.",
  disturbGroup: "끼어들기 줄이기",
  disturbGroupDesc: "위 경로에 더해 끼어들기를 더 줄입니다.",
  dnd: "방해 금지",
  dndDesc:
    "오류 앱 안 카드만 띄웁니다. 나머지는 알림 센터로. 제목 표시줄 종에서 전환할 수 있습니다.",
  sound: {
    system: "시스템 기본",
    "abstract-sound1": "Abstract Sound 1",
    "abstract-sound2": "Abstract Sound 2",
    "abstract-sound3": "Abstract Sound 3",
    "abstract-sound4": "Abstract Sound 4",
    "cow-mooing": "Cow Mooing",
    "phone-vibration": "Phone Vibration",
    rooster: "Rooster",
    fahhhhh: "Fahhhhh",
  },
} as const;
