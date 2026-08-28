/** 設定 · リモートアクセス区分の文案（M1 モバイルコンパニオン接続）。 */
export const settingsRemoteAccess = {
  title: "リモートアクセス",
  description:
    "同じネットワーク内のモバイルデバイスをこのワークスペースにペアリングします。",
  boundaryTitle: "信頼できる家庭・オフィスネットワークでのみ使用",
  boundaryBody:
    "リモートアクセスは暗号化されていない ws:// 接続を使用し、ペアリング済みデバイスはこのワークスペースを閲覧・操作できます。公共ネットワークでは有効にしないでください。",
  enableLabel: "リモートアクセスを有効化",
  enableDesc:
    "有効にすると、同じネットワークのデバイスが QR コードまたはペアリングコードで接続できます。",
  addressLabel: "同一ネットワークアドレス",
  generateCode: "ペアリングコードを生成",
  pairingHint:
    "モバイルデバイスで QR コードをスキャンするか、6 桁のコードを手動で入力してください。",
  codeExpiresIn: "ペアリングコードは {{time}} 後に失効します",
  devicesTitle: "ペアリング済みデバイス",
  devicesEmpty: "ペアリング済みのデバイスはありません。",
  deviceMeta: "{{shell}} · 最終オンライン {{time}}",
  revoke: "取り消す",
  revokeConfirmTitle: "デバイスを取り消す",
  revokeConfirmBody:
    "取り消すと「{{name}}」は直ちに切断され、再接続には再ペアリングが必要です。",
  shell: {
    web: "Web",
    app: "App",
    miniprogram: "ミニプログラム",
  },
  toggleFailedTitle: "リモートアクセス設定を更新できません",
  generateFailedTitle: "ペアリングコードを生成できません",
  revokeFailedTitle: "デバイスを取り消せません",
} as const;
