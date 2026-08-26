import { PIER, PIER_BROADCAST } from "../ipc-channels.ts";
import type { PierCommand } from "./commands.ts";

/**
 * Read-only Host API surface for `pier/host`. Discipline gate, not a sandbox:
 * canvases still run in the renderer realm. Main `authorizeCommand` with
 * client kind `canvas` is the backstop.
 *
 * Materials catalog, `host.inspect()`, and this allowlist are one contract.
 */
export const CANVAS_HOST_ALLOWED_COMMANDS = [
  "app.snapshot",
  "app.status",
  "environment.snapshot",
  "environment.worktreeBinding",
  "file.drafts.get",
  "file.drafts.listDiagnostics",
  "file.drafts.listKeys",
  "file.exists",
  "file.inspectPathImpact",
  "file.list",
  "file.readDocument",
  "file.readText",
  "file.stat",
  "git.getDiffPatch",
  "git.getStatus",
  "git.listBranches",
  "git.listIgnored",
  "git.searchBranches",
  "git.searchCommits",
  "git.stashList",
  "notifications.get",
  "notifications.list",
  "panel.list",
  "plugin.inspect",
  "plugin.list",
  "pluginSettings.getAll",
  "pluginData.snapshot",
  "pluginData.watchStart",
  "pluginData.watchStop",
  "pluginAction.invoke",
  "preferences.read",
  "settings.open",
  "usageData.refresh",
  "run.backgroundSnapshot",
  "run.list",
  "run.output",
  "run.recent",
  "run.runsSnapshot",
  "run.status",
  "shellEnvironment.status",
  "terminal.get",
  "terminal.list",
  "terminal.profile.list",
  "terminal.profile.read",
  "terminalStatusBar.prefs.getAll",
  "window.list",
  "workspace.layout.read",
  "worktree.check",
  "worktree.creationDefaults",
  "worktree.get",
  "worktree.list",
] as const satisfies readonly PierCommand["type"][];

export type CanvasHostCommandType =
  (typeof CANVAS_HOST_ALLOWED_COMMANDS)[number];

export type CanvasHostCommand = Extract<
  PierCommand,
  { type: CanvasHostCommandType }
>;

export const CANVAS_HOST_ALLOWED_CHANNELS = [
  PIER_BROADCAST.ENVIRONMENTS_CHANGED,
  PIER_BROADCAST.FILE_CHANGED,
  PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED,
  PIER_BROADCAST.GIT_CHANGED,
  PIER_BROADCAST.NOTIFICATION_CENTER_CHANGED,
  PIER_BROADCAST.PLUGIN_DATA_CHANGED,
  PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED,
  PIER_BROADCAST.PLUGINS_CHANGED,
  PIER_BROADCAST.PREFERENCES_CHANGED,
  PIER_BROADCAST.TASKS_RUNS_CHANGED,
  PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED,
  PIER_BROADCAST.USAGE_DATA_CHANGED,
] as const;

export type CanvasHostChannel = (typeof CANVAS_HOST_ALLOWED_CHANNELS)[number];

export type CanvasHostSnapshotId =
  | "foreground-activity"
  | "resources"
  | "usage-data";

export type CanvasHostWatchTarget = CanvasHostChannel | CanvasHostSnapshotId;

/** Existing FA snapshot invoke (historical `pier:` wire, not `pier://`). */
export const CANVAS_HOST_FOREGROUND_ACTIVITY_SNAPSHOT =
  "pier:foreground-activity:snapshot";

const SNAPSHOT_ALIASES: Readonly<Record<string, CanvasHostSnapshotId>> = {
  "foreground-activity": "foreground-activity",
  [CANVAS_HOST_FOREGROUND_ACTIVITY_SNAPSHOT]: "foreground-activity",
  [PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED]: "foreground-activity",
  "pier-resource": "resources",
  resources: "resources",
  [PIER.PIER_RESOURCE_SNAPSHOT]: "resources",
  "usage-data": "usage-data",
  [PIER.USAGE_DATA_SNAPSHOT]: "usage-data",
  [PIER_BROADCAST.USAGE_DATA_CHANGED]: "usage-data",
};

