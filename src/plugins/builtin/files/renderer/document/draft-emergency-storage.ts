function draftStorage(): Storage | null {
  try {
    // sessionStorage 以 BrowserWindow 为边界；localStorage 会让不同窗口把
    // emergency 条目迁入各自 main owner，造成跨窗口覆盖或 tombstone 误删。
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readEmergencyDraft(key: string): string | null {
  try {
    return draftStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeEmergencyDraft(key: string, value: string): boolean {
  try {
    const storage = draftStorage();
    if (!storage) {
      return false;
    }
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeEmergencyDraft(key: string): void {
  try {
    draftStorage()?.removeItem(key);
  } catch {
    // Main-process persistence remains authoritative when emergency storage fails.
  }
}

export function emergencyDraftEntries(): Array<readonly [string, string]> {
  try {
    const storage = draftStorage();
    if (!storage) {
      return [];
    }
    const entries: Array<readonly [string, string]> = [];
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key !== null) {
        const value = storage.getItem(key);
        if (value !== null) {
          entries.push([key, value]);
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}
