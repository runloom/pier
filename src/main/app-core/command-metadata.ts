import type { PierCommand } from "@shared/contracts/commands.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import { COMMAND_METADATA } from "./commands/metadata-table.ts";

export type { CommandMetadata } from "./commands/metadata-table.ts";

export function requiredCapabilitiesForCommand(
  command: PierCommand
): readonly PierCapability[] {
  if (command.type === "terminal.open") {
    // launch 存在时的额外能力动态叠加（静态元数据只记基础能力）。
    if (command.launch && Object.keys(command.launch).length > 0) {
      return ["workspace:open", "terminal:control"];
    }
    return ["workspace:open"];
  }
  return COMMAND_METADATA[command.type].capabilities;
}

export function commandMetadataFor(commandType: PierCommand["type"]) {
  return COMMAND_METADATA[commandType];
}
