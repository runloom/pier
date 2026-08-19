import {
  CANVAS_HOST_SNAPSHOT_IDS,
  type CanvasHostInspectField,
  canvasHostDomainIdFromChannel,
  canvasHostDomainIdFromCommand,
  isCanvasHostChannelAllowed,
  isCanvasHostCommandAllowed,
} from "@shared/contracts/canvas-host.ts";
import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { z } from "zod";

export type HostApiField = CanvasHostInspectField;

export interface HostApiCommand {
  fields: readonly HostApiField[];
  type: string;
}

export interface HostApiEvent {
  channel: string;
  kind: "broadcast" | "snapshot";
}

export interface HostApiDomain {
  commands: readonly HostApiCommand[];
  events: readonly HostApiEvent[];
  id: string;
}

/**
 * Broadcast channel heads that share a PierCommand prefix.
 * Does not invent capabilities; it only joins two existing sources.
 */
const PROJECT_CHANNEL_DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  "app-update": "appUpdate",
  "command-palette-mru": "commandPaletteMru",
  "live-modules": "liveModules",
  "pier-resource": "resources",
  "plugin-rpc": "plugin",
  "project-skills": "skills",
  "worktree-create": "worktree",
};

const HOST_API_SNAPSHOTS: readonly HostApiEvent[] = [
  { channel: PIER.PIER_RESOURCE_SNAPSHOT, kind: "snapshot" },
  { channel: PIER.USAGE_DATA_SNAPSHOT, kind: "snapshot" },
];

function hasUnwrap(
  schema: z.ZodType
): schema is z.ZodType & { unwrap: () => z.ZodType } {
  return "unwrap" in schema && typeof schema.unwrap === "function";
}

function hasShape(
  schema: z.ZodType
): schema is z.ZodType & { shape: Record<string, z.ZodType> } {
  return (
    "shape" in schema &&
    typeof schema.shape === "object" &&
    schema.shape !== null
  );
}

function hasOptions(
  schema: z.ZodType
): schema is z.ZodType & { options: readonly unknown[] } {
  return "options" in schema && Array.isArray(schema.options);
}

function hasLiteralValue(
  schema: z.ZodType
): schema is z.ZodType & { value: string | number | boolean } {
  return "value" in schema;
}

function hasPipeIn(schema: z.ZodType): schema is z.ZodType & { in: z.ZodType } {
  return "in" in schema;
}

function hasElement(
  schema: z.ZodType
): schema is z.ZodType & { element: z.ZodType } {
  return "element" in schema;
}

function peel(schema: z.ZodType): {
  core: z.ZodType;
  nullable: boolean;
  optional: boolean;
} {
  let optional = false;
  let nullable = false;
  let current = schema;
  for (;;) {
    const type = current.def.type;
    if ((type === "optional" || type === "default") && hasUnwrap(current)) {
      optional = true;
      current = current.unwrap();
      continue;
    }
    if (type === "nullable" && hasUnwrap(current)) {
      nullable = true;
      current = current.unwrap();
      continue;
    }
    if (type === "readonly" && hasUnwrap(current)) {
      current = current.unwrap();
      continue;
    }
    if (type === "pipe" && hasPipeIn(current)) {
      current = current.in;
      continue;
    }
    break;
  }
  return { core: current, nullable, optional };
}

function unwrap(schema: z.ZodType): z.ZodType {
  return peel(schema).core;
}

function zodToTs(schema: z.ZodType, depth = 0): string {
  const { core, nullable, optional } = peel(schema);
  let text = zodCoreToTs(core, depth);
  if (nullable) {
    text = `${text} | null`;
  }
  if (optional) {
    text = `${text} | undefined`;
  }
  return text;
}

function zodCoreToTs(schema: z.ZodType, depth: number): string {
  if (depth > 3) {
    return "unknown";
  }
  const type = schema.def.type;
  if (type === "string" || type === "number" || type === "boolean") {
    return type;
  }
  if (type === "literal" && hasLiteralValue(schema)) {
    return JSON.stringify(schema.value);
  }
  if (type === "unknown" || type === "any") {
    return "unknown";
  }
  if (type === "array" && hasElement(schema)) {
    return `${zodToTs(schema.element, depth + 1)}[]`;
  }
  if (type === "enum" && hasOptions(schema)) {
    return schema.options
      .filter((option): option is string => typeof option === "string")
      .map((option) => JSON.stringify(option))
      .join(" | ");
  }
  if (type === "union" && hasOptions(schema)) {
    return schema.options
      .filter((option): option is z.ZodType => typeof option === "object")
      .map((option) => zodToTs(option, depth + 1))
      .join(" | ");
  }
  if (type === "object" && hasShape(schema)) {
    const entries = Object.entries(schema.shape);
    if (entries.length === 0) {
      return "object";
    }
    return `{ ${entries
      .map(([name, field]) => `${name}: ${zodToTs(field, depth + 1)}`)
      .join("; ")} }`;
  }
  return "unknown";
}

