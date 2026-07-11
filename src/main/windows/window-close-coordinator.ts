import type { AppWindow } from "./app-window.ts";

export type WindowCloseDecision = "allow" | "veto";
export type WindowCloseResult = "closed" | "not-found" | "veto";

interface WindowClosePayload {
  recordId: string;
  windowId: string;
}

export class WindowCloseCoordinator {
  readonly #callbacks: Array<
    (
      payload: WindowClosePayload
    ) => Promise<WindowCloseDecision> | WindowCloseDecision
  > = [];
  readonly #done = new WeakSet<AppWindow>();
  readonly #pending = new WeakSet<AppWindow>();
  readonly #waiters = new Map<
    string,
    Set<(result: WindowCloseResult) => void>
  >();

  onBeforeClose(
    callback: (
      payload: WindowClosePayload
    ) => Promise<WindowCloseDecision> | WindowCloseDecision
  ): void {
    this.#callbacks.push(callback);
  }

  intercept(
    window: AppWindow,
    windowId: string,
    payload: WindowClosePayload
  ): boolean {
    if (this.#done.has(window)) {
      return false;
    }
    if (this.#pending.has(window)) {
      return true;
    }
    this.#pending.add(window);
    this.#flush(payload)
      .then((decision) => {
        this.#pending.delete(window);
        if (decision === "veto") {
          this.resolve(windowId, "veto");
          return;
        }
        this.#done.add(window);
        if (!window.isDestroyed()) {
          window.close();
        }
      })
      .catch((error: unknown) => {
        this.#pending.delete(window);
        this.#done.delete(window);
        this.resolve(windowId, "veto");
        console.error(
          "[window-before-close] unexpected failure:",
          error instanceof Error ? error.message : String(error)
        );
      });
    return true;
  }

  wait(windowId: string, window: AppWindow): Promise<WindowCloseResult> {
    if (window.isDestroyed()) {
      return Promise.resolve("not-found");
    }
    return new Promise((resolve) => {
      let waiters = this.#waiters.get(windowId);
      if (!waiters) {
        waiters = new Set();
        this.#waiters.set(windowId, waiters);
      }
      waiters.add(resolve);
      try {
        window.close();
      } catch {
        this.resolve(windowId, "veto");
      }
    });
  }

  resolve(windowId: string, result: WindowCloseResult): void {
    const waiters = this.#waiters.get(windowId);
    if (!waiters) {
      return;
    }
    this.#waiters.delete(windowId);
    for (const resolve of waiters) {
      resolve(result);
    }
  }

  async #flush(payload: WindowClosePayload): Promise<WindowCloseDecision> {
    try {
      const decisions = await Promise.all(
        this.#callbacks.map((callback) => callback(payload))
      );
      return decisions.every((decision) => decision === "allow")
        ? "allow"
        : "veto";
    } catch (error) {
      console.error(
        "[window-before-close] failed:",
        error instanceof Error ? error.message : String(error)
      );
      return "veto";
    }
  }
}
