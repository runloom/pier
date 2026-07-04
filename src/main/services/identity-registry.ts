// 面板身份注册表 — 纯数据层，无 Electron 依赖

export interface IdentityRegistry {
  registerPanel(panelId: string, windowRecordId: string): void;
  /** 返回 "windowRecordId::panelId"，面板未注册时抛异常 */
  scopeForNative(panelId: string): string;
  unregisterPanel(panelId: string): void;
  /** 去掉 "::" 前缀，返回原始 panelId */
  unscopeFromNative(nativeKey: string): string;
  windowOfPanel(panelId: string): string | null;
}

export function createIdentityRegistry(): IdentityRegistry {
  const panels = new Map<string, string>(); // panelId → windowRecordId

  return {
    registerPanel(panelId, windowRecordId) {
      panels.set(panelId, windowRecordId);
    },

    unregisterPanel(panelId) {
      panels.delete(panelId);
    },

    windowOfPanel(panelId) {
      return panels.get(panelId) ?? null;
    },

    scopeForNative(panelId) {
      const windowRecordId = panels.get(panelId);
      if (windowRecordId === undefined) {
        throw new Error(`panel not registered: ${panelId}`);
      }
      return `${windowRecordId}::${panelId}`;
    },

    unscopeFromNative(nativeKey) {
      const sep = nativeKey.indexOf("::");
      return sep === -1 ? nativeKey : nativeKey.slice(sep + 2);
    },
  };
}

export const identityRegistry: IdentityRegistry = createIdentityRegistry();
