import { beforeEach, expect, it } from "vitest";
import {
  resetTerminalEndStateStoreForTests,
  useTerminalEndStateStore,
} from "../../../../../src/renderer/stores/terminal-end-state.store.ts";

beforeEach(resetTerminalEndStateStoreForTests);
it("rejects delayed exit and injection acknowledgements after relaunch", () => {
  const store = useTerminalEndStateStore.getState();
  store.acceptProcess("t", 4);
  store.upsertAgentEnd({
    panelId: "t",
    agentId: "codex",
    generation: 4,
    exitCode: 1,
  });
  store.beginRelaunch("t");
  store.upsertAgentEnd({
    panelId: "t",
    agentId: "codex",
    generation: 4,
    exitCode: 1,
  });
  expect(useTerminalEndStateStore.getState().ends.t).toBeUndefined();
  store.acceptProcess("t", 5);
  store.upsertAgentEnd({
    panelId: "t",
    agentId: "codex",
    generation: 5,
    exitCode: 0,
  });
  store.markBufferInjected("t", 4);
  expect(useTerminalEndStateStore.getState().ends.t?.bufferInjected).not.toBe(
    true
  );
  expect(useTerminalEndStateStore.getState().ends.t?.exitCode).toBe(0);
});
it("preserves a fast exit received before the create acknowledgement", () => {
  const store = useTerminalEndStateStore.getState();
  store.upsertAgentEnd({
    panelId: "t",
    agentId: "codex",
    generation: 6,
    exitCode: 2,
  });
  store.acceptProcess("t", 6);
  expect(useTerminalEndStateStore.getState().ends.t?.exitCode).toBe(2);
});
