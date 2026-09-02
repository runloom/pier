import { basename, dirname } from "node:path";
import { findRegisteredCanvasApplet } from "./applet-registry.ts";

const APPLET_SPEC_RE = /^@pier-applet\/(.+)\/([^/]+)$/;

export function parsePierAppletSpecifier(specifier: string): {
  appletId: string;
  pluginId: string;
} | null {
  const match = APPLET_SPEC_RE.exec(specifier);
  if (!match) {
    return null;
  }
  return {
    appletId: match[2] ?? "",
    pluginId: match[1] ?? "",
  };
}

export function resolvePierAppletCompileEntry(specifier: string): {
  entryAbsolutePath: string;
  extraFenceRoots: string[];
  fenceRoot: string;
} | null {
  const parsed = parsePierAppletSpecifier(specifier);
  if (!parsed) {
    return null;
  }
  const applet = findRegisteredCanvasApplet(parsed.pluginId, parsed.appletId);
  if (!applet) {
    return null;
  }
  return {
    entryAbsolutePath: applet.entryAbsolutePath,
    extraFenceRoots: [applet.fenceRoot],
    fenceRoot: applet.fenceRoot,
  };
}

/**
 * Nested `applets/<id>/index.applet.tsx` entries share the `applets/`
 * directory so sibling catalogs (`copy/`) and chrome stay inside the fence.
 * A flat `applets/foo.applet.tsx` keeps `applets/` as the root and does not
 * walk up into plugin renderer sources.
 */
export function appletFenceRootForEntry(entryAbsolutePath: string): string {
  const entryDir = dirname(entryAbsolutePath);
  const parentDir = dirname(entryDir);
  if (basename(parentDir) === "applets") {
    return parentDir;
  }
  return entryDir;
}
