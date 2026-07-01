import type { IpcMain } from "electron";
import type { SecretsStore } from "../state/secrets-store.ts";

export function registerSecretsIpc(
  ipcMain: IpcMain,
  store: SecretsStore
): void {
  ipcMain.handle("pier:secrets:get", async (_event, key: string) => {
    if (typeof key !== "string" || key.length === 0) {
      return null;
    }
    return await store.get(key);
  });

  ipcMain.handle(
    "pier:secrets:set",
    async (_event, { key, value }: { key: string; value: string }) => {
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("secret key must be a non-empty string");
      }
      if (typeof value !== "string") {
        throw new Error("secret value must be a string");
      }
      await store.set(key, value);
    }
  );

  ipcMain.handle("pier:secrets:delete", async (_event, key: string) => {
    if (typeof key !== "string" || key.length === 0) {
      return;
    }
    await store.delete(key);
  });

  ipcMain.handle("pier:secrets:list", async () => await store.list());
}
