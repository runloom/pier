import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  readRecentPanelContexts,
  recordRecentPanelContext,
} from "../state/panel-context-state.ts";
import { resolvePanelContextForPath } from "./panel-context-resolver.ts";

export interface PanelContextService {
  listRecent(): Promise<PanelContext[]>;
  recordRecent(context: PanelContext): Promise<void>;
  resolveForPath(path: string): Promise<PanelContext>;
}

export function createPanelContextService(): PanelContextService {
  return {
    listRecent: readRecentPanelContexts,
    recordRecent: recordRecentPanelContext,
    resolveForPath: resolvePanelContextForPath,
  };
}
