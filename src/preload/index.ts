import { contextBridge } from "electron";

export interface PierWindowAPI {
  platform: NodeJS.Platform;
}

const api: PierWindowAPI = {
  platform: process.platform,
};

contextBridge.exposeInMainWorld("pier", api);
