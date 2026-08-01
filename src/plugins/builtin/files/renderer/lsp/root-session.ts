import type { EditorView } from "@codemirror/view";
import {
  DEFAULT_LSP_POLICY_PREFS,
  type LspPolicyPrefs,
  type LspSessionEnsureRequest,
} from "@shared/contracts/lsp.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { FilesLanguageServiceStatus } from "../panel/language-service-status.ts";
import { FilesLspRootSession } from "./root-recovery.ts";
import {
  type FilesLspRootAttachment,
  type FilesLspRootLease,
  statusForEnsureFailure,
} from "./root-recovery-types.ts";
import {
  beginRootSessionAcquisition,
  claimRootSession,
  deferStaleRootSessionClose,
  finishRootSessionAcquisition,
  getLspFacade,
  resetRootSessionAcquisitionsForTests,
} from "./session-coordinator.ts";
import { filesLspWorkspaceIdentity } from "./workspace.ts";

type RootAttachmentValidity = () => boolean;

interface RootClientCacheEntry {
  readonly acquisitions: Set<RootAttachmentValidity>;
  promise: Promise<FilesLspRootSession | null>;
  root: FilesLspRootSession | null | undefined;
  sessionId: string;
}

const clientsByIdentity = new Map<string, RootClientCacheEntry>();

export type {
  FilesLspRootAttachment,
  FilesLspRootLease,
} from "./root-recovery-types.ts";

