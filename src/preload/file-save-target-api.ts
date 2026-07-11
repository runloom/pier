import type {
  FileSaveTargetRequest,
  FileSaveTargetResult,
} from "@shared/contracts/file-save-target.ts";
import { fileSaveTargetResultSchema } from "@shared/contracts/file-save-target.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierFileSaveTargetAPI {
  pickSaveTarget(request: FileSaveTargetRequest): Promise<FileSaveTargetResult>;
}

export const fileSaveTargetApi: PierFileSaveTargetAPI = {
  pickSaveTarget: (request) =>
    ipcRenderer
      .invoke(PIER.FILE_PICK_SAVE_TARGET, request)
      .then((result) => fileSaveTargetResultSchema.parse(result)),
};
