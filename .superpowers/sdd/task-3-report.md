# Task 3 Report — main commit point, journal, managed windows

**Status:** DONE  
**Commit:** `a17d09b8` — `feat(panel-transfer): main commit engine, journal, and window leases`

## Summary

Completed the main-process panel-transfer engine (plan step 3 / Path B):

- Unique commit point at `runtime-moved` (pre → idempotent rollback; post → idempotent roll-forward)
- Durable journal at `userData/panel-transfers.json` via moved `durable-json-io`
- Lock order: sync `tryClaim` outside locks; claimant runner = `runPluginMutation` → `runExclusive`
- Window leases: `runExclusive` / `createForTransfer` / `closeAfterTransfer` / `destroyForTransfer`
- Renderer reply identity: `send()` returns `webContents.id`; mismatch ignored
- Startup: `recoverPending()` before orphan reconcile + `restoreOpenWindows()`
- Files/terminal ports are injectable no-ops for Tasks 5/6

## TDD evidence

Focused vitest (required list + app-core path for renderer-command tests):

```bash
pnpm exec vitest run \
  tests/unit/main/panel-transfer-service.test.ts \
  tests/unit/main/panel-transfer-journal.test.ts \
  tests/unit/app-core/renderer-command-service.test.ts \
  tests/unit/main/window-service.test.ts \
  tests/unit/main/window-manager-webcontents-view.test.ts
```

**Result:** 5 files / **73 tests passed**.

Coverage highlights:

| Area | Tests |
|------|--------|
| Journal load/write/corrupt non-wipe | `panel-transfer-journal.test.ts` |
| Claim uniqueness, unsupported no window, finishDrag null on managed claim, outside→createForTransfer, rollback vs roll-forward, bootstrap filter, recoverPending pre/post, target_conflict, lease-required create | `panel-transfer-service.test.ts` |
| webContents mismatch ignored | `renderer-command-service.test.ts` |
| runExclusive / createForTransfer lease | `window-service.test.ts` |
| destroyForTransfer + transferDestroy flag | `window-manager-webcontents-view.test.ts` |

## Files

### Created
- `src/main/services/panel-transfer/panel-transfer-types.ts`
- `src/main/services/panel-transfer/panel-transfer-service.ts`
- `src/main/services/panel-transfer/panel-transfer-transaction.ts`
- `src/main/services/panel-transfer/panel-transfer-commit.ts`
- `src/main/services/panel-transfer/panel-transfer-recovery.ts`
- `src/main/services/panel-transfer/panel-transfer-helpers.ts`
- `src/main/services/panel-transfer/panel-transfer-lifecycle.ts`
- `src/main/services/panel-transfer/panel-transfer-phase-utils.ts`
- `src/main/services/panel-transfer/panel-transfer-renderer-port.ts`
- `src/main/state/panel-transfer-journal.ts`
- `src/main/state/durable-json-io.ts` (moved)
- `src/main/app-core/panel-transfer-commands.ts`
- `src/main/app-core/app-core-panel-transfer.ts`
- `src/main/services/window-close-preparation.ts`
- `src/main/windows/window-factory.ts`
- `tests/unit/main/panel-transfer-service.test.ts`
- `tests/unit/main/panel-transfer-journal.test.ts`

### Modified
- Window service/manager/show-gate, renderer-command host/service/ipc
- command-execution-context (`runtimeWindowId`), ipc/command injection
- app-core, command-router, command-router-services, index.ts startup order
- file-drafts-storage import → durable-json-io
- Related unit tests

## Lock / commit-point notes

1. **Claim:** `tryClaim` is synchronous (writes claimant + deferred Promise, no await). Runner starts on microtask.
2. **Runner locks:** only claimant executes `pluginDisableTransitions.runPluginMutation(() => windows.runExclusive(...))`.
3. **Internal new window:** claim internal target first (`pending:${transferId}`), then `createForTransfer` under the same exclusive lease.
4. **Commit point:** after terminal/files commit ports + journal write `runtime-moved`. Failures before that call `rollbackBeforeCommit`; after that only `rollForwardAfterRuntimeMoved`.
5. **finishDrag (Path B):** 500ms drop window → managed claim returns `null` to source → cursor classification via geometry port (source/managed/outside) → outside only creates window.
6. **Close:** `signalWindowClosing` = AbortController only; `settleWindowBeforeClose` aborts no-side-effect claims without plugin lock/adapters.

## Stubs remaining for Task 5/6

