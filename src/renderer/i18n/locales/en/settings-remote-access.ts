/** Settings · Remote access section copy (M1 mobile companion pairing). */
export const settingsRemoteAccess = {
  title: "Remote Access",
  description:
    "Let mobile devices on the same network pair with this workspace.",
  boundaryTitle: "Connection security",
  boundaryBody:
    "The official remote connection is fully encrypted and safe on any network; manual-code pairing uses the unencrypted same-network entry, so prefer QR pairing on public networks.",
  enableLabel: "Enable remote access",
  enableDesc:
    "When on, devices on the same network can pair by scanning a QR code or entering a code.",
  addressLabel: "LAN address",
  generateCode: "Generate pairing code",
  pairingHint:
    "Scan the QR code with your mobile device, or enter the 6-digit code manually.",
  copyPayload: "Copy pairing text",
  copyPayloadDone: "Copied. Paste it on your phone.",
  copyPayloadFailedTitle: "Couldn't copy the pairing text",
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
  remoteTitle: "Remote access away from home",
  remoteDesc:
    "View and act on this workspace from outside your local network over the official remote connection.",
  remoteStatusLabel: "Connection status",
  remoteState: {
    stopped: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    backoff: "Reconnecting…",
  },
  keepAwakeHint:
    "Keep this computer awake with remote access on so your phone can connect anytime.",
} as const;
