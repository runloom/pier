import type { CanvasHostInspect } from "@shared/contracts/canvas-host.ts";
import { canvasHostApiDomains } from "./domains.ts";

/** Fill command payload fields. Shared inspect leaves `fields` empty. */
export function decorateCanvasHostInspect(
  inspected: CanvasHostInspect
): CanvasHostInspect {
  const fieldsByType = new Map(
    canvasHostApiDomains().flatMap((domain) =>
      domain.commands.map((command) => [command.type, command.fields] as const)
    )
  );
  return {
    ...inspected,
    domains: inspected.domains.map((domain) => ({
      ...domain,
      commands: domain.commands.map((command) => {
        const fields = fieldsByType.get(command.type);
        if (!fields) {
          throw new Error(
            `canvas host inspect missing payload fields for ${command.type}`
          );
        }
        return {
          fields,
          type: command.type,
        };
      }),
    })),
  };
}
