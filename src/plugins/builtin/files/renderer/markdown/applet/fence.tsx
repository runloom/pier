import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { mountLiveModuleExport } from "@plugins/api/live-module-mount.ts";
import {
  importLiveModuleInDisposableRealm,
  type LiveModuleRealm,
} from "@plugins/api/live-module-realm.ts";
import type { RendererLiveModulesApi } from "@plugins/api/live-modules-context.ts";
import {
  projectLiveRootId,
  projectLiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarkdownRendererLabels } from "../ir-inlines.tsx";
import type { MarkdownDiskSource } from "../resource-elements.tsx";

export function markdownAppletsEnabled(source: string | undefined): boolean {
  return Boolean(source && /<!--\s*pier-applets:\s*enable\s*-->/i.test(source));
}

export function appletFenceProps(
  props: Record<string, unknown>
): Record<string, unknown> {
  return { ...props, chrome: "island" };
}

export function parseAppletFence(value: string): {
  appletId: string;
  pluginId: string;
  props: Record<string, unknown>;
} | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.pluginId !== "string" ||
      typeof record.appletId !== "string"
    ) {
      return null;
    }
    return {
      appletId: record.appletId,
      pluginId: record.pluginId,
      props:
        record.props && typeof record.props === "object"
          ? (record.props as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

export function MarkdownAppletFence({
  disk,
  enabled,
  labels,
  liveModules,
  source,
}: {
  disk: MarkdownDiskSource | undefined;
  enabled: boolean;
  labels: MarkdownRendererLabels;
  liveModules: RendererLiveModulesApi | undefined;
  source: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseAppletFence(source), [source]);
  const copy = {
    disabledTitle:
      labels.appletDisabledTitle ?? "Applets are off for this document",
    disabledBody:
      labels.appletDisabledBody ??
      "Add <!-- pier-applets: enable --> near the top to mount this applet.",
    parseFailedTitle:
      labels.appletParseFailedTitle ?? "Couldn’t read this applet fence",
    parseFailedBody:
      labels.appletParseFailedBody ??
      "Use JSON with pluginId, appletId, and optional props.",
    mountFailedBody:
      labels.appletMountFailedBody ??
      "Retry. If it still fails, check that the plugin is installed.",
    mountFailedTitle:
      labels.appletMountFailedTitle ?? "Couldn’t mount the applet",
  };

  useEffect(() => {
    const el = hostRef.current;
    if (!(enabled && parsed && disk && el && liveModules)) {
      return;
    }
    let cancelled = false;
    let unmount: (() => void) | undefined;
    let realm: LiveModuleRealm | undefined;
    const spec = projectLiveRootSpec({ projectRootPath: disk.root });
    const mount = async () => {
      await liveModules.registerRoot(spec);
      const moduleId = `@pier-applet/${parsed.pluginId}/${parsed.appletId}`;
      const compiled = await liveModules.compile(spec.id, moduleId);
      if (!compiled.ok) {
        throw new Error(compiled.diagnostics[0]?.message ?? "compile failed");
      }
      const url = await liveModules.getUrl(spec.id, moduleId);
      const loaded = await importLiveModuleInDisposableRealm(url);
      if (cancelled) {
        loaded.dispose();
        return;
      }
      realm = loaded;
      unmount = mountLiveModuleExport(el, "react", loaded.namespace, {
        props: appletFenceProps(parsed.props),
      });
      if (cancelled) {
        unmount();
        realm.disposeSoon();
      }
    };
    mount().catch((caught: unknown) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
    return () => {
      cancelled = true;
      unmount?.();
      realm?.disposeSoon();
      liveModules
        .unregisterRoot(projectLiveRootId(disk.root))
        .catch(() => undefined);
    };
  }, [disk, enabled, liveModules, parsed]);

  if (!enabled) {
    return (
      <Alert>
        <AlertTitle>{copy.disabledTitle}</AlertTitle>
        <AlertDescription>{copy.disabledBody}</AlertDescription>
      </Alert>
    );
  }
  if (!parsed) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{copy.parseFailedTitle}</AlertTitle>
        <AlertDescription>{copy.parseFailedBody}</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="min-h-40">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.mountFailedTitle}</AlertTitle>
          <AlertDescription>{copy.mountFailedBody}</AlertDescription>
        </Alert>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
}
