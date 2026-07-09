export type PanelCloseGuard = (input: {
  closingPanelIds?: readonly string[];
  componentId: string;
  panelId: string;
  params?: unknown;
}) => boolean | Promise<boolean>;

interface GuardEntry {
  componentId: string;
  guard: PanelCloseGuard;
}

const guards = new Set<GuardEntry>();

export function registerPanelCloseGuard(
  componentId: string,
  guard: PanelCloseGuard
): () => void {
  const entry: GuardEntry = { componentId, guard };
  guards.add(entry);
  return () => {
    guards.delete(entry);
  };
}

export async function runPanelCloseGuards(input: {
  closingPanelIds?: readonly string[];
  componentId: string;
  panelId: string;
  params?: unknown;
}): Promise<boolean> {
  for (const entry of [...guards]) {
    if (entry.componentId !== input.componentId) {
      continue;
    }
    const allowed = await entry.guard(input);
    if (!allowed) {
      return false;
    }
  }
  return true;
}

export function clearPanelCloseGuards(): void {
  guards.clear();
}
