import { join } from "node:path";
import {
  type RegisteredCanvasApplet,
  setRegisteredCanvasApplets,
} from "./applet-registry.ts";
import { appletFenceRootForEntry } from "./compile-resolve-applet.ts";

export interface CanvasAppletRuntimeSource {
  assetsRoot: string;
  enabled: boolean;
  id: string;
  manifest: {
    applets?:
      | readonly {
          deprecated?: boolean | undefined;
          entry: string;
          id: string;
          title?: string | undefined;
        }[]
      | undefined;
  };
}

export function syncRegisteredCanvasApplets(
  sources: readonly CanvasAppletRuntimeSource[]
): void {
  const applets: RegisteredCanvasApplet[] = [];
  for (const source of sources) {
    if (!source.enabled) {
      continue;
    }
    for (const applet of source.manifest.applets ?? []) {
      const prefix = `${source.id}.`;
      const appletId = applet.id.startsWith(prefix)
        ? applet.id.slice(prefix.length)
        : applet.id;
      const entryAbsolutePath = join(
        source.assetsRoot,
        ...applet.entry.split("/")
      );
      applets.push({
        appletId,
        entryAbsolutePath,
        fenceRoot: appletFenceRootForEntry(entryAbsolutePath),
        pluginId: source.id,
        ...(applet.deprecated === undefined
          ? {}
          : { deprecated: applet.deprecated }),
        ...(applet.title === undefined ? {} : { title: applet.title }),
      });
    }
  }
  setRegisteredCanvasApplets(applets);
}
