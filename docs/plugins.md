# Pier 插件开发指南

Pier 的插件体系分两类,分发链完全一致:

- **官方插件** — 住在这个仓库 `packages/plugin-*` 下,官方维护
- **第三方插件** — 独立 GitHub 仓,发自己的 Release + PR 到官方索引

两者的 tgz + sha256 校验 + Pier 运行时加载路径**同一套**,唯一差别是 tgz 托管在哪个 Release。

---

## 架构一览

```
plugin source (packages/plugin-<id>/ 或独立仓)
   │
   ▼  pnpm build:package
plugin-<id>-<version>.tgz + plugin-<id>-<version>.tgz.sha256
   │
   ▼  git tag plugin-<id>-v<version> && git push
GitHub Release  (asset URL 被写入索引)
   │
   ▼  plugins/index.v1.json (Ed25519 签名, sha256 & size 声明)
GitHub Pages  https://runloom.github.io/pier/plugins/index.v1.json
   │
   ▼  Pier 启动异步拉取 → 缓存到 userData
Pier 用户点 Install
   │
   ▼  HTTP GET tgz → sha256 校验 → extract → validate → promote
~/Library/Application Support/pier/plugins/installed/<id>/<version>/
```

Pier 装机时 Resources 里也包一份 tgz 作为**离线兜底** — 官方索引不可达时(首装无网、CI 挂了)用户仍能装。

---

## 官方插件(仓内开发)

### 目录结构

```
packages/
  plugin-<id>/                   # id 如 codex, worktree
    plugin.json                  # manifest (name, description, id, version, 贡献点)
    package.json                 # workspace 包 (@pier/plugin-<id>)
    src/
      main/                      # main 进程代码 (Node ESM)
      renderer/                  # renderer 代码 (React)
      shared/                    # 双端共享
    vite.config.main.ts
    vite.config.renderer.ts
    tsconfig.json
```

### 关键规则

- `plugin.json` 里 `id` 必须唯一(官方用 `pier.<name>`,如 `pier.codex`)
- `name` 会显示给用户,支持中文
- `main` 和 `renderer` 指向 `dist/` 里的 built 文件
- 依赖只允许:`node:*` builtin + `@pier/plugin-api` + **必须 inline 的第三方**(Vite 会 bundle)
- 见 `packages/plugin-codex/` 完整示例

### 开发命令

```bash
pnpm plugin:<id>:build       # 只编源码 (改 UI 快速迭代)
pnpm plugin:<id>:pack        # 编 + 打包 tgz + sha256 (dev 装载需要)
pnpm plugins:pack            # 打包所有官方插件
pnpm plugins:index           # 重新生成 plugins/index.v1.json
pnpm dev                     # 启动 Pier (predev 会自动 pack Codex)
```

**日常改代码**:改完 `pnpm plugin:codex:pack && pnpm dev`,已装的插件会自动重新 extract。

**测试完整安装流程**:
1. Settings > Plugins > 未安装 tab
2. 点 **安装** → toast: `Codex 账户管理 已安装 · v1.0.0`
3. 点 **卸载** → 行跳到未安装 tab → 再点安装重装

### 发布官方版本

```bash
# 1. 更新 packages/plugin-<id>/package.json 和 plugin.json 里的 version
# 2. 提交
git commit -am "release: pier.<id> v1.0.1"

# 3. 打 tag,格式必须是 plugin-<tail>-v<version> (<tail> = id 去掉 pier. 前缀)
git tag plugin-<id>-v1.0.1
git push origin main plugin-<id>-v1.0.1
```

`.github/workflows/release-plugin.yml` 会自动:
1. `pnpm plugin:<id>:pack` 打 tgz
2. 上传到 GitHub Release(tag = `plugin-<id>-v1.0.1`)
3. 重新生成 `plugins/index.v1.json` 并 commit 到 main
4. 触发 `publish-index.yml` 部署到 GitHub Pages

用户下次启动 Pier 就会看到更新提示。

---

## 第三方插件(独立仓开发)

### 建仓

结构和官方插件**完全同构**,建议 clone `packages/plugin-codex/` 作为起点:

```
pier-plugin-<name>/           # 独立 repo,建议命名 pier-plugin-<name>
  plugin.json
  package.json
  src/
  vite.config.main.ts
  vite.config.renderer.ts
  scripts/pack-plugin.mjs     # 复制自 runloom/pier scripts/pack-plugin.mjs
  .github/workflows/release.yml
```

`plugin.json` 里 `id` 用**反向域名**避免冲突:如 `com.acme.super-plugin` 而不是 `super-plugin`。

`package.json`:

```json
{
  "name": "@acme/pier-plugin-super",
  "version": "1.0.0",
  "scripts": {
    "build": "vite build --config vite.config.main.ts && vite build --config vite.config.renderer.ts",
    "package": "node ./scripts/pack-plugin.mjs",
    "build:package": "pnpm build && pnpm package"
  },
  "dependencies": {
    "@pier/plugin-api": "^1.0.0"
  }
}
```

