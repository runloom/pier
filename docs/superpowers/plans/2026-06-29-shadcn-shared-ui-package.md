# shadcn 共享 UI 包 (@pier/ui) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 shadcn primitives 提取成 pnpm workspace 物理包 `@pier/ui`,让 `src/renderer` 和 `src/plugins` 共用同一套组件,且插件不再违反 `plugins ⊥ renderer` 边界。

**Architecture:** 新建 workspace 包 `packages/ui`,以 **TS 源码形式**被消费(electron-vite renderer 用 alias `@pier/ui → packages/ui/src`,vite 直接编译源码,享受 HMR 且 Tailwind 能扫到类名)。物理硬边界由 `packages/ui/package.json` 不声明任何对 app 的依赖保证;depcruise 追加 `packages/ui ⊄ src` 规则双保险。有业务耦合的 `sonner`/`sidebar` 留在 renderer。

**Tech Stack:** pnpm 10 workspace · electron-vite 5 · Vite 8 · Tailwind v4 (`@tailwindcss/vite`,自动内容检测 + `@source`) · TypeScript 6 strict · dependency-cruiser

---

## 背景事实(调研已确认)

- `pnpm-workspace.yaml` 当前只有 `allowBuilds`,无 `packages:` 字段 → 项目是单包。
- `cn`(`src/renderer/utils/index.ts`)零业务依赖,仅 `clsx` + `tailwind-merge`。
- 52 个 primitives 中只有 **2 个有业务耦合**:`sonner.tsx → @/stores/theme.store.ts`、`sidebar.tsx → @/hooks/use-mobile.ts`。这两个**留在 renderer**。
- primitives 内部依赖仅 `@/utils/index.ts`(cn)与彼此互 import。
- Tailwind v4 无 `@config`/`@source` 指令 → `tailwind.config.ts` 的 `content` 数组是 **dead config**,当前靠 v4 自动检测(扫项目根、排除 `node_modules`)。
- renderer 端 alias 在 `electron.vite.config.ts:57-63`;TS paths 唯一来源是根 `tsconfig.json:29-35`。
- 全仓 import primitives 的文件:39 个(13 个是 primitives 互 import,随文件移动;其余 26 个是 renderer 业务 + tests)。
- `@pier/ui` 第三方依赖(根 package.json 已有的精确版本):
  `class-variance-authority ^0.7.1`、`clsx 2.1.1`、`cmdk ^1.1.1`、`embla-carousel-react ^8.6.0`、`input-otp ^1.4.2`、`lucide-react 1.21.0`、`radix-ui ^1.6.0`、`react-resizable-panels ^4.11.2`、`recharts ^3.8.1`、`tailwind-merge 3.6.0`、`vaul ^1.1.2`。peer:`react 19.2.7`、`react-dom 19.2.7`。(`react-day-picker` 根未声明,calendar 需要,Task 5 验证时补装。)

---