| Port | Production fill |
|------|-----------------|
| `PanelTransferFilesPort` (`stageDrafts`/`commitDrafts`/`rollbackDrafts`) | Task 5 FileDraftsService.stageTransfer |
| `PanelTransferTerminalPort` (`stageLease`/`commitMove`/`rollback`) | Task 6 Ghostty/session ownership move |
| `PanelTransferWorkspacePort.hasPanelId` | Currently always `false`; Task 4+ can query live layout/session maps |
| Renderer commands (`prepareSource`/`stageTarget`/`releaseSource`/`finalize`) | Task 4 Dockview/workspace wiring |

Production wiring uses no-op files/terminal ports so journal phase structure is exercised without native Ghostty or draft IO.

## Deviations / notes

- Required test path `tests/unit/main/renderer-command-service.test.ts` lives at `tests/unit/app-core/renderer-command-service.test.ts` in this repo; updated there.
- God-file hard cap (500) forced splits: window-close-preparation, window-factory, app-core-panel-transfer, panel-transfer-{commit,helpers,lifecycle,phase-utils,renderer-port}.
- `hasPanelId` production always false until layout inspection exists; unit tests inject the port.


## Review fixes (post Task 3)
**Status:** DONE  
**Commit:** `dbcce05d` — `fix(panel-transfer): guard source close and retain post-commit journal`

Addressed Critical/Important findings from Task 3 review:

1. **Critical — `closeAfterTransfer` empty-source only**
   - Reads durable layout via `readWindowRecordLayout`; no-ops when panels remain.
   - Only last-tab path marks record closed + `destroyForTransfer`.
   - Helper: `isTransferSourceLayoutEmpty`.

2. **Critical — `recoverPending` retains post-commit journal at cold start**
   - Removed “managed target not in `windows.list()` → journal.remove” branch.
   - Empty live list (pre-`restoreOpenWindows`) no longer drops `runtime-moved+` records with snapshot.
   - Still removes truly unrecoverable records (no snapshot/target).

3. **Important — pre-commit rollback destroys internal targets**
   - `rollbackBeforeCommit` accepts optional `lease`; live runner passes it.
   - Internal targets: `releaseRendererShow` then `destroyForTransfer(lease, …)`.
   - New `WindowService.destroyForTransfer` + window port method (lease-guarded).

4. **Important — journal parse failure native dialog**
   - `reportJournalParseFailure` uses `dialog.showErrorBox` with journal path (zh/en); file not wiped.

### Verification

```bash
pnpm exec vitest run \
  tests/unit/main/panel-transfer-service.test.ts \
  tests/unit/main/panel-transfer-journal.test.ts \
  tests/unit/app-core/renderer-command-service.test.ts \
  tests/unit/main/window-service.test.ts \
  tests/unit/main/window-manager-webcontents-view.test.ts
```

**Result:** 5 files / **79 tests passed**.

New/adjusted coverage:
- multi-tab source: `closeAfterTransfer` no-op when layout has panels
- empty layout: destroy path runs
- recoverPending post-commit with zero live windows retains journal
- rollback destroys internal `createForTransfer` target
- parse failure hook invoked (production wires native dialog)

## Review residual fixes (fix2)
**Status:** DONE  
**Commit:** `9f77a224` — `fix(panel-transfer): match bootstrap by recordId and close cold internal records`

Addressed two residual Important findings from re-review:

1. **Important — bootstrap/ready match by durable `windowRecordId`**
   - `bootstrap()` / `ready()` attach pending transfers by `windowRecordId` (+ role), not process-local `runtimeWindowId`.
   - On `ready` roll-forward, refresh source/target runtime ids from the live window list / caller and upsert journal before finalize so restored WebContents are addressed.
   - `recoverPostCommit` source-still-open check also uses `recordId`.

2. **Important — cold pre-commit abort closes orphan internal open-records**
   - Live rollback with lease still `destroyForTransfer`.
   - Cold path (no lease): `PanelTransferWindowPort.closeOpenWindowRecord(recordId)` → `markWindowRecordClosed` + `flushWindowRecordState` so `restoreOpenWindows` will not recreate an empty aborted transfer window.
   - Skips `pending:` placeholders (pre-create claim ids).

### Verification

```bash
pnpm exec vitest run \
  tests/unit/main/panel-transfer-service.test.ts \
  tests/unit/main/panel-transfer-journal.test.ts \
  tests/unit/app-core/renderer-command-service.test.ts \
  tests/unit/main/window-service.test.ts \
  tests/unit/main/window-manager-webcontents-view.test.ts
```

**Result:** 5 files / **82 tests passed**.

New coverage:
- bootstrap/ready with stale runtime ids + same recordId after restore
- recoverPending cold pre-commit internal target → `closeOpenWindowRecord`
- `WindowService.closeOpenWindowRecord` marks closed + flush; ignores `pending:`