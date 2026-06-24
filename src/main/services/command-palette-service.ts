import {
  EMPTY_MRU_STATE,
  type MruState,
} from "@shared/contracts/command-palette-mru.ts";
import {
  readMruState as readMruStateDefault,
  recordUse as recordMruUse,
  writeMruState as writeMruStateDefault,
} from "../state/command-palette-mru.ts";

export interface CommandPaletteMruService {
  clear(): Promise<MruState>;
  read(): Promise<MruState>;
  recordUse(actionId: string): Promise<void>;
}

export interface CreateCommandPaletteMruServiceArgs {
  broadcast: (state: MruState) => void;
  now?: () => number;
  readMruState?: () => Promise<MruState>;
  writeMruState?: (state: MruState) => Promise<void>;
}

function isValidActionId(actionId: string): boolean {
  return actionId.length > 0 && actionId.length <= 128;
}

export function createCommandPaletteMruService({
  broadcast,
  now = () => Date.now(),
  readMruState = readMruStateDefault,
  writeMruState = writeMruStateDefault,
}: CreateCommandPaletteMruServiceArgs): CommandPaletteMruService {
  let memo: MruState | null = null;
  let memoPromise: Promise<MruState> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  function ensureLoaded(): Promise<MruState> {
    if (memo) {
      return Promise.resolve(memo);
    }
    if (memoPromise) {
      return memoPromise;
    }
    memoPromise = readMruState()
      .then((state) => {
        memo = state;
        return state;
      })
      .finally(() => {
        memoPromise = null;
      });
    return memoPromise;
  }

  return {
    clear: () =>
      enqueue(async () => {
        await ensureLoaded();
        await writeMruState(EMPTY_MRU_STATE);
        memo = EMPTY_MRU_STATE;
        broadcast(EMPTY_MRU_STATE);
        return EMPTY_MRU_STATE;
      }),
    read: () => ensureLoaded(),
    async recordUse(actionId) {
      if (!isValidActionId(actionId)) {
        return;
      }
      await enqueue(async () => {
        const prev = await ensureLoaded();
        const next = recordMruUse(prev, actionId, now());
        await writeMruState(next);
        memo = next;
        broadcast(next);
      });
    },
  };
}
