import type { RendererPluginPanelRegistration } from "@pier/plugin-api/renderer";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { createExternalRendererActivationScope } from "../external/activation-scope.ts";
import type { ExternalPanelPlaceholderRegistry } from "../external/panel-placeholders.tsx";
import type { ActiveRendererPlugin } from "../runtime/disposal.ts";
import { SandboxIframeHost } from "./iframe-host.tsx";

/**
 * 沙箱轨分派（Phase 2 总闸门的代码化）：
 *
 * - 仅 dev 运行时可用；生产包恒为 false —— 与 AGENTS.md「第三方入口默认
 *   隐藏/拒绝」一致，本文件不提供任何生产旁路。
 * - dev 下还需 localStorage 显式开启（pier.sandboxTrack=1），避免日常开发
 *   误入沙箱轨。
 * - 命中时外部插件不进 in-realm import，而是为 manifest 声明的每个 panel
 *   生成 SandboxIframeHost 合成注册（能力桥 deny-by-default，v1 方法集
 *   为空 = 只渲染 UI、无宿主特权）。
 * - 官方 / builtin / 开发覆盖保持 in-realm 快轨；沙箱只接 local/git/registry。
 */

const SANDBOX_TRACK_STORAGE_KEY = "pier.sandboxTrack";

export function resolveSandboxTrackEnabled(
  dev: boolean,
  storage: Pick<Storage, "getItem"> | null | undefined
): boolean {
  if (!dev) {
    return false;
  }
  try {
    return storage?.getItem(SANDBOX_TRACK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isSandboxTrackEnabled(): boolean {
  return resolveSandboxTrackEnabled(
    import.meta.env.DEV,
    globalThis.localStorage
  );
}

/** Third-party sources only — official and workspace overrides stay in-realm. */
export function isSandboxTrackCandidate(entry: PluginRegistryEntry): boolean {
  if (entry.runtime.kind !== "external") {
    return false;
  }
  const kind = entry.manifest.source.kind;
  return kind === "git" || kind === "local" || kind === "registry";
}

export interface SandboxDispatchInput {
  entry: PluginRegistryEntry;
  onFrozen?: (reason: string) => void;
}

/**
 * 为 manifest 声明的每个 panel 生成沙箱合成注册。
 * 组件在渲染期才创建 iframe；桥令牌每次挂载重新生成。
 */
export function createSandboxTrackRegistrations(
  input: SandboxDispatchInput
): readonly RendererPluginPanelRegistration[] {
  const { entry } = input;
  return entry.manifest.panels.map((panel) => ({
    component: () => (
      <SandboxIframeHost
        allowedChannels={[]}
        bundleUrl={entry.runtime.rendererEntryUrl ?? ""}
        grantedCapabilities={entry.effectivePermissions}
        methods={new Map()}
        pluginId={entry.manifest.id}
        title={panel.id}
      />
    ),
    id: panel.id,
    title: panel.id,
  }));
}

/**
 * 运行时暴露给沙箱分派的最小能力面（结构化类型，避免循环依赖）。
 */
export interface SandboxTrackRuntimeAdapter {
  active: Map<string, ActiveRendererPlugin>;
  externalDiagnosticPluginIds: Set<string>;
  externalPanelPlaceholders: ExternalPanelPlaceholderRegistry;
  reportExternalActivation: (report: {
    error?: string;
    ok: boolean;
    pluginId: string;
    version: string;
  }) => Promise<void>;
}

/**
 * 沙箱轨激活：跳过 in-realm import，为 manifest 声明的每个 panel 注册
 * SandboxIframeHost 合成实现；生命周期与快轨一致（active 登记 + 报告）。
 * 同步完成、无 await —— 不存在代次竞态。返回 true 表示已接管。
 */
export function maybeActivateViaSandboxTrack(
  runtime: SandboxTrackRuntimeAdapter,
  entry: PluginRegistryEntry,
  signature: string
): boolean {
  if (!(isSandboxTrackEnabled() && isSandboxTrackCandidate(entry))) {
    return false;
  }
  const pluginId = entry.manifest.id;
  const scope = createExternalRendererActivationScope();
  try {
    for (const registration of createSandboxTrackRegistrations({ entry })) {
      scope.add(
        runtime.externalPanelPlaceholders.registerImplementation(
          entry,
          registration
        )
      );
    }
    const unresolvedPanels =
      runtime.externalPanelPlaceholders.unresolvedPanelIds(entry);
    if (unresolvedPanels.length > 0) {
      throw new Error(
        `sandbox track could not resolve declared panels: ${unresolvedPanels.join(", ")}`
      );
    }
  } catch (error) {
    scope.dispose();
    throw error;
  }
  runtime
    .reportExternalActivation({
      ok: true,
      pluginId,
      version: entry.manifest.version,
    })
    .catch(() => undefined);
  runtime.active.set(pluginId, {
    dispose: () => scope.dispose(),
    kind: "external",
    signature,
    state: "active",
  });
  runtime.externalDiagnosticPluginIds.delete(pluginId);
  return true;
}
