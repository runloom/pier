import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileListRequest } from "@shared/contracts/file.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

function normalizeFileListRequest(
  requestOrRoot: FileListRequest | string,
  options?: { path?: string }
): FileListRequest {
  if (typeof requestOrRoot !== "string") {
    return requestOrRoot;
  }
  return {
    path: options?.path ?? "",
    root: requestOrRoot,
  };
}

/** files namespace 适配器:capability 断言后透传 preload facade(与 host-git-context 同构)。 */
export function createPluginFilesContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["files"] {
  return {
    list: (requestOrRoot, options) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.list(
        normalizeFileListRequest(requestOrRoot, options)
      );
    },
    move: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.move(request);
    },
    readText: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.readText(request);
    },
    trash: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.trash(request);
    },
    writeText: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.writeText(request);
    },
  };
}
