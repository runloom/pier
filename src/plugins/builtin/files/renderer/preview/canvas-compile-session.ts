import { liveModuleCanvasFileScopeWrapper } from "@plugins/api/live-module-canvas-file.tsx";
import {
  LiveModuleMountError,
  mountLiveModuleExport,
} from "@plugins/api/live-module-mount.ts";
import {
  importLiveModuleInDisposableRealm,
  type LiveModuleRealm,
} from "@plugins/api/live-module-realm.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
  projectLiveRootId,
  projectLiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import {
  canvasDirectoryFromProjectPath,
  liveModuleContentRootId,
  liveModuleProjectContentDirectories,
  normalizeProjectRootKey,
  projectCanvasLocation,
} from "@shared/live-module-canvas-path.ts";
import { detectLiveModuleFrameworkFromFileName } from "@shared/live-module-framework.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";
import type { FilesTranslate } from "../i18n.ts";
import {
  CANVAS_SKELETON_DELAY_MS,
  type CanvasPreviewState,
  moduleIdentity,
  type SoftError,
} from "./canvas-compile-state.ts";
import {
  canvasMountErrorMessage,
  clearMountedCanvas,
  unmountMountedCanvas,
} from "./canvas-states.tsx";
import {
  ensureProjectCanvasTrusted,
  trustDeclinedState,
} from "./canvas-trust-gate.ts";
import { removeLiveModuleCss } from "./css-cleanup.ts";
import {
  ensureLiveModulesProjectConfigLoaded,
  subscribeLiveModulesProjectConfigChanged,
} from "./load-live-modules-config.ts";

/**
 * The compile + mount session for one canvas preview generation.
 *
 * - registers the project live root, compiles, imports the bundle into a
 *   disposable realm (`importLiveModuleInDisposableRealm`), mounts it
 * - hot reload keeps the previous mount until the new bundle is ready; the
 *   previous realm is discarded together with its mount so replaced module
 *   graphs do not accumulate in the host module map
 * - CSS teardown ordering: previous styles are removed BEFORE the new bundle
 *   is imported in the disposable realm (the injector tags styles with the
 *   same moduleId prefix)
 * - manual Reload (toolbar) and stale events bump `nonce` → new generation
 */
