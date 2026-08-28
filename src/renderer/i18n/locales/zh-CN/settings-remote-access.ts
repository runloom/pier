/** 设置 · 远程访问分区文案（M1 移动端伴侣接入，Task 10）。 */
export const settingsRemoteAccess = {
  title: "远程访问",
  description: "允许同一网络中的移动设备配对接入此工作区。",
  boundaryTitle: "仅在可信的家庭或办公网络使用",
  boundaryBody:
    "远程访问使用未加密的 ws:// 连接，已配对设备可查看并操作此工作区。请勿在公共网络开启。",
  enableLabel: "启用远程访问",
  enableDesc: "开启后，同网设备可扫码或输入配对码接入。",
  addressLabel: "同网地址",
  generateCode: "生成配对码",
  pairingHint: "用移动设备扫描二维码，或手动输入 6 位配对码。",
  codeExpiresIn: "配对码将于 {{time}} 后失效",
  devicesTitle: "已配对设备",
  devicesEmpty: "暂无已配对设备。",
  deviceMeta: "{{shell}} · 最近在线 {{time}}",
  revoke: "吊销",
  revokeConfirmTitle: "吊销设备",
  revokeConfirmBody: "吊销后「{{name}}」将立即断开，需重新配对才能再次接入。",
  shell: {
    web: "Web",
    app: "App",
    miniprogram: "小程序",
  },
  toggleFailedTitle: "无法更新远程访问设置",
  generateFailedTitle: "无法生成配对码",
  revokeFailedTitle: "无法吊销设备",
} as const;
