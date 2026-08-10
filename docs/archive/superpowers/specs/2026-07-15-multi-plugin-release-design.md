# Multi-plugin release workflow design

Date: 2026-07-15

## Problem

`.github/workflows/release-plugin.yml` refuses any push to `main` that changes
more than one `packages/plugin-*/package.json`:

```text
expected exactly one changed plugin package.json, found 2
```

PR #88 merged `plugin-codex@1.3.1` and `plugin-grok@1.0.0` in one commit and
tripped this guard. Release assets already existed, so product impact was low,
but the automated release job still failed and the process blocks legitimate
multi-plugin merges.

Current docs and governance tests encode the same "exactly one" rule:

- `docs/plugins.md` requires one package.json change per main merge
- `tests/unit/main/managed-plugin-packaging-governance.test.ts` asserts the
  failure string exists in the workflow

## Goal

When a push to `main` changes one or more official plugin package manifests,
the release workflow must:

1. release every changed plugin in one job
2. preserve immutable same-version asset checks
3. regenerate and commit the official index once at the end

`workflow_dispatch` remains a single-plugin recovery path.

## Non-goals

- Parallel matrix jobs
- Changing release tag or asset naming
- Changing Ed25519 signing keys / key rotation
- Auto-splitting PRs
- Releasing plugins whose `package.json` did not change

## Decision

Use one job, serial per-plugin release, single index regeneration.

Why not matrix:

- multiple jobs would race on `plugins/index.v1.json` commits
- plugin count is tiny; serial pack/publish cost is acceptable
- immutability checks stay simple in one runner

## Behavior

### Trigger

Unchanged:

- `push` to `main` with path filter `packages/plugin-*/package.json`
- `workflow_dispatch` with `plugin` + `version`

### Resolve

For `push`:

1. `git diff --name-only $BEFORE $SHA -- 'packages/plugin-*/package.json'`
2. require `COUNT >= 1` (fail if zero after path filter noise)
3. for each changed file:
   - derive `tail` from `packages/plugin-<tail>/package.json`
   - read `version` from that package.json
   - build `tag = plugin-<tail>-v<version>`
   - build `package = @pier/plugin-<tail>`
4. emit a JSON array of release targets to `$GITHUB_OUTPUT`

For `workflow_dispatch`:

- emit a one-element array from the provided inputs
- still verify `package.json` declares the requested version

### Release loop

For each target, in deterministic order (sorted by `tail`):

1. `pnpm --filter <package> run build:package`
2. locate the produced `.tgz`, `.sha256`, and size
3. if GitHub Release `tag` is missing: create it with tgz + sha256 sidecar
4. if GitHub Release `tag` exists: download the published tgz and require
   local sha256 == published sha256; hash drift fails the job

Failure policy:

- stop on first failure
- already-published immutable releases remain published
- re-run / dispatch can recover remaining plugins

### Index once

After every target succeeds:

1. run `pnpm plugins:index` with:
   - `PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE=1`
   - existing signing key id / private key secrets
2. if `plugins/index.v1.json` changed, commit once and push to `main`
3. commit message lists every released tag, e.g.
   `chore(plugins): update index for plugin-codex-v1.3.1, plugin-grok-v1.0.0`

Do not regenerate the index between individual plugin releases.

## Files to change

- `.github/workflows/release-plugin.yml`
  - replace single-target resolve with multi-target list
  - loop pack / immutability / publish
  - keep one index commit at the end
- `tests/unit/main/managed-plugin-packaging-governance.test.ts`
  - drop assertion on `expected exactly one changed plugin package.json`
  - assert multi-target resolve + serial loop + single index commit markers
- `docs/plugins.md`
  - replace "one package.json per merge" with multi-plugin serial release rules

## Success criteria

- push changing only `plugin-codex/package.json` still releases codex
- push changing both codex + grok package.json releases both, then one index commit
- existing release with matching sha256 is treated as success, not republished
- existing release with different sha256 fails as hash drift
- `workflow_dispatch` still releases exactly one requested plugin
- governance tests and docs match the new contract

## Out of scope follow-ups

- optional matrix later with distributed lock for index commits
- PR bot that warns when multiple plugin versions change without release notes
