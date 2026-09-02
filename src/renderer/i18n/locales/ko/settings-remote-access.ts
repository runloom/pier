/** 설정 · 원격 접속 섹션 문구 (M1 모바일 컴패니언 연결). */
export const settingsRemoteAccess = {
  title: "원격 접속",
  description: "같은 네트워크의 모바일 기기를 이 워크스페이스에 페어링합니다.",
  boundaryTitle: "연결 보안",
  boundaryBody:
    "공식 원격 연결은 전 구간 암호화되어 어떤 네트워크에서도 안전합니다. 코드 직접 입력 페어링은 암호화되지 않은 같은 네트워크 직결을 사용하므로 공용 네트워크에서는 QR 페어링을 이용하세요.",
  enableLabel: "원격 접속 사용",
  enableDesc:
    "켜면 같은 네트워크의 기기가 QR 코드 또는 페어링 코드로 연결할 수 있습니다.",
  addressLabel: "동일 네트워크 주소",
  generateCode: "페어링 코드 생성",
  pairingHint:
    "모바일 기기로 QR 코드를 스캔하거나 6자리 코드를 직접 입력하세요.",
  copyPayload: "페어링 내용 복사",
  copyPayloadDone: "복사했습니다. 휴대폰에서 붙여넣으세요.",
  copyPayloadFailedTitle: "페어링 내용을 복사할 수 없습니다",
  codeExpiresIn: "페어링 코드가 {{time}} 후 만료됩니다",
  devicesTitle: "페어링된 기기",
  devicesEmpty: "페어링된 기기가 없습니다.",
  deviceMeta: "{{shell}} · 최근 온라인 {{time}}",
  revoke: "해지",
  revokeConfirmTitle: "기기 해지",
  revokeConfirmBody:
    "해지하면 「{{name}}」이 즉시 연결 해제되며, 다시 연결하려면 재페어링이 필요합니다.",
  shell: {
    web: "Web",
    app: "App",
    miniprogram: "미니 프로그램",
  },
  remoteTitle: "외부에서 원격 접속",
  remoteDesc:
    "로컬 네트워크를 벗어나도 공식 원격 연결로 이 작업 공간을 확인하고 조작할 수 있습니다.",
  remoteStatusLabel: "연결 상태",
  remoteState: {
    stopped: "연결 안 됨",
    connecting: "연결 중…",
    connected: "연결됨",
    backoff: "다시 연결 중…",
  },
  keepAwakeHint:
    "이 컴퓨터를 켜 두고 원격 접속을 활성화하면 휴대폰에서 언제든 연결할 수 있습니다.",
  toggleFailedTitle: "원격 접속 설정을 변경할 수 없습니다",
  generateFailedTitle: "페어링 코드를 생성할 수 없습니다",
  revokeFailedTitle: "기기를 해지할 수 없습니다",
} as const;
