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

function indexPluginQuickPickItems(
  quickPick: RendererPluginQuickPick
): ReadonlyMap<string, RendererPluginQuickPickItem> {
  const items = [
    ...(quickPick.items ?? []),
    ...(quickPick.sections?.flatMap((section) => section.items) ?? []),
  ];
  return new Map(items.map((item) => [item.id, item]));
}

function adaptQuickPick(quickPick: RendererPluginQuickPick): QuickPick {
  const pluginItemsById = indexPluginQuickPickItems(quickPick);
  const pluginItemFor = (item: QuickPickItem): RendererPluginQuickPickItem => {
    const pluginItem = pluginItemsById.get(item.id);
    if (!pluginItem) {
      throw new Error(`unknown plugin quick pick item: ${item.id}`);
    }
    return pluginItem;
  };
  return {
    ...(quickPick.getQueryItem
      ? {
          getQueryItem: (query: string) => {
            const item = quickPick.getQueryItem?.(query);
            return item ? adaptQuickPickItem(item) : null;
          },
        }
      : {}),
    onAccept: (item) => quickPick.onAccept(pluginItemFor(item)),
    ...(quickPick.items
      ? { items: quickPick.items.map(adaptQuickPickItem) }
      : {}),
    ...(quickPick.onChangeSelection
      ? {
          onChangeSelection: (item: QuickPickItem) =>
            quickPick.onChangeSelection?.(pluginItemFor(item)),
        }
      : {}),
    ...(quickPick.onDismiss ? { onDismiss: quickPick.onDismiss } : {}),
    ...(quickPick.placeholder ? { placeholder: quickPick.placeholder } : {}),
    ...(quickPick.renderItem
      ? {
          renderItem: (item: QuickPickItem) =>
            quickPick.renderItem?.(pluginItemFor(item)),
        }
      : {}),
    ...(quickPick.sections
      ? { sections: quickPick.sections.map(adaptQuickPickSection) }
      : {}),
    title: quickPick.title,
  };
}

export function createPluginCommandPaletteContext(): RendererPluginContext["commandPalette"] {
  return {
    openQuickPick: (quickPick) =>
      useCommandPaletteController
        .getState()
        .openQuickPick(adaptQuickPick(quickPick)),
  };
}
