---
name: pier-subagent-panels
description: >-
  Delegate work to sub-agents as visible Pier terminal panels. Check your
  agent type first: if you are Claude Code with teams mode active, use your
  native teammate spawning instead (the adapter already maps teammates to
  Pier panels). For all other agents (omp, codex, opencode without omo,
  gemini, etc.), use `pier agents start` to delegate work into observable
  Pier panels.
compatibility: >-
  Requires running inside a Pier agent panel (PIER_PANEL_ID /
  PIER_WINDOW_ID must be set by the host).
disable-model-invocation: true
---

# Delegate Work to Subagent Panels

Spawn sub-agents in Pier background tabs so the user can watch, interject,
or take over the session.

## Agent-specific guidance

**Claude Code (teams preset active):**
Do NOT use this skill. Your native teammate spawning already goes through
the Pier adapter — teammates automatically appear as Pier panels.

**All other agents (omp, codex, opencode, gemini, etc.):**
Use the delegation CLI below. This is the only way to get your sub-agents
into visible Pier panels.

## Delegation CLI

```bash
# ALWAYS pass --cwd "$(pwd)" — ensures the sub-agent works in the same
# project directory as you (avoids Claude Code's workspace trust prompt
# in $HOME, and keeps the sub-agent on the correct project).
pier agents start <agentId> --stdin --cwd "$(pwd)" [--placement tab|right|below]
```

- Default `tab`: background tab, no focus steal.
- `right` / `below`: split anchored to your panel.

## Verbs

- `pier agents start <agentId> --stdin` — spawn + deliver first prompt
- `pier agents turn --runtime <id> --boot <id> --generation <n> --stdin` — follow-up
- `pier agents screen ...` — capture viewport (bounded, no scrollback)
- `pier agents wait ... --until ready|waiting|exited|attention` — state
  predicate, NOT a completion verdict

## When to delegate vs built-in subagents

- Short, synchronous, result-only → built-in task/subagents
- Long-running, parallel, needs user visibility → delegate to panel

## Retry

Failed `agents.start` may carry `details: { operationId, observedBootId,
scope: "same-boot", crashAmbiguous, safeToRetry }`.

- Timeout/unknown outcome: re-issue with SAME `--operation-id` (idempotent,
  never double-spawns)
- Definitive failure replayed: fix cause, start NEW attempt with FRESH id
- Same-boot only; after restart, fresh start needs no credentials

## Escape hatch

`PIER_AGENT_PANELS_DISABLED=1` → `pier agents start` fails at parse time.