export function normalizeFilesLspRoot(rootPath: string): string {
  return rootPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

function hasValidAcquisition(entry: RootClientCacheEntry): boolean {
  for (const isValid of entry.acquisitions) {
    if (!isValid()) {
      entry.acquisitions.delete(isValid);
    }
  }
  return entry.acquisitions.size > 0;
}

function canShareCachedClient(entry: RootClientCacheEntry): boolean {
  if (entry.root?.closed || entry.root === null) {
    return false;
  }
  if (entry.root && entry.root.attachments.size > 0) {
    return true;
  }
  return hasValidAcquisition(entry);
}

function retainExistingRootAcquisitions(
  workspaceKey: string,
  isValid: RootAttachmentValidity
): () => void {
  const retained: RootClientCacheEntry[] = [];
  const cacheKeyPrefix = `${workspaceKey}\0`;
  for (const [cacheKey, entry] of clientsByIdentity) {
    if (
      !cacheKey.startsWith(cacheKeyPrefix) ||
      entry.root === null ||
      entry.root?.closed
    ) {
      continue;
    }
    entry.acquisitions.add(isValid);
    retained.push(entry);
  }
  return () => {
    for (const entry of retained) {
      entry.acquisitions.delete(isValid);
      if (
        entry.root &&
        entry.root.attachments.size === 0 &&
        !hasValidAcquisition(entry)
      ) {
        entry.root.abandon();
      }
    }
  };
}

function initialDisabledStatus(
  prefs: LspPolicyPrefs,
  isWorktree: boolean
): FilesLanguageServiceStatus | null {
  if (!prefs.enabled) {
    return { reason: "globally-disabled", state: "disabled" };
  }
  if (isWorktree && !prefs.worktreesEnabled) {
    return { reason: "worktrees-disabled", state: "disabled" };
  }
  return null;
}

async function ensureRootAttachment(input: {
  attachment: FilesLspRootAttachment;
  isValid: RootAttachmentValidity;
  onDisplayFile: (absolutePath: string) => Promise<EditorView | null>;
  panelContext?: PanelContext;
  rootPath: string;
}): Promise<FilesLspRootLease | null> {
  const requestRoot = normalizeFilesLspRoot(input.rootPath);
  const facade = getLspFacade();
  if (!facade) {
    input.attachment.publish({
      reason: "bridge-unavailable",
      state: "error",
    });
    return null;
  }
  const { isWorktree, workspaceKey } = filesLspWorkspaceIdentity(
    input.panelContext,
    requestRoot
  );
  const releaseRetainedAcquisitions = retainExistingRootAcquisitions(
    workspaceKey,
    input.isValid
  );
  try {
    const request: LspSessionEnsureRequest = {
      filePath: input.attachment.absolutePath,
      isWorktree,
      kind: "local",
      rootPath: requestRoot,
      workspaceKey,
    };
    const acquisition = beginRootSessionAcquisition(
      JSON.stringify([isWorktree, requestRoot, workspaceKey]),
      input.isValid
    );
    const ensured = await facade
      .ensureSession(request)
      .catch((error: unknown) => {
        finishRootSessionAcquisition(acquisition);
        throw error;
      });
    if (!ensured) {
      finishRootSessionAcquisition(acquisition);
      input.attachment.publish({
        reason: "bridge-unavailable",
        state: "error",
      });
      return null;
    }
    if (!ensured.ok) {
      finishRootSessionAcquisition(acquisition);
      input.attachment.publish(statusForEnsureFailure(ensured));
      return null;
    }

    const serverRoot = normalizeFilesLspRoot(ensured.rootPath);
    const cacheKey = `${ensured.workspaceKey}\0${ensured.serverId}\0${serverRoot}`;
    const sessionIdentity = {
      cacheKey,
      facade,
      sessionId: ensured.sessionId,
    };
    if (!input.isValid()) {
      const cached = clientsByIdentity.get(cacheKey);
      deferStaleRootSessionClose(
        acquisition,
        sessionIdentity,
        cached?.sessionId === ensured.sessionId && canShareCachedClient(cached)
      );
      finishRootSessionAcquisition(acquisition);
      return null;
    }
    claimRootSession(acquisition, sessionIdentity);
    finishRootSessionAcquisition(acquisition);

    let cacheEntry = clientsByIdentity.get(cacheKey);
    if (cacheEntry?.sessionId === ensured.sessionId) {
      cacheEntry.acquisitions.add(input.isValid);
    }
    if (cacheEntry && !canShareCachedClient(cacheEntry)) {
      clientsByIdentity.delete(cacheKey);
      cacheEntry.root?.abandon();
      cacheEntry = undefined;
    }
    if (cacheEntry) {
      cacheEntry.acquisitions.add(input.isValid);
      if (cacheEntry.sessionId !== ensured.sessionId) {
        facade.close(ensured.sessionId).catch(() => false);
      }
    } else {
      const newEntry: RootClientCacheEntry = {
        acquisitions: new Set([input.isValid]),
        promise: Promise.resolve(null),
        root: undefined,
        sessionId: ensured.sessionId,
      };
      const root = new FilesLspRootSession({
        cacheKey,
        ensured,
        facade,
        isWorktree,
        onDelete: () => {
          if (clientsByIdentity.get(cacheKey) === newEntry) {
            clientsByIdentity.delete(cacheKey);
          }
        },
        onDisplayFile: input.onDisplayFile,
        onSessionChanged: (sessionId) => {
          newEntry.sessionId = sessionId;
        },
        shouldRetainWithoutAttachments: () => hasValidAcquisition(newEntry),
        request,
      });
      newEntry.root = root;
      newEntry.promise = root.initialize().then((ready) => {
        if (!ready) {
          if (clientsByIdentity.get(cacheKey) === newEntry) {
            clientsByIdentity.delete(cacheKey);
          }
          newEntry.root = null;
          return null;
        }
        return root;
      });
      cacheEntry = newEntry;
      clientsByIdentity.set(cacheKey, newEntry);
    }

    let root: FilesLspRootSession | null;
    try {
      root = await cacheEntry.promise;
    } finally {
      cacheEntry.acquisitions.delete(input.isValid);
    }
    if (!root || root.closed) {
      if (clientsByIdentity.get(cacheKey) === cacheEntry) {
        clientsByIdentity.delete(cacheKey);
      }
      input.attachment.publish({
        reason: "initialize-failed",
        serverId: ensured.serverId,
        state: "error",
      });
      return null;
    }
    if (!input.isValid()) {
      if (root.attachments.size === 0 && !hasValidAcquisition(cacheEntry)) {
        root.abandon();
      }
      return null;
    }
    input.attachment.languageId = ensured.languageId;
    return root.attach(input.attachment);
  } finally {
    releaseRetainedAcquisitions();
  }
}

interface FilesLspAttachmentLifecycleInput {
  attachment: FilesLspRootAttachment;
  onDisplayFile: (absolutePath: string) => Promise<EditorView | null>;
  panelContext?: PanelContext;
  rootPath: string;
}

export class FilesLspAttachmentLifecycle {
  readonly #input: FilesLspAttachmentLifecycleInput;
  readonly #pendingGenerations = new Set<number>();
  #destroyed = false;
  #generation = 0;
  #lease: FilesLspRootLease | null = null;
  #policyPrefs = DEFAULT_LSP_POLICY_PREFS;
  #policyObserved = false;

  constructor(input: FilesLspAttachmentLifecycleInput) {
    this.#input = input;
  }

  start(): void {
    this.#input.attachment.publish({ state: "starting" });
    this.#boot();
  }

  setPolicy(prefs: LspPolicyPrefs): void {
    if (this.#destroyed) {
      return;
    }
    this.#policyObserved = true;
    this.#policyPrefs = prefs;
    if (this.#lease) {
      this.#lease.setPolicy(prefs);
      return;
    }
    const { isWorktree } = filesLspWorkspaceIdentity(
      this.#input.panelContext,
      normalizeFilesLspRoot(this.#input.rootPath)
    );
    const disabled = initialDisabledStatus(prefs, isWorktree);
    if (disabled) {
      this.#generation += 1;
      this.#input.attachment.publish(disabled);
      return;
    }
    this.#boot();
  }

  setEnabled(enabled: boolean): void {
    this.setPolicy({ ...this.#policyPrefs, enabled });
  }

  resume(): void {
    this.#lease?.resume();
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#generation += 1;
    const lease = this.#lease;
    this.#lease = null;
    lease?.release();
    if (!lease) {
      this.#input.attachment.disconnect();
      this.#input.attachment.publish(null);
    }
  }

  #boot(): void {
    const generation = this.#generation;
    if (
      this.#destroyed ||
      this.#lease ||
      this.#pendingGenerations.has(generation)
    ) {
      return;
    }
    this.#pendingGenerations.add(generation);
    this.#input.attachment.publish({ state: "starting" });
    ensureRootAttachment({
      attachment: this.#input.attachment,
      isValid: () =>
        !this.#destroyed &&
        generation === this.#generation &&
        !(
          this.#policyObserved &&
          initialDisabledStatus(
            this.#policyPrefs,
            filesLspWorkspaceIdentity(
              this.#input.panelContext,
              normalizeFilesLspRoot(this.#input.rootPath)
            ).isWorktree
          )
        ),
      onDisplayFile: this.#input.onDisplayFile,
      ...(this.#input.panelContext
        ? { panelContext: this.#input.panelContext }
        : {}),
      rootPath: this.#input.rootPath,
    })
      .then((lease) => {
        if (!lease) {
          return;
        }
        if (this.#destroyed || generation !== this.#generation || this.#lease) {
          queueMicrotask(() => {
            lease.release();
          });
          return;
        }
        this.#lease = lease;
        if (this.#policyObserved) {
          lease.setPolicy(this.#policyPrefs);
        }
      })
      .catch(() => {
        if (!this.#destroyed && generation === this.#generation) {
          this.#input.attachment.publish({
            reason: "bridge-unavailable",
            state: "error",
          });
        }
      })
      .finally(() => {
        this.#pendingGenerations.delete(generation);
      });
  }
}

export function subscribeFilesLspPolicy(
  listener: (prefs: LspPolicyPrefs) => void
): () => void {
  return getLspFacade()?.onPolicyChanged(listener) ?? (() => undefined);
}

export function resetLspClientCacheForTests(): void {
  clientsByIdentity.clear();
  resetRootSessionAcquisitionsForTests();
}