### Release Workflow(`.github/workflows/release.yml`)

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:package
      - id: locate
        run: |
          TGZ=$(ls dist-pkg/*.tgz | head -1)
          echo "tgz=$TGZ" >> "$GITHUB_OUTPUT"
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            ${{ steps.locate.outputs.tgz }}
            ${{ steps.locate.outputs.tgz }}.sha256
```

### 上架流程

1. 在自己仓 `git tag v1.0.0 && git push origin v1.0.0` → GitHub Actions 发 Release
2. 记下 tgz 的 asset URL 和 sha256(可以从 `.sha256` 文件读)
3. Fork `runloom/pier`,改 `plugins/index.v1.json`,加入你的一条:

   ```json
   {
     "plugins": {
       "com.acme.super-plugin": {
         "displayName": "Super Plugin",
         "description": "什么什么功能。",
         "publisher": "Acme",
         "latest": "1.0.0",
         "versions": {
           "1.0.0": {
             "assetUrl": "https://github.com/acme/pier-plugin-super/releases/download/v1.0.0/com.acme.super-plugin-1.0.0.tgz",
             "sha256": "abc...",
             "size": 12345,
             "pier": ">=0.1.0 <0.2.0"
           }
         }
       }
     }
   }
   ```

4. 提 PR。`.github/workflows/verify-index.yml` 会自动:
   - 校验 JSON 结构
   - HTTP GET 你的 URL(必须 200)
   - 下载 tgz 计算 sha256 匹配
   - 比较 size 声明

5. Merge 后 `publish-index.yml` 立即部署,所有 Pier 用户下次启动都能看到你的插件

### 版本更新

同样流程:改代码 → 发新 Release → 提 PR 更新索引(加一条新版本或改 `latest`)。

---

## 打包脚本细节

`scripts/pack-plugin.mjs` 的输出规范:

- **必须包含**:`plugin.json`, `package.json`, `dist/main.js`, `dist/renderer.js`
- **可选包含**:任何 manifest 里 `main`/`renderer` 引用的其他 `dist/**` 文件
- **禁止包含**:`node_modules/`, `src/`, `.git/`, symlinks(runtime 会拒绝)
- **tar 归档规范**:
  - POSIX ustar,不能有绝对路径或 `..` 段
  - 单条目 ≤10MB,总大小 ≤50MB(见 `MANAGED_PLUGIN_PACKAGE_LIMITS`)
  - mtime 归一化到 epoch 保证 reproducible builds

`.sha256` 文件格式:64 位小写 hex,可选跟一个空格 + 文件名(sha256sum 兼容):

```
2c9225842864fa8a7f9c7359f967d2c0255ebf8395ee9a8279519c8319b142ee  pier.codex-1.0.0.tgz
```

---

## 校验矩阵

Pier 运行时对 tgz 执行(见 `src/main/services/managed-plugins/package-validation.ts`):

| 阶段 | 检查 |
|---|---|
| 下载后 | size 声明 = 实际 | sha256 声明 = 实际 |
| 解压前 | 归档 member 路径安全(无绝对/UNC/`..`)|
| 解压前 | 单条目 size ≤ 10MB | 总大小 ≤ 50MB | 深度 ≤16 | 路径长 ≤240 |
| 解压后 | `package.json` 包含 `"type": "module"` |
| 解压后 | `plugin.json` schema 校验 |
| 解压后 | manifest.id / version 匹配声明 |
| 解压后 | main bundle 不含裸 import(除 `node:*` + `@pier/plugin-api`)|
| 解压后 | renderer bundle 不含裸 import(除 `@pier/plugin-api/*`)|
| 解压后 | 双 bundle 都不含 `eval(...)` 或 `new Function(...)` |

任一失败 → 安装拒绝,tgz 被删,状态回滚。

---

## Q&A

**Q: 三方插件能加原生依赖(node addons)吗?**
A: v1 不允许。runtime 拒绝任何非 `node:*` 的 `require`/`import`,除非通过 Vite bundle 内联(纯 JS)。C++ addons 需要独立分发和签名,超出 v1 范围。

**Q: 三方插件能访问文件系统吗?**
A: 能。v1 external plugin 是 trusted code,不是沙箱。设计文档里明确说"边界是纪律,不是安全"。恶意插件能做的和恶意 npm 包一样。所以官方索引对第三方要 code review 才能上架。

**Q: 我不想走官方索引,能不能自建索引?**
A: v1 不支持。runtime 只信任 pinned public key 签名的官方索引 URL。要自建 marketplace,得改 runtime 的 `OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID` + fork Pier。

**Q: 官方索引挂了怎么办?**
A: Pier 用 cache-first snapshot,启动时 async 拉,失败用磁盘缓存。首装无网时 fallback bundled tgz(仅官方插件)。三方插件首装必须有网。

**Q: 怎么调试三方插件?**
A: `context.missionControlWidgets.register()` 等 API 见 `@pier/plugin-api` 类型。DevTools 里 renderer 可用 sourcemap。main 侧插件跑在 Pier 主进程,console.log 走 main process stdout。
