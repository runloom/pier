# Multi-plugin Serial Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one `main` push that changes multiple `packages/plugin-*/package.json` files release every changed plugin serially in one job, then regenerate the official index once.

**Architecture:** Keep a single `release` job on `macos-latest`. Resolve a JSON array of targets (push: all changed package.json files; dispatch: one input). Loop pack → immutable check / create release with `gh`. After all targets succeed, run `pnpm plugins:index` once and commit if needed.

**Tech Stack:** GitHub Actions, `gh`, pnpm, vitest governance string assertions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-multi-plugin-release-design.md`
- No matrix / parallel release jobs
- Preserve same-version sha256 immutability
- Preserve Ed25519 required signing for index regeneration
- `workflow_dispatch` remains single-plugin recovery
- Work only under `/Users/dev/ABC/pier.worktree/multi-plugin-release`

## File map

| File | Responsibility |
|---|---|
| `.github/workflows/release-plugin.yml` | Multi-target resolve + serial release + single index commit |
| `tests/unit/main/managed-plugin-packaging-governance.test.ts` | Lock workflow contract in source |
| `docs/plugins.md` | Maintainer release procedure |

---

### Task 1: Governance test contract

**Files:**
- Modify: `tests/unit/main/managed-plugin-packaging-governance.test.ts:80-93`
- Test: same file

**Interfaces:**
- Consumes: workflow file text as string
- Produces: assertions that require multi-target markers and forbid the old single-change hard fail

- [ ] **Step 1: Rewrite the automatic-publish governance test**

Replace the test body for `automatically publishes an immutable plugin release after one version change lands on main` with multi-plugin contract checks:

```ts
  it("automatically publishes immutable plugin releases for every package.json change on main", () => {
    expect(releaseWorkflow).toMatch(
      /push:\s+branches:\s+- main\s+paths:\s+- 'packages\/plugin-\*\/package\.json'/
    );
    expect(releaseWorkflow).toContain(
      "expected at least one changed plugin package.json"
    );
    expect(releaseWorkflow).not.toContain(
      "expected exactly one changed plugin package.json"
    );
    expect(releaseWorkflow).toContain("release_targets");
    expect(releaseWorkflow).toContain("sorted by tail");
    expect(releaseWorkflow).toContain("same-version hash drift");
    expect(releaseWorkflow).toContain("Check existing release");
    expect(releaseWorkflow).toContain("Verify existing release asset is immutable");
    // single index regeneration after the serial loop
    expect(releaseWorkflow).toContain("pnpm plugins:index");
    expect(releaseWorkflow).toContain(
      "chore(plugins): update index for"
    );
  });