/**
 * 解析插件数据投影 watch 目标 `"plugin:<pluginId>/<key>"`。
 *
 * 投影数据的顶层保留键（插件不得占用）：`payload`、`key`、`pluginId`。
 * 信封统一为 `{ key, pluginId, ...数据 }`：对象 payload 走扁平合并
 * （信封字段之外即数据，见 {@link extractPluginDataEvent}）；非对象
 * payload 则包装为 `{ key, pluginId, payload }`。
 */
export function parsePluginDataWatchTarget(
  target: string
): { key: string; pluginId: string } | null {
  if (!target.startsWith("plugin:")) {
    return null;
  }
  const rest = target.slice("plugin:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    return null;
  }
  const pluginId = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  return { key, pluginId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 广播事件只按 pluginId/key 过滤；两种 payload 形状信封字段一致。 */
export function isPluginDataEventFor(
  event: unknown,
  target: { key: string; pluginId: string }
): boolean {
  return (
    isRecord(event) &&
    event.pluginId === target.pluginId &&
    event.key === target.key
  );
}

/**
 * 提取插件数据投影事件的数据：对象 payload 扁平合并时剥掉信封字段
 * （key/pluginId）后剩余属性即数据；非对象 payload 经 `{payload,...}`
 * 包装，直接取 `payload` 键。非记录事件返回 null。
 */
export function extractPluginDataEvent(event: unknown): unknown {
  if (!isRecord(event)) {
    return null;
  }
  if ("payload" in event) {
    return event.payload;
  }
  const { key: _envelopeKey, pluginId: _envelopePluginId, ...data } = event;
  return data;
}

export const CANVAS_HOST_SNAPSHOT_IDS: readonly CanvasHostSnapshotId[] = [
  "foreground-activity",
  "resources",
  "usage-data",
];

const SNAPSHOT_LIVE_CHANNELS: Readonly<
  Partial<Record<CanvasHostSnapshotId, CanvasHostChannel>>
> = {
  "foreground-activity": PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED,
  "usage-data": PIER_BROADCAST.USAGE_DATA_CHANGED,
};

const ALLOWED_COMMAND_SET = new Set<string>(CANVAS_HOST_ALLOWED_COMMANDS);
const ALLOWED_CHANNEL_SET = new Set<string>(CANVAS_HOST_ALLOWED_CHANNELS);

export function isCanvasHostCommandAllowed(
  type: string
): type is CanvasHostCommandType {
  return ALLOWED_COMMAND_SET.has(type);
}

export function isCanvasHostChannelAllowed(
  channel: string
): channel is CanvasHostChannel {
  return ALLOWED_CHANNEL_SET.has(channel);
}

export function normalizeCanvasHostSnapshotId(
  channel: string
): CanvasHostSnapshotId | null {
  return SNAPSHOT_ALIASES[channel] ?? null;
}

export function isCanvasHostSnapshotAllowed(channel: string): boolean {
  return normalizeCanvasHostSnapshotId(channel) !== null;
}

/** Broadcast that keeps a snapshot id live. Resources poll; they have none. */
export function canvasHostLiveChannel(
  target: string
): CanvasHostChannel | null {
  if (isCanvasHostChannelAllowed(target)) {
    return target;
  }
  const snapshotId = normalizeCanvasHostSnapshotId(target);
  return snapshotId ? (SNAPSHOT_LIVE_CHANNELS[snapshotId] ?? null) : null;
}

/**
 * Broadcast channel heads that share a command prefix.
 * Does not invent capabilities; it only joins two existing sources.
 */
const CHANNEL_DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  environments: "environment",
  notification: "notifications",
  "notification-center": "notifications",
  "plugin-settings": "pluginSettings",
  plugins: "plugin",
  tasks: "run",
  "terminal-status-bar": "terminalStatusBar",
};

const COMMAND_DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  usageData: "usage-data",
};

export function canvasHostDomainIdFromCommand(type: string): string {
  const head = type.split(".")[0] ?? type;
  return COMMAND_DOMAIN_ALIASES[head] ?? head;
}

