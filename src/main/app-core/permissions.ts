import type { PierCommand } from "@shared/contracts/commands.ts";
import type { PierClient } from "@shared/contracts/permissions.ts";
import {
  commandMetadataFor,
  requiredCapabilitiesForCommand,
} from "./command-metadata.ts";

export type { CommandMetadata } from "./command-metadata.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

export function authorizeCommand(
  command: PierCommand,
  client: PierClient
): AuthorizationResult {
  const allowedKinds = commandMetadataFor(command.type).allowedClientKinds;
  if (allowedKinds && !allowedKinds.includes(client.kind)) {
    return {
      ok: false,
      reason: `client kind ${client.kind} not allowed for ${command.type}`,
    };
  }
  const requiredCapabilities = requiredCapabilitiesForCommand(command);
  const missing = requiredCapabilities.find(
    (capability) => !client.capabilities.includes(capability)
  );
  if (missing) {
    return {
      ok: false,
      reason: `missing capability: ${missing}`,
    };
  }
  return { ok: true };
}