```

Also keep the Ed25519 signing test unchanged.

- [ ] **Step 2: Run test to verify it fails against current workflow**

Run:

```bash
pnpm exec vitest run tests/unit/main/managed-plugin-packaging-governance.test.ts
```

Expected: FAIL on missing multi-target markers / still containing exactly-one string.

- [ ] **Step 3: Commit test**

```bash
git add tests/unit/main/managed-plugin-packaging-governance.test.ts
git commit -m "test(plugins): require multi-plugin serial release workflow"
```

---

### Task 2: Rewrite release-plugin.yml

**Files:**
- Modify: `.github/workflows/release-plugin.yml`

**Interfaces:**
- Consumes: `github.event.before`, `github.sha`, dispatch inputs, GH token, signing secrets
- Produces: zero or more `plugin-<tail>-v<version>` releases + optional index commit

- [ ] **Step 1: Replace header comment**

```yaml
# Plugin package version changes merged to `main` automatically build every
# changed `packages/plugin-<tail>`, publish each tgz under
# `plugin-<tail>-v<version>` (serially, sorted by tail), then regenerate
# `plugins/index.v1.json` once. `workflow_dispatch` remains available for
# single-plugin recovery.
```

- [ ] **Step 2: Replace Resolve step**

```yaml
      - name: Resolve plugin release targets
        id: parse
        run: |
          set -euo pipefail
          TARGETS='[]'
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            TAIL="${{ github.event.inputs.plugin }}"
            VERSION="${{ github.event.inputs.version }}"
            PACKAGE_JSON="packages/plugin-${TAIL}/package.json"
            ACTUAL_VERSION=$(node -p "require('./${PACKAGE_JSON}').version")
            if [ "$ACTUAL_VERSION" != "$VERSION" ]; then
              echo "requested ${TAIL}@${VERSION}, but ${PACKAGE_JSON} declares ${ACTUAL_VERSION}" >&2
              exit 1
            fi
            TARGETS=$(node -e "
              const t = process.argv[1];
              const v = process.argv[2];
              console.log(JSON.stringify([{
                tail: t,
                version: v,
                tag: \`plugin-\${t}-v\${v}\`,
                package: \`@pier/plugin-\${t}\`,
                packageJson: \`packages/plugin-\${t}/package.json\`,
              }]));
            " "$TAIL" "$VERSION")
          else
            CHANGED=$(git diff --name-only "${{ github.event.before }}" "${{ github.sha }}" -- 'packages/plugin-*/package.json' || true)
            COUNT=$(printf '%s\n' "$CHANGED" | awk 'NF { count++ } END { print count + 0 }')
            if [ "$COUNT" -lt 1 ]; then
              echo "expected at least one changed plugin package.json, found $COUNT" >&2
              printf '%s\n' "$CHANGED" >&2
              exit 1
            fi
            TARGETS=$(printf '%s\n' "$CHANGED" | node -e '
              const fs = require("node:fs");
              const paths = fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
              const targets = paths.map((packageJson) => {
                if (!/^packages\/plugin-[^/]+\/package\.json$/.test(packageJson)) {
                  throw new Error(`unexpected package path: ${packageJson}`);
                }
                const tail = packageJson.slice("packages/plugin-".length, -"/package.json".length);
                const version = JSON.parse(fs.readFileSync(packageJson, "utf8")).version;
                if (typeof version !== "string" || version.length === 0) {
                  throw new Error(`missing version in ${packageJson}`);
                }
                return {
                  tail,
                  version,
                  tag: `plugin-${tail}-v${version}`,
                  package: `@pier/plugin-${tail}`,
                  packageJson,
                };
              });
              targets.sort((a, b) => a.tail.localeCompare(b.tail));
              console.log(JSON.stringify(targets));
            ')
          fi
          echo "release_targets=$TARGETS" >> "$GITHUB_OUTPUT"
          echo "Resolved release targets (sorted by tail):"
          echo "$TARGETS" | node -e 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); for (const x of t) console.log(`- ${x.tag}`);'
          TAGS=$(echo "$TARGETS" | node -e 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(t.map((x)=>x.tag).join(", "));')
          echo "release_tags=$TAGS" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 3: Replace single-plugin build/publish steps with serial loop**

After `pnpm install --frozen-lockfile`, replace Build/Locate/Check/Verify/Publish with one step:

```yaml
      - name: Build, verify, and publish each plugin release
        env:
          GH_TOKEN: ${{ github.token }}
          RELEASE_TARGETS: ${{ steps.parse.outputs.release_targets }}
        run: |
          set -euo pipefail
          echo "$RELEASE_TARGETS" | node -e '
            const fs = require("node:fs");
            const targets = JSON.parse(fs.readFileSync(0, "utf8"));
            if (!Array.isArray(targets) || targets.length === 0) {
              throw new Error("release_targets must be a non-empty array");
            }
            fs.writeFileSync("release-targets.json", JSON.stringify(targets, null, 2));
          '

          while IFS= read -r target; do
            TAIL=$(printf '%s' "$target" | node -e 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(t.tail)')
            VERSION=$(printf '%s' "$target" | node -e 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(t.version)')
            TAG=$(printf '%s' "$target" | node -e 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(t.tag)')
            PACKAGE=$(printf '%s' "$target" | node -e 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(t.package)')

            echo "::group::Release $TAG"
            pnpm --filter "$PACKAGE" run build:package

            DIST="packages/plugin-${TAIL}/dist-pkg"
            TGZ=$(ls "$DIST"/*.tgz | head -1)
            SHA=$(awk '{print $1}' <"$TGZ.sha256")
            SIZE=$(stat -f%z "$TGZ")
            BASENAME=$(basename "$TGZ")

            if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
              echo "Release $TAG already exists; verifying immutable asset"
              WORK="$RUNNER_TEMP/existing-plugin-release-$TAIL"
              rm -rf "$WORK"
              mkdir -p "$WORK"
              gh release download "$TAG" \
                --repo "$GITHUB_REPOSITORY" \
                --pattern "$BASENAME" \
                --dir "$WORK"
              EXISTING_SHA=$(shasum -a 256 "$WORK/$BASENAME" | awk '{print $1}')
              if [ "$EXISTING_SHA" != "$SHA" ]; then
                echo "same-version hash drift for $TAG: release=$EXISTING_SHA local=$SHA" >&2
                exit 1
              fi
              echo "Immutable asset verified for $TAG"
            else
              echo "Creating release $TAG"
              gh release create "$TAG" \
                --repo "$GITHUB_REPOSITORY" \
                --title "$TAG" \
                --notes "$(printf 'Automated plugin release.\n\n- sha256: `%s`\n- size: `%s`\n' "$SHA" "$SIZE")" \
                "$TGZ" \
                "$TGZ.sha256"
            fi
            echo "::endgroup::"
          done < <(node -e '
            const targets = JSON.parse(require("node:fs").readFileSync("release-targets.json", "utf8"));
            for (const t of targets) process.stdout.write(JSON.stringify(t) + "\n");
          ')
```

Notes:
- Prefer `gh release create` over `softprops/action-gh-release` so the loop stays in one shell step.
- Keep failure fail-fast (`set -euo pipefail`).

- [ ] **Step 4: Keep one index regenerate + multi-tag commit message**

```yaml
      - name: Regenerate plugin index
        env:
          PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE: "1"
          PIER_PLUGIN_INDEX_SIGNING_KEY_ID: ${{ secrets.PIER_PLUGIN_INDEX_SIGNING_KEY_ID }}
          PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64: ${{ secrets.PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64 }}
        run: pnpm plugins:index

      - name: Commit index update
        env:
          RELEASE_TAGS: ${{ steps.parse.outputs.release_tags }}
        run: |
          set -euo pipefail
          if git diff --quiet plugins/index.v1.json; then
            echo "index unchanged; skipping commit"
            exit 0
          fi
          git config user.name "pier-plugins-bot"
          git config user.email "bot@runloom.dev"
          git checkout main
          git pull --rebase origin main
          git add plugins/index.v1.json
          git commit -m "chore(plugins): update index for ${RELEASE_TAGS}"
          git push origin main
```

- [ ] **Step 5: Run governance test**

```bash
pnpm exec vitest run tests/unit/main/managed-plugin-packaging-governance.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit workflow**

```bash
git add .github/workflows/release-plugin.yml
git commit -m "ci(plugins): release every changed plugin package serially"
```

---

### Task 3: Docs + final verification

**Files:**
- Modify: `docs/plugins.md` section “发布官方插件”

- [ ] **Step 1: Update release procedure**

Replace steps 3–6 with:

```markdown
3. 可在同一合入中变更多个 `packages/plugin-*/package.json`；release workflow 会按插件 id tail 排序串行发布。
4. `.github/workflows/release-plugin.yml` 为每个变更插件构建并创建/校验 `plugin-<id>-v<version>` GitHub Release。
5. 全部插件发布成功后，同一工作流只重新生成、签名并提交一次 `plugins/index.v1.json`。
6. 索引提交触发 `.github/workflows/publish-index.yml` 发布官方索引。
```

Keep:

```markdown
`workflow_dispatch` 只用于指定官方插件和版本的恢复发布，不是常规发布入口。
```

- [ ] **Step 2: Final test**

```bash
pnpm exec vitest run tests/unit/main/managed-plugin-packaging-governance.test.ts
```

Expected: PASS all 6 tests.

- [ ] **Step 3: Commit docs**

```bash
git add docs/plugins.md
git commit -m "docs(plugins): document multi-plugin serial release"
```

---

## Self-review

1. Spec coverage: multi-target resolve, serial loop, immutability, single index, dispatch recovery, tests, docs — covered.
2. No placeholders.
3. Naming: `release_targets`, `release_tags`, `sorted by tail` markers match governance assertions.
