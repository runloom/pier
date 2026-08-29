export const dialog = {
  appQuit: {
    activityKind: {
      agent: "에이전트",
      shell: "터미널",
      task: "작업",
    },
    activityListWithOverflow: "{{activities}} 외 {{count}}개",
    activityName: "{{label}}({{kind}})",
    activitySeparator: ", ",
    cancel: "취소",
    noActivityDetail: "종료하기 전에 윈도우 배치를 저장합니다.",
    multipleActivityDetail:
      "{{activities}}이(가) 아직 실행 중입니다.\n종료하면 멈춥니다.",
    quit: "종료",
    shellFallback: "터미널 명령",
    singleActivityDetail:
      "{{activity}}이(가) 아직 실행 중입니다.\n종료하면 멈춥니다.",
    title: "Pier를 종료할까요?",
  },
  panelClose: {
    cancel: "취소",
    close: "패널 닫기",
    multipleActivityDetail:
      "{{activities}}이(가) 아직 실행 중입니다.\n이 패널을 닫으면 멈춥니다.",
    singleActivityDetail:
      "{{activity}}이(가) 아직 실행 중입니다.\n이 패널을 닫으면 멈춥니다.",
    title: "패널을 닫을까요?",
  },
  cancel: "취소",
  close: "닫기",
  error: {
    invalid: "입력이 올바르지 않습니다",
  },
  imagePreview: {
    actualSize: "실제 크기",
    controlsLabel: "이미지 조작",
    copyImage: "이미지 복사",
    copyImageFailed: "이미지를 복사하지 못했습니다",
    copyImageNotReady: "이미지가 나타난 다음 다시 복사하세요.",
    fit: "윈도우에 맞춤",
    loadFailedDescription:
      "이미지를 불러오지 못했거나, 연 뒤에 변경되었습니다.",
    loadFailedTitle: "이미지를 표시할 수 없습니다",
    loading: "이미지 불러오는 중",
    imageCopied: "이미지를 복사했습니다",
    title: "이미지 미리보기",
    viewerLabel: "이미지 미리보기",
    zoomIn: "확대",
    zoomLevel: "확대/축소",
    zoomOut: "축소",
  },
  contentPreview: {
    title: "미리보기",
  },
  ok: "확인",
} as const;