export function canvasHostDomainIdFromChannel(channel: string): string {
  const trimmed = channel.replace(/^pier:\/\//, "").replace(/^pier:/, "");
  const head = trimmed.split(":")[0] ?? trimmed;
  return CHANNEL_DOMAIN_ALIASES[head] ?? head;
}

export interface CanvasHostInspectField {
  name: string;
  optional: boolean;
  type: string;
}

export interface CanvasHostInspectCommand {
  fields: readonly CanvasHostInspectField[];
  type: CanvasHostCommandType;
}

export interface CanvasHostInspectDomain {
  channels: readonly CanvasHostChannel[];
  commands: readonly CanvasHostInspectCommand[];
  exemplar: CanvasHostCommandType | null;
  id: string;
  snapshots: readonly CanvasHostSnapshotId[];
}

export interface CanvasHostInspect {
  channels: readonly CanvasHostChannel[];
  commands: readonly CanvasHostCommandType[];
  domains: readonly CanvasHostInspectDomain[];
  snapshots: readonly CanvasHostSnapshotId[];
}

export interface CanvasHost {
  inspect: () => CanvasHostInspect;
  invoke: (command: CanvasHostCommand) => Promise<unknown>;
  snapshot: (id: CanvasHostSnapshotId) => Promise<unknown>;
  subscribe: (
    channel: CanvasHostChannel,
    listener: (payload: unknown) => void
  ) => () => void;
}

const CANVAS_HOST_DOMAIN_EXEMPLARS: Readonly<
  Partial<Record<string, CanvasHostCommandType>>
> = {
  file: "file.list",
  git: "git.getStatus",
};

function canvasHostExemplarRank(type: string): number {
  if (type.endsWith(".list")) {
    return 0;
  }
  if (type.endsWith(".getStatus") || type.endsWith(".status")) {
    return 1;
  }
  if (type.endsWith(".snapshot")) {
    return 2;
  }
  if (type.endsWith(".read") || type.endsWith(".get")) {
    return 3;
  }
  return 10;
}

/** Docs exemplar for a domain. Prefers list/status/read over drafts internals. */
export function canvasHostExemplarCommandType(
  domainId: string,
  commandTypes: readonly string[]
): string | null {
  const preferred = CANVAS_HOST_DOMAIN_EXEMPLARS[domainId];
  if (preferred && commandTypes.includes(preferred)) {
    return preferred;
  }
  const ranked = [...commandTypes].sort(
    (left, right) =>
      canvasHostExemplarRank(left) - canvasHostExemplarRank(right) ||
      left.localeCompare(right)
  )[0];
  return ranked ?? null;
}

function canvasHostInspectDomains(): CanvasHostInspectDomain[] {
  const grouped = new Map<
    string,
    {
      channels: CanvasHostChannel[];
      commands: CanvasHostInspectCommand[];
      snapshots: CanvasHostSnapshotId[];
    }
  >();
  const bucket = (id: string) => {
    const existing = grouped.get(id);
    if (existing) {
      return existing;
    }
    const created = {
      channels: [] as CanvasHostChannel[],
      commands: [] as CanvasHostInspectCommand[],
      snapshots: [] as CanvasHostSnapshotId[],
    };
    grouped.set(id, created);
    return created;
  };
  for (const type of CANVAS_HOST_ALLOWED_COMMANDS) {
    bucket(canvasHostDomainIdFromCommand(type)).commands.push({
      fields: [],
      type,
    });
  }
  for (const channel of CANVAS_HOST_ALLOWED_CHANNELS) {
    bucket(canvasHostDomainIdFromChannel(channel)).channels.push(channel);
  }
  for (const id of CANVAS_HOST_SNAPSHOT_IDS) {
    bucket(id).snapshots.push(id);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => {
      const exemplar = canvasHostExemplarCommandType(
        id,
        value.commands.map((command) => command.type)
      );
      return {
        channels: value.channels,
        commands: value.commands,
        exemplar:
          exemplar && isCanvasHostCommandAllowed(exemplar) ? exemplar : null,
        id,
        snapshots: value.snapshots,
      };
    });
}

export function canvasHostInspect(): CanvasHostInspect {
  return {
    channels: CANVAS_HOST_ALLOWED_CHANNELS,
    commands: CANVAS_HOST_ALLOWED_COMMANDS,
    domains: canvasHostInspectDomains(),
    snapshots: CANVAS_HOST_SNAPSHOT_IDS,
  };
}

export function canvasHostPermissionError(
  message: string
): Error & { code: "permission_denied" } {
  const error = new Error(message) as Error & { code: "permission_denied" };
  error.code = "permission_denied";
  return error;
}

export function canvasHostUnsupportedError(
  message: string
): Error & { code: "unsupported" } {
  const error = new Error(message) as Error & { code: "unsupported" };
  error.code = "unsupported";
  return error;
}
