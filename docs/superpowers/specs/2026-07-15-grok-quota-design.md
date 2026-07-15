# Grok Account Quota (终态) Design

Date: 2026-07-15  
Status: approved for implementation  
Plugin: `pier.grok` (`packages/plugin-grok`)

## Problem

`pier.grok` v1 intentionally shipped without quota UI (`quotaUnavailable`). Product now requires a **complete end-state**: no missing quota capability, no fake meters, Codex-aligned multi-window rate-limit dashboard.

## Decisions (locked)

1. **UI shape:** Codex-compatible multi-window Progress meters (`windows[]`), not a separate billing card DTO.
2. **OIDC:** real usage from Grok CLI chat-proxy billing endpoint using the managed OIDC session token.
3. **API key:** no fake data; fixed error status explaining OIDC is required for quota.
4. **No Management API / Management Key** in this change.
5. Remove product surface copy `Quota monitoring is not available yet` / `暂不支持配额监测`.

## Data source

```
GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
Authorization: Bearer <OIDC session key from managed auth.json entry `.key`>
x-grok-client-version: pier-plugin-grok/1.0.0
x-grok-client-mode: cli
Accept: application/json
```

Verified against a local OIDC `~/.grok/auth.json` session token. Response shape:

```json
{
  "config": {
    "currentPeriod": {
      "type": "USAGE_PERIOD_TYPE_WEEKLY",
      "start": "ISO-8601",
      "end": "ISO-8601"
    },
    "creditUsagePercent": 100.0,
    "onDemandCap": { "val": "0" },
    "onDemandUsed": { "val": "0" },
    "productUsage": [
      { "product": "Api", "usagePercent": 99.0 },
      { "product": "GrokBuild", "usagePercent": 1.0 }
    ],
    "prepaidBalance": { "val": "0" },
    "billingPeriodStart": "ISO-8601",
    "billingPeriodEnd": "ISO-8601"
  }
}
```

Notes:
- Monetary `val` fields are USD cents strings when present; quota meters use **percent** fields first.
- OAuth session tokens are rejected by `management-api.x.ai` (403). Do not use Management API for OIDC users.
- Inference API key is not a substitute for this billing endpoint.

## Window mapping

Produce Codex-shaped windows:

| id | limitId | limitName | usedPercent | resetsAt / windowMinutes |
|---|---|---|---|---|
| `grok:period` | `period` | Weekly/Monthly limit from `currentPeriod.type` | `creditUsagePercent` | `end` → ms; minutes from start→end when both parse |
| `grok:product:<Product>` | `product` | Display name (`API`, `Grok Build`, or raw product) | `usagePercent` | inherit period end/minutes |
| `grok:on-demand` | `on-demand` | On-demand | `onDemandUsed/onDemandCap * 100` | none; **omit if cap ≤ 0** |

Order: period → productUsage array order → optional on-demand.

Clamp/normalize finite percents; non-finite → skip window.

## Account kind rules

- **OIDC:** with managed auth unlock → extract newest usable OIDC entry `key` → HTTP GET → parse.
- **API key:** short-circuit  
  `status: "error"`,  
  `error: "API key accounts cannot report Grok quota — switch to an OIDC account"`,  
  `windows: []`.
- Missing session key / HTTP failure / parse failure → `status: "error"` with actionable message; retain last good windows in cache when previous ok exists (Codex cache retention behavior).

## Service behavior

Mirror Codex accounts usage loop:

- In-memory `usageCache` keyed by account id (and active key helper).
- `USAGE_MIN_REFETCH_MS = 5 * 60 * 1000`
- `USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000`
- Poll only when usage-polling consumers > 0.
- `refreshUsage({ accountId?, force? })` real (no longer no-op).
- Force refresh after select and after add that activates an account.
- Snapshot includes:
  - `accounts[].usage: GrokUsageSnapshot | null`
  - `activeUsage: GrokUsageSnapshot | null`
- `null` usage means first fetch not finished; object means request completed (ok or error).

## Snapshot DTO additions

```ts
export interface GrokUsageWindow {
  id: string;
  limitId: string;
  limitName?: string;
  resetsAt?: number;
  usedPercent: number;
  windowMinutes?: number;
}

export interface GrokUsageSnapshot {
  error?: string;
  fetchedAt: number;
  raw?: unknown;
  status: "ok" | "error";
  windows: GrokUsageWindow[];
}
```

`schemaVersion` remains `1` (additive fields only; no migration).

## UI

### Widget
- Remove `quotaUnavailable` empty text.
- Render:
  - no usage yet → skeleton
  - ok → multi-window Progress meters
  - error → WidgetError with message
- `plugin.json` workbench widget: `refreshable: true`
- Header refresh action invokes `accounts.refreshUsage` and shows success/error feedback (Codex pattern).

### Settings
- Active account card: quota group + refresh button.
- Other accounts: optional compact usage if present; no peer-sync UI.

### i18n
Add `pier.grok.usage.*` and refresh strings (en + zh-CN). Remove product reliance on `pier.grok.widget.quotaUnavailable` (key may be deleted).

## Files

**Create**
- `packages/plugin-grok/src/main/grok-usage.ts`
- `packages/plugin-grok/src/main/billing-parse.ts`
- `packages/plugin-grok/src/main/accounts-usage.ts`
- `packages/plugin-grok/src/main/usage-refresh-scheduler.ts`
- `packages/plugin-grok/src/shared/usage.ts`
- `packages/plugin-grok/src/renderer/usage-meter.tsx`
- `packages/plugin-grok/src/renderer/use-accounts-refresh.ts` (if settings needs shared refresh busy state)

**Modify**
- shared accounts DTOs, provider, service, snapshot, contract, index, rpc (if needed)
- renderer widget/settings/account-display/format-error
- `plugin.json` locales + `refreshable: true`
- unit tests for parse/provider/service/widget/settings

## Tests (acceptance)

1. Billing fixture → period + product windows; on-demand only when cap>0.
2. Provider/fetch: OIDC sends Bearer session key; API key short-circuits with fixed error.
3. Service: `refreshUsage` mutates snapshot; no poll without lease; select force-refreshes.
4. Widget: meters present for ok usage; no “Quota monitoring is not available yet”; manage settings still opens `plugin:pier.grok`.
5. Settings: refresh button triggers RPC; API key error surfaces.

## Non-goals

- Management API / Management Key
- peer-tool sync
- rewriting user `~/.grok/config.toml`
- permanent host-global `XAI_API_KEY`
- inventing windows when billing fails

## Success criteria

1. OIDC active account shows ≥1 real Progress window.
2. Manual refresh and visible-lease polling update `fetchedAt`.
3. API key active account shows explicit error, zero fake bars.
4. No `quotaUnavailable` product string.
5. Targeted unit tests pass; plugin builds.
