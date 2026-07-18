import type {
  RendererPluginContext,
  RendererPluginQuickPick,
  RendererPluginQuickPickItem,
  RendererPluginQuickPickSection,
} from "@plugins/api/renderer.ts";
import { useCommandPaletteController } from "../command-palette/controller.ts";
import type {
  QuickPick,
  QuickPickItem,
  QuickPickSection,
} from "../command-palette/types.ts";

function adaptQuickPickItem(item: RendererPluginQuickPickItem): QuickPickItem {
  return {
    id: item.id,
    label: item.label,
    ...(item.aliases ? { aliases: item.aliases } : {}),
    ...(item.badges ? { badges: item.badges } : {}),
    ...(item.checked == null ? {} : { checked: item.checked }),
    ...("data" in item ? { data: item.data } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.disabled == null ? {} : { disabled: item.disabled }),
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.searchTerms ? { searchTerms: item.searchTerms } : {}),
    ...(item.variant ? { variant: item.variant } : {}),
  };
}

function adaptQuickPickSection(
  section: RendererPluginQuickPickSection
): QuickPickSection {
  return {
    heading: section.heading,
    id: section.id,
    items: section.items.map(adaptQuickPickItem),
  };
}

// 一次 openQuickPick 起一个 session：随后的 updateQuickPick 合并进
// pluginQuickPick 并同步刷新 pluginItemsById。hostOnAccept 作为身份 marker。
// lastQuerySignal：每次 onQueryChange 挂上当前 AbortSignal；若已 abort，
// updateQuickPick 丢弃补丁，挡住忽略 signal 的慢请求覆盖新结果。
interface AdaptedQuickPickSession {
  hostOnAccept: QuickPick["onAccept"] | null;
  lastQuerySignal: AbortSignal | null;
  pluginItemsById: Map<string, RendererPluginQuickPickItem>;
  pluginQuickPick: RendererPluginQuickPick;
}

let currentSession: AdaptedQuickPickSession | null = null;

function collectPluginItems(
  quickPick: RendererPluginQuickPick
): readonly RendererPluginQuickPickItem[] {
  return [
    ...(quickPick.items ?? []),
    ...(quickPick.sections?.flatMap((section) => section.items) ?? []),
  ];
}

function adaptQuickPick(session: AdaptedQuickPickSession): QuickPick {
  const pluginItemFor = (item: QuickPickItem): RendererPluginQuickPickItem => {
    const pluginItem = session.pluginItemsById.get(item.id);
    if (!pluginItem) {
      throw new Error(`unknown plugin quick pick item: ${item.id}`);
    }
    return pluginItem;
  };
  const initial = session.pluginQuickPick;
  return {
    ...(initial.errorText ? { errorText: initial.errorText } : {}),
    ...(initial.getQueryItem
      ? {
          getQueryItem: (query: string) => {
            const item = session.pluginQuickPick.getQueryItem?.(query);
            if (!item) {
              return null;
            }
            session.pluginItemsById.set(item.id, item);
            return adaptQuickPickItem(item);
          },
        }
      : {}),
    ...(initial.items ? { items: initial.items.map(adaptQuickPickItem) } : {}),
    ...(initial.loading == null ? {} : { loading: initial.loading }),
    onAccept: (item) => session.pluginQuickPick.onAccept(pluginItemFor(item)),
    ...(initial.onChangeSelection
      ? {
          onChangeSelection: (item: QuickPickItem) =>
            session.pluginQuickPick.onChangeSelection?.(pluginItemFor(item)),
        }
      : {}),
    ...(initial.onDismiss
      ? { onDismiss: () => session.pluginQuickPick.onDismiss?.() }
      : {}),
    ...(initial.onQueryChange
      ? {
          onQueryChange: (query: string, signal: AbortSignal) => {
            session.lastQuerySignal = signal;
            return session.pluginQuickPick.onQueryChange?.(query, signal);
          },
        }
      : {}),
    ...(initial.placeholder ? { placeholder: initial.placeholder } : {}),
    ...(initial.preserveItemOrder == null
      ? {}
      : { preserveItemOrder: initial.preserveItemOrder }),
    ...(initial.renderItem
      ? {
          renderItem: (item: QuickPickItem) =>
            session.pluginQuickPick.renderItem?.(pluginItemFor(item)),
        }
      : {}),
    ...(initial.sections
      ? { sections: initial.sections.map(adaptQuickPickSection) }
      : {}),
    title: initial.title,
  };
}

export function createPluginCommandPaletteContext(): RendererPluginContext["commandPalette"] {
  return {
    openQuickPick: (pluginQuickPick) => {
      const session: AdaptedQuickPickSession = {
        hostOnAccept: null,
        lastQuerySignal: null,
        pluginItemsById: new Map(
          collectPluginItems(pluginQuickPick).map((item) => [item.id, item])
        ),
        pluginQuickPick,
      };
      const hostQuickPick = adaptQuickPick(session);
      session.hostOnAccept = hostQuickPick.onAccept;
      currentSession = session;
      useCommandPaletteController.getState().openQuickPick(hostQuickPick);
    },
    updateQuickPick: (patch) => {
      const session = currentSession;
      if (!session) {
        return;
      }
      const controllerState = useCommandPaletteController.getState();
      // 顶层 picker 已不属于本 session (被别的 openQuickPick 顶掉) → 静默丢弃。
      if (controllerState.quickPick?.onAccept !== session.hostOnAccept) {
        return;
      }
      // 上一次 onQueryChange 已被 abort：丢弃过期异步补丁。
      if (session.lastQuerySignal?.aborted) {
        return;
      }
      session.pluginQuickPick = { ...session.pluginQuickPick, ...patch };
      if ("items" in patch || "sections" in patch) {
        session.pluginItemsById.clear();
        for (const item of collectPluginItems(session.pluginQuickPick)) {
          session.pluginItemsById.set(item.id, item);
        }
      }
      const hostPatch: { -readonly [K in keyof QuickPick]?: QuickPick[K] } = {};
      if ("errorText" in patch) {
        hostPatch.errorText = patch.errorText;
      }
      if ("loading" in patch) {
        hostPatch.loading = patch.loading;
      }
      if ("placeholder" in patch) {
        hostPatch.placeholder = patch.placeholder;
      }
      if ("preserveItemOrder" in patch) {
        hostPatch.preserveItemOrder = patch.preserveItemOrder;
      }
      if ("title" in patch && patch.title !== undefined) {
        hostPatch.title = patch.title;
      }
      if ("items" in patch) {
        hostPatch.items = patch.items?.map(adaptQuickPickItem);
      }
      if ("sections" in patch) {
        hostPatch.sections = patch.sections?.map(adaptQuickPickSection);
      }
      controllerState.updateQuickPick(hostPatch);
    },
  };
}
