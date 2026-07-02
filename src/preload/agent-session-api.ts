import type { AgentSessionsBroadcast } from "@shared/contracts/agent-session.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierAgentSessionsAPI {
  onChanged: (cb: (b: AgentSessionsBroadcast) => void) => () => void;
  snapshot: () => Promise<AgentSessionsBroadcast>;
}

export const agentSessionsApi: PierAgentSessionsAPI = {
  onChanged: (cb) => {
    const listener = (_event: unknown, payload: AgentSessionsBroadcast) => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.AGENT_SESSIONS_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.AGENT_SESSIONS_CHANGED, listener);
    };
  },
  snapshot: () => ipcRenderer.invoke("pier:agent-session:snapshot"),
};
