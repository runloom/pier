/** 設定 · リモートアクセス区分の文案（M1 モバイルコンパニオン接続）。 */
export const settingsRemoteAccess = {
  title: "リモートアクセス",
  description:
    "同じネットワーク内のモバイルデバイスをこのワークスペースにペアリングします。",
  boundaryTitle: "接続の安全性",
  boundaryBody:
    "公式リモート接続は全経路が暗号化され、どのネットワークでも安全に使えます。コード手入力のペアリングは非暗号化の同一ネットワーク直結を使うため、公共ネットワークでは QR ペアリングをご利用ください。",
  enableLabel: "リモートアクセスを有効化",
  enableDesc:
    "有効にすると、同じネットワークのデバイスが QR コードまたはペアリングコードで接続できます。",
  addressLabel: "同一ネットワークアドレス",
  generateCode: "ペアリングコードを生成",
  pairingHint:
    "モバイルデバイスで QR コードをスキャンするか、6 桁のコードを手動で入力してください。",
  copyPayload: "ペアリング内容をコピー",
  copyPayloadDone: "コピーしました。スマートフォンで貼り付けてください。",
  copyPayloadFailedTitle: "ペアリング内容をコピーできません",
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
  remoteTitle: "外出先からのリモート接続",
  remoteDesc:
    "ローカルネットワークの外からでも、公式のリモート接続でこのワークスペースを確認・操作できます。",
  remoteStatusLabel: "接続状態",
  remoteState: {
    stopped: "未接続",
    connecting: "接続中…",
    connected: "接続済み",
    backoff: "再接続中…",
  },
  keepAwakeHint:
    "このパソコンをスリープさせず、リモートアクセスを有効にしておくと、スマホからいつでも接続できます。",
  toggleFailedTitle: "リモートアクセス設定を更新できません",
  generateFailedTitle: "ペアリングコードを生成できません",
  revokeFailedTitle: "デバイスを取り消せません",
} as const;
