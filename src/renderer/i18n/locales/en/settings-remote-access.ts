/** Settings · Remote access section copy (M1 mobile companion pairing). */
export const settingsRemoteAccess = {
  title: "Remote Access",
  description:
    "Let mobile devices on the same network pair with this workspace.",
  boundaryTitle: "Only use on trusted home or office networks",
  boundaryBody:
    "Remote access uses an unencrypted ws:// connection, and paired devices can view and control this workspace. Do not enable it on public networks.",
  enableLabel: "Enable remote access",
  enableDesc:
    "When on, devices on the same network can pair by scanning a QR code or entering a code.",
  addressLabel: "LAN address",
  generateCode: "Generate pairing code",
  pairingHint:
    "Scan the QR code with your mobile device, or enter the 6-digit code manually.",
  codeExpiresIn: "Pairing code expires in {{time}}",
  devicesTitle: "Paired devices",
  devicesEmpty: "No paired devices yet.",
  deviceMeta: "{{shell}} · Last seen {{time}}",
  revoke: "Revoke",
  revokeConfirmTitle: "Revoke device",
  revokeConfirmBody:
    'Revoking disconnects "{{name}}" immediately; it must pair again to reconnect.',
  shell: {
    web: "Web",
    app: "App",
    miniprogram: "Mini program",
  },
  toggleFailedTitle: "Couldn't update remote access settings",
  generateFailedTitle: "Couldn't generate a pairing code",
  revokeFailedTitle: "Couldn't revoke the device",
} as const;
