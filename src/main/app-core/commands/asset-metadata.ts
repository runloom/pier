import type { CommandMetadata } from "../command-metadata.ts";

export const ASSET_COMMAND_METADATA: Record<
  | "rules.snapshot"
  | "rules.read"
  | "rules.write"
  | "rules.ensure"
  | "agentMcp.catalog"
  | "agentMcp.reveal"
  | "agentMcp.open"
  | "memory.enable"
  | "memory.disable"
  | "memory.status"
  | "memory.list"
  | "memory.deleteObservation"
  | "memory.clearStore",
  CommandMetadata
> = {
  "agentMcp.catalog": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "agentMcp.open": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "agentMcp.reveal": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "memory.clearStore": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["managedAssets:write"],
  },
  "memory.deleteObservation": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["managedAssets:write"],
  },
  "memory.disable": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["managedAssets:write"],
  },
  "memory.enable": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["managedAssets:write"],
  },
  "memory.list": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["workspace:read"],
  },
  "memory.status": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["workspace:read"],
  },
  "rules.ensure": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "rules.read": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "rules.snapshot": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "rules.write": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
};