function commandFromOption(schema: z.ZodType): HostApiCommand | null {
  const object = unwrap(schema);
  if (!hasShape(object)) {
    return null;
  }
  const typeField = object.shape.type;
  if (!typeField) {
    return null;
  }
  const literal = unwrap(typeField);
  if (!(hasLiteralValue(literal) && typeof literal.value === "string")) {
    return null;
  }
  const fields = Object.entries(object.shape)
    .filter(([name]) => name !== "type")
    .map(([name, field]) => ({
      name,
      optional: peel(field).optional,
      type: zodToTs(field),
    }));
  return { fields, type: literal.value };
}

function domainIdFromCommandType(commandType: string): string {
  return canvasHostDomainIdFromCommand(commandType);
}

function domainIdFromChannel(channel: string): string {
  const trimmed = channel.replace(/^pier:\/\//, "").replace(/^pier:/, "");
  const head = trimmed.split(":")[0] ?? trimmed;
  return (
    PROJECT_CHANNEL_DOMAIN_ALIASES[head] ??
    canvasHostDomainIdFromChannel(channel)
  );
}

function sortCommands(commands: HostApiCommand[]): HostApiCommand[] {
  return [...commands].sort((left, right) =>
    left.type.localeCompare(right.type)
  );
}

function sortEvents(events: HostApiEvent[]): HostApiEvent[] {
  return [...events].sort((left, right) =>
    left.channel.localeCompare(right.channel)
  );
}

export function listPierCommandTypes(): string[] {
  return projectHostApiDomains().flatMap((domain) =>
    domain.commands.map((command) => command.type)
  );
}

export function projectHostApiDomains(): HostApiDomain[] {
  const byId = new Map<
    string,
    { commands: HostApiCommand[]; events: HostApiEvent[] }
  >();

  function bucket(id: string): {
    commands: HostApiCommand[];
    events: HostApiEvent[];
  } {
    const existing = byId.get(id);
    if (existing) {
      return existing;
    }
    const created = { commands: [], events: [] };
    byId.set(id, created);
    return created;
  }

  for (const option of pierCommandSchema.options) {
    const command = commandFromOption(option);
    if (!command) {
      continue;
    }
    bucket(domainIdFromCommandType(command.type)).commands.push(command);
  }

  for (const channel of Object.values(PIER_BROADCAST)) {
    bucket(domainIdFromChannel(channel)).events.push({
      channel,
      kind: "broadcast",
    });
  }

  for (const snapshot of HOST_API_SNAPSHOTS) {
    bucket(domainIdFromChannel(snapshot.channel)).events.push(snapshot);
  }

  return [...byId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => ({
      commands: sortCommands(value.commands),
      events: sortEvents(value.events),
      id,
    }));
}

/**
 * Canvas-allowed Host API. Same surface as `host.inspect()`:
 * canvas-allowed commands, broadcasts, and canonical snapshot ids.
 */
export function canvasHostApiDomains(): HostApiDomain[] {
  return projectHostApiDomains()
    .map((domain) => {
      const commands = domain.commands.filter((command) =>
        isCanvasHostCommandAllowed(command.type)
      );
      const broadcasts = domain.events.filter(
        (event) =>
          event.kind === "broadcast" &&
          isCanvasHostChannelAllowed(event.channel)
      );
      const snapshots: HostApiEvent[] = CANVAS_HOST_SNAPSHOT_IDS.filter(
        (id) => id === domain.id
      ).map((id) => ({ channel: id, kind: "snapshot" as const }));
      return {
        commands,
        events: sortEvents([...broadcasts, ...snapshots]),
        id: domain.id,
      };
    })
    .filter((domain) => domain.commands.length + domain.events.length > 0);
}