## Task 1: 声明 workspace + 建 `@pier/ui` 空包骨架

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/utils.ts`
- Modify: `package.json`(根,加 `@pier/ui` 依赖)

- [ ] **Step 1: 在 `pnpm-workspace.yaml` 顶部加 `packages:`**

```yaml
packages:
  - .
  - packages/*
allowBuilds:
  '@biomejs/biome': true
  '@swc/core': true
  electron: true
  electron-winstaller: true
  esbuild: true
```

- [ ] **Step 2: 创建 `packages/ui/package.json`**

```json
{
  "name": "@pier/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./src/*.tsx",
    "./utils": "./src/utils.ts"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "2.1.1",
    "cmdk": "^1.1.1",
    "embla-carousel-react": "^8.6.0",
    "input-otp": "^1.4.2",
    "lucide-react": "1.21.0",
    "radix-ui": "^1.6.0",
    "react-resizable-panels": "^4.11.2",
    "recharts": "^3.8.1",
    "tailwind-merge": "3.6.0",
    "vaul": "^1.1.2"
  },
  "peerDependencies": {
    "react": "19.2.7",
    "react-dom": "19.2.7"
  }
}
```

- [ ] **Step 3: 创建 `packages/ui/tsconfig.json`(继承根 strict 设置)**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": []
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 4: 创建 `packages/ui/src/utils.ts`(cn 主源)**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: 根 `package.json` 的 `dependencies` 加 `@pier/ui`**

在根 `package.json` 的 `"dependencies"` 中加入(保持 JSON 字母序附近即可):

```json
"@pier/ui": "workspace:*",
```

- [ ] **Step 6: 安装并链接**

Run: `pnpm install`
Expected: 安装成功,生成 `node_modules/@pier/ui` symlink → `packages/ui`。

- [ ] **Step 7: 验证 symlink**

Run: `rtk proxy ls -la node_modules/@pier/ui`
Expected: 输出显示 `node_modules/@pier/ui -> ../packages/ui`(symlink)。

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml packages/ui/package.json packages/ui/tsconfig.json packages/ui/src/utils.ts package.json pnpm-lock.yaml
git commit -m "chore: scaffold @pier/ui workspace package"
```

---

## Task 2: 配置解析链路(alias + tsconfig + tailwind + depcruise)

**Files:**
- Modify: `tsconfig.json:29-35`(paths)
- Modify: `electron.vite.config.ts:57-63`(renderer alias)
- Modify: `src/renderer/app/globals.css:1`(`@source`)
- Modify: `dependency-cruiser.config.cjs`
- Modify: `package.json`(depcruise script 扫 packages)

- [ ] **Step 1: 根 `tsconfig.json` paths 加 `@pier/ui`**

```json
"paths": {
  "@/*": ["./src/renderer/*"],
  "@shared/*": ["./src/shared/*"],
  "@main/*": ["./src/main/*"],
  "@preload/*": ["./src/preload/*"],
  "@plugins/*": ["./src/plugins/*"],
  "@pier/ui/*": ["./packages/ui/src/*"],
  "@pier/ui": ["./packages/ui/src"]
}
```

- [ ] **Step 2: `electron.vite.config.ts` renderer.resolve.alias 加 `@pier/ui`**

把 renderer 段(约 57-63 行)的 alias 改为:

```ts
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "src/renderer"),
        "@shared": resolve(import.meta.dirname, "src/shared"),
        "@plugins": resolve(import.meta.dirname, "src/plugins"),
        "@pier/ui": resolve(import.meta.dirname, "packages/ui/src"),
      },
    },
```

> 说明:alias 指向源码目录,vite 用 react 插件直接编译 `.tsx`;`@pier/ui/button.tsx` → `packages/ui/src/button.tsx`。

- [ ] **Step 3: `globals.css` 顶部加 `@source` 兜底 Tailwind 扫描**

把 `src/renderer/app/globals.css` 第 1 行起改为:

```css
@import "tailwindcss";
@source "../../../../packages/ui/src";
@source "../../../plugins";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
```

> `globals.css` 位于 `src/renderer/app/`,到 `packages/ui/src` 是 `../../../../packages/ui/src`(app→renderer→src→根→packages);到 `src/plugins` 是 `../../../plugins`。显式 `@source` 确保包内与插件内的 className 不被 purge。

- [ ] **Step 4: `dependency-cruiser.config.cjs` 加叶子层规则**

在 `forbidden` 数组中追加(放在 `no-circular` 之前):

```js
    {
      name: "packages-ui-not-import-app",
      severity: "error",
      comment: "共享 UI 包 packages/ui 是叶子层, 不能 import 任何 app 代码 (src)",
      from: { path: "^packages/ui" },
      to: { path: "^src" },
    },
```

- [ ] **Step 5: `package.json` 的 depcruise script 加扫 `packages`**

```json
"depcruise": "depcruise --config dependency-cruiser.config.cjs src packages",
```

- [ ] **Step 6: 验证配置自洽(此时 utils.ts 已存在,可被解析)**

Run: `pnpm typecheck`
Expected: PASS(无 `@pier/ui` 解析错误)。

Run: `pnpm depcruise`
Expected: `no dependency violations found`(packages/ui 目前只有 utils.ts,无违规)。

- [ ] **Step 7: Commit**

```bash
git add tsconfig.json electron.vite.config.ts src/renderer/app/globals.css dependency-cruiser.config.cjs package.json
git commit -m "build: wire @pier/ui alias, tailwind source, depcruise leaf rule"
```

---

## Task 3: 迁移 50 个纯叶子 primitives 到 `packages/ui/src`

**Files:**
- Move: `src/renderer/components/primitives/*.tsx`(除 `sonner.tsx`、`sidebar.tsx`)→ `packages/ui/src/`
- Modify: 被移动文件的内部 import 路径

- [ ] **Step 1: git mv 全部纯叶子组件(保留 sonner/sidebar)**

```bash
cd /Users/dev/ABC/pier
for f in src/renderer/components/primitives/*.tsx; do
  base=$(basename "$f")
  if [ "$base" != "sonner.tsx" ] && [ "$base" != "sidebar.tsx" ]; then
    git mv "$f" "packages/ui/src/$base"
  fi
done
```

- [ ] **Step 2: 改写包内部 import(cn 与互相引用 → 相对路径)**

```bash
sed -i '' \
  -e 's|@/utils/index.ts|./utils.ts|g' \
  -e 's|@/components/primitives/|./|g' \
  packages/ui/src/*.tsx
```

- [ ] **Step 3: 确认包内无残留 `@/` 引用**

Run: `grep -rn '@/' packages/ui/src/ || echo "CLEAN"`
Expected: `CLEAN`(包内不再引用任何 renderer 路径)。

- [ ] **Step 4: typecheck(此时 renderer 旧 import 会断,预期失败)**

Run: `pnpm typecheck`
Expected: FAIL,报 `src/renderer/...` 找不到 `@/components/primitives/X`(Task 4/5 修复)。这一步只确认包内自身无类型错误——失败信息应集中在 renderer 引用方,而非 `packages/ui/src` 内部。

- [ ] **Step 5: Commit(WIP,允许此刻 typecheck 红)**

```bash
git add -A
git commit -m "refactor: move leaf primitives into @pier/ui (imports pending)"
```

---

## Task 4: 修复 renderer 内 cn 单源 + sidebar/sonner 适配

**Files:**
- Modify: `src/renderer/utils/index.ts`
- Modify: `src/renderer/components/primitives/sidebar.tsx`
- Modify: `src/renderer/components/primitives/sonner.tsx`

- [ ] **Step 1: `src/renderer/utils/index.ts` 改为 re-export(cn 单一主源在包内)**

```ts
export { cn } from "@pier/ui/utils";
```

> renderer 业务大量 `import { cn } from "@/utils/index.ts"` 无需改动,继续可用。

- [ ] **Step 2: `sidebar.tsx` 的 primitives import 改指 `@pier/ui`**

把 `src/renderer/components/primitives/sidebar.tsx` 中这几行:

```ts
import { Button } from "@/components/primitives/button.tsx";
import { Input } from "@/components/primitives/input.tsx";
import { Separator } from "@/components/primitives/separator.tsx";
import { Skeleton } from "@/components/primitives/skeleton.tsx";
```

改为:

```ts
import { Button } from "@pier/ui/button.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
```

> `sidebar.tsx` 继续保留 `@/hooks/use-mobile.ts` 与 `@/utils/index.ts`(它留在 renderer,renderer→@pier/ui 合法)。注意若该文件还有 `Sheet`/`Tooltip` 等其它 primitives import,一并按同规则改成 `@pier/ui/<name>.tsx`。

- [ ] **Step 3: `sonner.tsx` 无需改 primitives import(它只依赖 sonner 包 + theme.store)**

确认 `src/renderer/components/primitives/sonner.tsx` 不 import 其它 primitives;保持 `@/stores/theme.store.ts` 不变。无改动则跳过。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/utils/index.ts src/renderer/components/primitives/sidebar.tsx src/renderer/components/primitives/sonner.tsx
git commit -m "refactor: point cn single-source and sidebar primitives at @pier/ui"
```

---

## Task 5: 批量改写 renderer 业务 + tests 的 primitives import

**Files:**
- Modify: 所有仍 import `@/components/primitives/<moved>` 的 renderer 业务与 tests 文件(约 26 个)

- [ ] **Step 1: 列出待改文件**

```bash
grep -rln '@/components/primitives/' src tests --include='*.ts' --include='*.tsx'
```

Expected: 一组文件(不含已迁移的包内文件;`sidebar.tsx`/`sonner.tsx` 已在 Task 4 处理或本就指向 `@pier/ui`)。

- [ ] **Step 2: 批量把 `@/components/primitives/` 改成 `@pier/ui/`**

```bash
grep -rln '@/components/primitives/' src tests --include='*.ts' --include='*.tsx' \
  | xargs sed -i '' 's|@/components/primitives/|@pier/ui/|g'
```

> 注意:`sidebar.tsx`/`sonner.tsx` 这两个**未迁移**的文件仍位于 `src/renderer/components/primitives/`,其自身路径不受影响;它们对**其它** primitives 的 import 已在 Task 4 改好。本 sed 只改 import 字符串,会把任何剩余 `@/components/primitives/sidebar.tsx` 之类的**引用**改成 `@pier/ui/sidebar.tsx` —— 但 sidebar/sonner 未迁移,这会断。下一步修正。

- [ ] **Step 3: 修正对未迁移组件(sidebar/sonner)的引用**

```bash
grep -rln '@pier/ui/sidebar.tsx\|@pier/ui/sonner.tsx' src tests --include='*.ts' --include='*.tsx' \
  | xargs sed -i '' \
    -e 's|@pier/ui/sidebar.tsx|@/components/primitives/sidebar.tsx|g' \
    -e 's|@pier/ui/sonner.tsx|@/components/primitives/sonner.tsx|g' 2>/dev/null || echo "none"
```

Expected: `none` 或修正若干引用(sidebar/sonner 仍从 renderer 本地路径引入)。

- [ ] **Step 4: typecheck,补装缺失第三方(如 calendar 的 react-day-picker)**

Run: `pnpm typecheck`

若报 `Cannot find module 'react-day-picker'`(或其它包内组件的第三方依赖缺失),对每个缺失包执行:

```bash
pnpm --filter @pier/ui add react-day-picker
```

然后重跑 `pnpm typecheck` 直到 PASS。
Expected(最终): PASS。

- [ ] **Step 5: depcruise 确认边界**

Run: `pnpm depcruise`
Expected: `no dependency violations found`(renderer→@pier/ui 合法;packages/ui 不 import src)。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: repoint app imports to @pier/ui"
```

---

## Task 6: 更新 shadcn `components.json` 指向新包

**Files:**
- Modify: `components.json`

- [ ] **Step 1: 把 `aliases.ui` 指向 `@pier/ui`,`utils` 指向包内 utils**

```json
  "aliases": {
    "components": "@/components",
    "utils": "@pier/ui/utils",
    "ui": "@pier/ui",
    "lib": "@pier/ui/utils",
    "hooks": "@/hooks"
  },
```

> 这样后续 `pnpm dlx shadcn add <x>` 会把新组件落到 `@pier/ui`(packages/ui/src)。

- [ ] **Step 2: Commit**

```bash
git add components.json
git commit -m "chore: point shadcn cli aliases at @pier/ui"
```

---

## Task 7: worktree 插件改用 `@pier/ui` 的 Button(最终目标)

**Files:**
- Modify: `src/plugins/builtin/worktree/renderer/worktree-status-item.tsx`
- Test: `tests/unit/renderer/worktree-plugin.test.tsx`

- [ ] **Step 1: 改 import 为 `@pier/ui`**

把 `src/plugins/builtin/worktree/renderer/worktree-status-item.tsx` 第 7 行:

```ts
import { Button } from "@/components/primitives/button.tsx";
```

改为:

```ts
import { Button } from "@pier/ui/button.tsx";
```

(JSX 用法保持现状:`<Button size="xs" variant="outline" className="h-6">…</Button>`。)

- [ ] **Step 2: depcruise 确认插件不再违边界**

Run: `pnpm depcruise`
Expected: `no dependency violations found`。关键:`plugins-not-import-host-implementations`(plugins ⊄ src/renderer)**通过**,因为 import 目标是 `packages/ui` 而非 `src/renderer`。

- [ ] **Step 3: 跑 worktree 与状态栏单测**

Run: `npx vitest run tests/unit/renderer/worktree-plugin.test.tsx tests/unit/renderer/terminal-status-items.test.tsx`
Expected: 全部 PASS(`worktree renderer 插件只通过 plugin host API 访问宿主能力` 用例校验的是不含 `../../../../renderer/...` 相对路径,`@pier/ui` 不触发它)。

- [ ] **Step 4: Commit**

```bash
git add src/plugins/builtin/worktree/renderer/worktree-status-item.tsx
git commit -m "feat: worktree status item uses shared @pier/ui Button"
```

---

## Task 8: 全量验证(typecheck + lint + depcruise + 测试 + 构建)

**Files:** 无(纯验证)

- [ ] **Step 1: 完整静态检查**

Run: `pnpm check`
Expected: typecheck + lint + depcruise + file-size 全 PASS。
(若 lint 因 Biome 在本机 OOM 无法运行,单独记录,不视为代码问题。)

- [ ] **Step 2: 单元 + 组件测试**

Run: `pnpm test:unit`
Expected: 全 PASS(已知 pre-existing 失败:`dockview-drag-css` 的 `min-width:14px`、`terminal-panel-lifecycle` 的「keeps Web keyboard ownership」搜索栏超时——与本次无关)。

- [ ] **Step 3: 生产构建(关键:验证 Tailwind 类未被 purge、@pier/ui 源码编译进 bundle)**

Run: `pnpm build`
Expected: `electron-vite build` 成功;renderer chunk 中包含 `@pier/ui` 组件代码。

- [ ] **Step 4: dev 冒烟(人工)**

Run: `pnpm dev`
人工确认:终端面板底部状态栏的 worktree 项(`<Button>` outline 描边)正常显示且样式未丢;点击仍打开命令面板 quick pick。

- [ ] **Step 5: Final commit(如有验证期微调)**

```bash
git add -A
git commit -m "test: verify @pier/ui shared package end-to-end"
```

---

## Self-Review 结论

- **Spec 覆盖**:workspace 声明(T1)、解析链路 alias/tsconfig/tailwind/depcruise(T2)、组件迁移(T3)、cn 单源 + 业务耦合件处理(T4)、引用改写(T5)、shadcn CLI(T6)、插件用例(T7)、全验证(T8)——均有任务。
- **类型/命名一致**:`@pier/ui/<name>.tsx` 子路径形式贯穿 T2/T4/T5/T7;cn 主源 `packages/ui/src/utils.ts`,re-export 出口 `src/renderer/utils/index.ts`,一致。
- **已知风险点(已在步骤内处理)**:① `react-day-picker` 根未声明 → T5S4 条件补装;② sidebar/sonner 未迁移导致 sed 误伤 → T5S3 修正;③ Tailwind purge → T2S3 显式 `@source` + T8S3 构建验证。
- **边界**:迁移后 `plugins → @pier/ui`(packages)而非 `src/renderer`,`plugins-not-import-host-implementations` 自动满足;新增 `packages-ui-not-import-app` 防止反向依赖。
