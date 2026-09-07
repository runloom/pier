import { settleInitialInputCheckpoint } from "@main/ipc/terminal/drafts/initial-input.ts";
import { createNativeProcessRegistry } from "@main/ipc/terminal/process/registry.ts";
import { expect, it } from "vitest";

it("keeps a created surface usable when the initial input acknowledgement cannot be saved", async () => {
  const registry = createNativeProcessRegistry();
  const process = registry.begin("1::p");
  registry.created(process);
  const warning = await settleInitialInputCheckpoint(
    process,
    () => Promise.reject(new Error("disk full")),
    true
  );
  expect(warning).toBe("disk full");
  expect(process).toMatchObject({
    created: true,
    closed: false,
    inputDisposition: "unconfirmed",
  });
  expect(registry.inputGuard("1::p")()).toBe(true);
});
