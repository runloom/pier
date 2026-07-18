import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileListRequest } from "@shared/contracts/file.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { openFilesDiskPath } from "../files/open-disk-file-panel.ts";

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
    confirmDurability: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.confirmDurability(request);
    },
    copy: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.copy(request);
    },
    drafts: {
      claimLegacy: (key) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.drafts.claimLegacy(key);
      },
      delete: (key) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.drafts.delete(key);
      },
      get: (key) => {
        assertPluginCapability(entry, "file:read");
        return window.pier.files.drafts.get(key);
      },
      listKeys: () => {
        assertPluginCapability(entry, "file:read");
        return window.pier.files.drafts.listKeys();
      },
      listDiagnostics: () => {
        assertPluginCapability(entry, "file:read");
        return window.pier.files.drafts.listDiagnostics();
      },
      set: (key, generation, value) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.drafts.set(key, generation, value);
      },
    },
    exists: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.exists(request);
    },
    inspectWriteTarget: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.inspectWriteTarget(request);
    },
    inspectPathImpact: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.inspectPathImpact(request);
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
    openInEditor: (request) => {
      assertPluginCapability(entry, "file:read");
      return openFilesDiskPath({
        path: request.path,
        root: request.root,
        ...(request.context ? { context: request.context } : {}),
        ...(request.title ? { title: request.title } : {}),
      });
    },
    openPath: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.openPath(request);
    },
    pickSaveTarget: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.pickSaveTarget(request);
    },
    onPathQueryEvent: (listener) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.fileQuery.onEvent(listener);
    },
    queryPaths: (request) => {
      assertPluginCapability(entry, "file:read");
      const queryId = request.queryId ?? crypto.randomUUID();
      // Subscribe-before-start is the caller's responsibility when they need
      // to observe events that race the IPC round-trip. Surface the start
      // result so a false/reject can exit loading instead of hanging.
      const started = window.pier.fileQuery.start({ ...request, queryId });
      return {
        cancel: () => {
          window.pier.fileQuery.cancel(queryId).catch(() => undefined);
        },
        queryId,
        started,
      };
    },
    readDocument: (request) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.files.readDocument(request);
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
    writeDocument: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.writeDocument(request);
    },
    writeText: (request) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.files.writeText(request);
    },
  };
}
