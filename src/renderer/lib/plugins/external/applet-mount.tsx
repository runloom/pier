import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import {
  mountLiveModuleExport,
  updateLiveModule,
} from "@plugins/api/live-module-mount.ts";
import {
  importLiveModuleInDisposableRealm,
  type LiveModuleRealm,
} from "@plugins/api/live-module-realm.ts";
import { projectLiveRootSpec } from "@shared/contracts/live-modules.ts";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

function markAppletReady(el: HTMLElement, ready: boolean): void {
  if (ready) {
    el.dataset.appletReady = "";
    return;
  }
  el.removeAttribute("data-applet-ready");
}

export function ExternalPluginAppletMount({
  appletId,
  pluginId,
  projectRootPath,
  props,
}: {
  appletId: string;
  pluginId: string;
  projectRootPath: string;
  props?: Record<string, unknown>;
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const compiledRef = useRef<ComponentType | null>(null);
  const propsRef = useRef(props ?? {});
  propsRef.current = props ?? {};
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const moduleId = `@pier-applet/${pluginId}/${appletId}`;
  const propsKey = JSON.stringify(props ?? {});

  const onError = useCallback((caught: Error) => {
    setError(caught.message);
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    const liveModules = window.pier?.liveModules;
    if (!(el && liveModules && projectRootPath)) {
      setError(
        projectRootPath
          ? t("workspace.pluginPanel.appletHostUnavailable")
          : t("workspace.pluginPanel.appletNoProject")
      );
      return;
    }
    let cancelled = false;
    let unmount: (() => void) | undefined;
    let realm: LiveModuleRealm | undefined;
    compiledRef.current = null;
    markAppletReady(el, false);
    el.dataset.retry = String(retry);
    const spec = projectLiveRootSpec({ projectRootPath });
    const releaseGeneration = () => {
      unmount?.();
      unmount = undefined;
      realm?.disposeSoon();
      realm = undefined;
    };
    const mount = async () => {
      await liveModules.registerRoot(spec);
      const compiled = await liveModules.compile(spec.id, moduleId);
      if (!compiled.ok) {
        throw new Error(compiled.diagnostics[0]?.message ?? "compile failed");
      }
      const url = await liveModules.getUrl(spec.id, moduleId);
      // Disposable realm: a retried / remounted applet must not pin the
      // previous module graph in the host module map.
      const loaded = await importLiveModuleInDisposableRealm(url);
      if (cancelled) {
        loaded.dispose();
        return;
      }
      realm = loaded;
      const mod = loaded.namespace;
      const Comp = mod.default;
      if (typeof Comp === "function") {
        compiledRef.current = Comp as ComponentType;
      }
      unmount = mountLiveModuleExport(el, "react", mod, {
        onError,
        props: propsRef.current,
      });
      if (cancelled) {
        releaseGeneration();
        return;
      }
      markAppletReady(el, true);
      setError(null);
    };
    mount().catch((caught: unknown) => {
      releaseGeneration();
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
    return () => {
      cancelled = true;
      markAppletReady(el, false);
      compiledRef.current = null;
      releaseGeneration();
    };
  }, [moduleId, onError, projectRootPath, retry, t]);

  useEffect(() => {
    const el = hostRef.current;
    const Comp = compiledRef.current;
    if (!(el && Comp && el.hasAttribute("data-applet-ready"))) {
      return;
    }
    updateLiveModule(el, Comp, {
      onError,
      props: JSON.parse(propsKey) as Record<string, unknown>,
    });
  }, [onError, propsKey]);

  if (error) {
    return (
      <div className="h-full min-h-0" data-applet-ready="">
        <ErrorEmpty
          description={t("workspace.pluginPanel.appletLoadFailedBody")}
          detailAction={{
            label: t("workspace.pluginPanel.appletLoadDetails"),
            onClick: () => {
              showAppAlert({
                body: error,
                title: t("workspace.pluginPanel.appletLoadFailed"),
              }).catch(() => undefined);
            },
          }}
          retryAction={{
            label: t("workspace.pluginPanel.appletLoadRetry"),
            onClick: () => {
              setError(null);
              setRetry((value) => value + 1);
            },
          }}
          title={t("workspace.pluginPanel.appletLoadFailed")}
        />
      </div>
    );
  }

  return <div className="h-full min-h-0" ref={hostRef} />;
}

export function declaredAppletId(pluginId: string, appletId: string): string {
  const prefix = `${pluginId}.`;
  return appletId.startsWith(prefix) ? appletId.slice(prefix.length) : appletId;
}
