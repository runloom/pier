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

/**
 * One openQuickPick → one session. Each onQueryChange bumps queryGeneration and
 * stamps the AbortSignal. updateQuickPick(patch, { signal }) only applies when
 * signal is the latest query's signal and not aborted — so a slow query A cannot
 * overwrite query B after A was superseded.
 */
interface AdaptedQuickPickSession {
  hostOnAccept: QuickPick["onAccept"] | null;
  lastQuerySignal: AbortSignal | null;
  pluginItemsById: Map<string, RendererPluginQuickPickItem>;
  pluginQuickPick: RendererPluginQuickPick;
  queryGeneration: number;
  signalGeneration: WeakMap<AbortSignal, number>;
}

function collectPluginItems(
  quickPick: RendererPluginQuickPick
): readonly RendererPluginQuickPickItem[] {
  return [
    ...(quickPick.items ?? []),
    ...(quickPick.sections?.flatMap((section) => section.items) ?? []),
  ];
}

function applyHostPatch(
  session: AdaptedQuickPickSession,
  patch: Partial<RendererPluginQuickPick>
): void {
  const controllerState = useCommandPaletteController.getState();
  if (controllerState.quickPick?.onAccept !== session.hostOnAccept) {
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
            session.queryGeneration += 1;
            session.lastQuerySignal = signal;
            session.signalGeneration.set(signal, session.queryGeneration);
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

interface PluginQuickPickUpdateOptions {
  /** When set, drop the patch if this signal aborted or is not the latest query. */
  readonly signal?: AbortSignal;
}

export function createPluginCommandPaletteContext(): RendererPluginContext["commandPalette"] {
  let currentSession: AdaptedQuickPickSession | null = null;
  return {
    openQuickPick: (pluginQuickPick) => {
      const session: AdaptedQuickPickSession = {
        hostOnAccept: null,
        lastQuerySignal: null,
        pluginItemsById: new Map(
          collectPluginItems(pluginQuickPick).map((item) => [item.id, item])
        ),
        pluginQuickPick,
        queryGeneration: 0,
        signalGeneration: new WeakMap(),
      };
      const hostQuickPick = adaptQuickPick(session);
      session.hostOnAccept = hostQuickPick.onAccept;
      currentSession = session;
      useCommandPaletteController.getState().openQuickPick(hostQuickPick);
    },
    updateQuickPick: (patch, options?: PluginQuickPickUpdateOptions) => {
      const session = currentSession;
      if (!session) {
        return;
      }
      const signal = options?.signal;
      if (signal) {
        if (signal.aborted) {
          return;
        }
        const generation = session.signalGeneration.get(signal);
        if (
          generation === undefined ||
          generation !== session.queryGeneration
        ) {
          return;
        }
      } else if (session.queryGeneration > 0) {
        // Async query session without a signal stamp: reject to prevent stale
        // writes. Callers must pass the onQueryChange AbortSignal.
        return;
      }
      applyHostPatch(session, patch);
    },
  };
}
