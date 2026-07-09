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
    copy: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.copy(request);
    },
    drafts: {
      delete: (key) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.drafts.delete(key);
      },
      list: () => {
        assertPluginCapability(entry, "file:read");
        return window.pier.files.drafts.list();
      },
      set: (key, value) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.drafts.set(key, value);
      },
    },
    exists: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.exists(request);
    },
    list: (requestOrRoot, options) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.list(
        normalizeFileListRequest(requestOrRoot, options)
      );
    },
    mkdir: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.mkdir(request);
    },
    move: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.move(request);
    },
    readText: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.readText(request);
    },
    reveal: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.reveal(request);
    },
    stat: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.stat(request);
    },
    trash: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.trash(request);
    },
    watch: (root, listener, options) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.watch(root, listener, options);
    },
    writeText: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.writeText(request);
    },
  };
}
