/**
 * 同窗文件 tab 身份注册表 — 供短标题冲突消歧。
 * 各 file panel tab 头 mount 时 register，卸载 unregister。
 * titlesById 在 register/unregister 时算一次，header / overflow 只读。
 */

import { create } from "zustand";
import {
  disambiguateFileTabTitles,
  type FileTabDisambiguationEntry,
} from "@/lib/files/disambiguate-tab-titles.ts";

export type FileTabLabelIdentity = Omit<FileTabDisambiguationEntry, "panelId">;

interface FileTabLabelsState {
  byId: Record<string, FileTabLabelIdentity>;
  register: (panelId: string, identity: FileTabLabelIdentity) => void;
  /** panelId → 消歧后短标题；与 byId 同步维护。 */
  titlesById: Record<string, string>;
  unregister: (panelId: string) => void;
}

function sameIdentity(
  left: FileTabLabelIdentity | undefined,
  right: FileTabLabelIdentity
): boolean {
  return (
    left !== undefined &&
    left.groupId === right.groupId &&
    left.path === right.path &&
    left.root === right.root
  );
}

function recomputeTitlesById(
  byId: Record<string, FileTabLabelIdentity>
): Record<string, string> {
  const entries: FileTabDisambiguationEntry[] = Object.entries(byId).map(
    ([panelId, identity]) => ({
      panelId,
      groupId: identity.groupId,
      path: identity.path,
      root: identity.root,
    })
  );
  const map = disambiguateFileTabTitles(entries);
  const titlesById: Record<string, string> = {};
  for (const [panelId, title] of map) {
    titlesById[panelId] = title;
  }
  return titlesById;
}

export const useFileTabLabelsStore = create<FileTabLabelsState>((set, get) => ({
  byId: {},
  titlesById: {},
  register: (panelId, identity) => {
    const current = get().byId[panelId];
    if (sameIdentity(current, identity)) {
      return;
    }
    set((state) => {
      const byId = { ...state.byId, [panelId]: identity };
      return { byId, titlesById: recomputeTitlesById(byId) };
    });
  },
  unregister: (panelId) => {
    if (!(panelId in get().byId)) {
      return;
    }
    set((state) => {
      const byId = { ...state.byId };
      delete byId[panelId];
      return { byId, titlesById: recomputeTitlesById(byId) };
    });
  },
}));

/** 本 panel 的消歧短标题；未注册返回 null。 */
export function selectDisambiguatedFileTabTitle(
  state: Pick<FileTabLabelsState, "titlesById">,
  panelId: string
): string | null {
  return state.titlesById[panelId] ?? null;
}