export function useCanvasCompileSession(props: {
  context: RendererPluginContext;
  path: string;
  root: string;
  t: FilesTranslate;
  nonce: number;
  setNonce: Dispatch<SetStateAction<number>>;
  setState: Dispatch<SetStateAction<CanvasPreviewState>>;
  hostRef: RefObject<HTMLDivElement | null>;
  unmountRef: RefObject<(() => void) | null>;
  mountedIdentityRef: RefObject<string | null>;
  mountedModuleIdRef: RefObject<string | null>;
}): void {
  const {
    context,
    path,
    root,
    t,
    nonce,
    setNonce,
    setState,
    hostRef,
    unmountRef,
    mountedIdentityRef,
    mountedModuleIdRef,
  } = props;
  const liveModules = context.liveModules;

  // Settings save → recompile with the new content-directory list.
  useEffect(() => {
    const rootKey = normalizeProjectRootKey(root);
    return subscribeLiveModulesProjectConfigChanged((changedRoot) => {
      if (normalizeProjectRootKey(changedRoot) !== rootKey) {
        return;
      }
      setNonce((value) => value + 1);
    });
  }, [root, setNonce]);

  useEffect(() => {
    // `nonce` re-triggers compile on file stale events and manual Reload.
    const reloadGeneration = nonce;

    if (!liveModules) {
      clearMountedCanvas(
        hostRef.current,
        unmountRef,
        mountedIdentityRef,
        mountedModuleIdRef.current
      );
      mountedModuleIdRef.current = null;
      setState({
        diagnostics: [],
        kind: "error",
        message: t(
          "filePanel.canvas.notUnderCanvases",
          "This file isn’t in a canvas preview folder. Adjust folders in Settings → Projects → General."
        ),
      });
      return;
    }

    const hostEl = hostRef.current;
    if (!hostEl) {
      return;
    }

    // Mark host with compile generation (stale / Reload bump `nonce`).
    hostEl.dataset.pierCanvasCompile = String(reloadGeneration);
    let cancelled = false;
    const stillOwner = (): boolean =>
      !cancelled &&
      hostEl.dataset.pierCanvasCompile === String(reloadGeneration);

    let skeletonTimer: ReturnType<typeof setTimeout> | null = null;
    /** Filled after config + location resolve (for stale watch + cleanup). */
    let registeredRootId: string | null = null;
    let compileRelPath: string | null = null;
    let isHotReload = false;
    /** Imported this generation but not yet owned by `unmountRef`. */
    let pendingRealm: LiveModuleRealm | null = null;
    /** Set as soon as `mountLiveModuleExport` returns, before `unmountRef`. */
    let pendingUnmount: (() => void) | null = null;

    const clearSkeletonTimer = () => {
      if (skeletonTimer !== null) {
        clearTimeout(skeletonTimer);
        skeletonTimer = null;
      }
    };

    const run = async () => {
      try {
        await ensureLiveModulesProjectConfigLoaded(root);
        if (!stillOwner()) {
          return;
        }

        const contentDirectories = liveModuleProjectContentDirectories(root);
        const canvasLocation = projectCanvasLocation(path, contentDirectories);
        const relPath = canvasLocation?.relPath ?? null;
        const contentDirectory =
          canvasLocation?.directory ?? LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY;
        const framework =
          (relPath ? detectLiveModuleFrameworkFromFileName(relPath) : null) ??
          "react";
        compileRelPath = relPath;

        if (!relPath) {
          clearMountedCanvas(
            hostEl,
            unmountRef,
            mountedIdentityRef,
            mountedModuleIdRef.current
          );
          mountedModuleIdRef.current = null;
          setState({
            diagnostics: [],
            kind: "error",
            message: t(
              "filePanel.canvas.notUnderCanvases",
              "This file isn’t in a canvas preview folder. Adjust folders in Settings → Projects → General."
            ),
          });
          return;
        }

        // 画布项目信任门：首次预览前先取得信任决定；拒绝则不编译不挂载。
        const gateOutcome = await ensureProjectCanvasTrusted({
          context,
          projectRootPath: root,
          t,
        });
        if (!stillOwner()) {
          return;
        }
        if (gateOutcome === "declined") {
          clearMountedCanvas(
            hostEl,
            unmountRef,
            mountedIdentityRef,
            mountedModuleIdRef.current
          );
          mountedModuleIdRef.current = null;
          setState(trustDeclinedState(t));
          return;
        }

        const identity = moduleIdentity(
          root,
          contentDirectory,
          relPath,
          framework
        );
        isHotReload =
          mountedIdentityRef.current === identity &&
          unmountRef.current !== null;
        if (isHotReload) {
          // Keep ready UI + previous mount while recompiling.
        } else {
          clearMountedCanvas(
            hostEl,
            unmountRef,
            mountedIdentityRef,
            mountedModuleIdRef.current
          );
          mountedModuleIdRef.current = null;
          setState({ kind: "pending" });
          skeletonTimer = setTimeout(() => {
            if (!stillOwner()) {
              return;
            }
            setState((current) =>
              current.kind === "pending" ? { kind: "loading" } : current
            );
          }, CANVAS_SKELETON_DELAY_MS);
        }

        // Must match registerRoot id — used for stale events + unregister.
        // Sanitize user directory segments so liveRootSpecSchema accepts them.
        const rootId = liveModuleContentRootId(
          projectLiveRootId(root),
          contentDirectory
        );
        registeredRootId = rootId;

        const spec = projectLiveRootSpec({
          directory: contentDirectory,
          // Distinct root id per content directory so alternate registered
          // roots never clobber each other (id charset: a-z0-9._-).
          id: rootId,
          projectRootPath: root,
        });
        await liveModules.registerRoot(spec);
        if (!stillOwner()) {
          return;
        }
        const result = await liveModules.compile(spec.id, relPath);
        if (!stillOwner()) {
          return;
        }
        if (!result.ok) {
          if (result.superseded) {
            // A newer compile superseded this request. Keep the previous
            // canvas if one is mounted; otherwise retry instead of stranding
            // the panel on a loading skeleton (e.g. two panels compiling the
            // same module — the other panel's request wins this one).
            if (!unmountRef.current) {
              setNonce((value) => value + 1);
            }
            return;
          }
          clearSkeletonTimer();
          // Trust was revoked (or decided elsewhere) between the proactive
          // gate and this compile — fail closed with the same declined copy.
          if (result.trust) {
            clearMountedCanvas(
              hostEl,
              unmountRef,
              mountedIdentityRef,
              mountedModuleIdRef.current
            );
            mountedModuleIdRef.current = null;
            setState(trustDeclinedState(t));
            return;
          }
          // Compile failure occupies the region — Empty, never a soft Alert
          // over a stale previous mount (including hot reload).
          clearMountedCanvas(
            hostEl,
            unmountRef,
            mountedIdentityRef,
            mountedModuleIdRef.current
          );
          mountedModuleIdRef.current = null;
          setState({
            diagnostics: result.diagnostics,
            kind: "error",
            message:
              result.diagnostics[0]?.message ??
              t("filePanel.canvas.compileFailed", "Couldn’t compile canvas"),
          });
          return;
        }
        // Drop the PREVIOUS module's injected CSS BEFORE importing the new
        // bundle — its injector runs at import time and tags styles with the
        // same moduleId prefix, so prefix-based removal after import would
        // delete the replacement's just-injected styles.
        const previousModuleId = mountedModuleIdRef.current;
        if (previousModuleId) {
          removeLiveModuleCss(previousModuleId);
        }
        // Dynamic URL from compile ticket — evaluated in a disposable realm so
        // this generation's module graph dies with its mount.
        const realm = await importLiveModuleInDisposableRealm(result.url);
        if (!stillOwner()) {
          realm.dispose();
          return;
        }
        pendingRealm = realm;
        const mod = realm.namespace;

        // Atomic swap: tear down previous only once the new module is ready.
        // stillOwner() re-check prevents a superseded generation from stealing the host.
        // unmountMountedCanvas (not clearMountedCanvas) so the new bundle's
        // already-injected CSS survives.
        unmountMountedCanvas(hostEl, unmountRef, mountedIdentityRef);
        mountedModuleIdRef.current = null;

        // Runtime crash: ErrorBoundary already renders null — no body remains.
        // Compile failures and runtime crashes both use Empty. Soft Alert is
        // only for compile warnings while the successful mount is kept.
        const reportRuntimeError = (error: Error) => {
          queueMicrotask(() => {
            if (!stillOwner()) {
              return;
            }
            const message = canvasMountErrorMessage(error, t);
            setState({
              diagnostics: [],
              isRuntime: true,
              kind: "error",
              message,
            });
            queueMicrotask(() => {
              if (!stillOwner()) {
                return;
              }
              clearMountedCanvas(
                hostEl,
                unmountRef,
                mountedIdentityRef,
                mountedModuleIdRef.current
              );
              mountedModuleIdRef.current = null;
            });
          });
        };

        if (!stillOwner()) {
          pendingRealm = null;
          realm.dispose();
          return;
        }
        const nextUnmount = mountLiveModuleExport(hostEl, framework, mod, {
          onError: reportRuntimeError,
          wrap: liveModuleCanvasFileScopeWrapper({
            directory:
              canvasDirectoryFromProjectPath(path, contentDirectories) ?? "",
            path,
            root,
          }),
        });
        pendingUnmount = nextUnmount;
        if (!stillOwner()) {
          nextUnmount();
          pendingUnmount = null;
          removeLiveModuleCss(relPath);
          pendingRealm = null;
          realm.disposeSoon();
          return;
        }
        clearSkeletonTimer();
        pendingUnmount = null;
        pendingRealm = null;
        unmountRef.current = () => {
          nextUnmount();
          realm.disposeSoon();
        };
        mountedIdentityRef.current = identity;
        mountedModuleIdRef.current = relPath;

        const firstWarning = result.warnings?.[0]?.message?.trim();
        const warningSoft: SoftError | undefined =
          result.warnings && result.warnings.length > 0
            ? {
                diagnostics: result.warnings,
                message:
                  firstWarning && firstWarning.length > 0
                    ? firstWarning
                    : t(
                        "filePanel.canvas.compiledWithWarnings",
                        "Canvas compiled with warnings"
                      ),
              }
            : undefined;

        setState({
          framework,
          kind: "ready",
          ...(warningSoft ? { softError: warningSoft } : {}),
        });
      } catch (error) {
        pendingUnmount?.();
        pendingUnmount = null;
        pendingRealm?.disposeSoon();
        pendingRealm = null;
        if (!stillOwner()) {
          return;
        }
        clearSkeletonTimer();
        const message = canvasMountErrorMessage(error, t);
        // Mount shape failures use the runtime copy; compile/import keep compile
        // copy. Previous mount is stale once this generation fails — always Empty.
        const isRuntimeError = error instanceof LiveModuleMountError;
        clearMountedCanvas(
          hostEl,
          unmountRef,
          mountedIdentityRef,
          mountedModuleIdRef.current
        );
        mountedModuleIdRef.current = null;
        setState({
          diagnostics: [],
          ...(isRuntimeError ? { isRuntime: true as const } : {}),
          kind: "error",
          message,
        });
      }
    };

    run().catch(() => undefined);

    const stopWatch = liveModules.onChanged((event) => {
      if (event.type !== "stale") {
        return;
      }
      if (
        registeredRootId === null ||
        compileRelPath === null ||
        event.rootId !== registeredRootId ||
        event.moduleId !== compileRelPath
      ) {
        return;
      }
      setNonce((value) => value + 1);
    });

    return () => {
      cancelled = true;
      clearSkeletonTimer();
      stopWatch();
      pendingUnmount?.();
      pendingUnmount = null;
      pendingRealm?.disposeSoon();
      pendingRealm = null;
      // Refcounted release — last panel for this content root drops watchers.
      if (registeredRootId) {
        liveModules.unregisterRoot(registeredRootId).catch(() => undefined);
      }
    };
  }, [
    context,
    liveModules,
    nonce,
    path,
    root,
    t,
    hostRef,
    unmountRef,
    mountedIdentityRef,
    mountedModuleIdRef,
    setNonce,
    setState,
  ]);
}
