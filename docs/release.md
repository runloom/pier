# Pier 发布总览

Pier 有两条互不混淆的发布通道：

| 通道 | 产物 | 触发 | GitHub Release 形态 | 客户端如何拿到 |
|---|---|---|---|---|
| **宿主应用** | mac dmg / zip + `latest-mac.yml` | tag `v*` 或 `Release App` 手动 | **Latest**（正式 release） | `electron-updater` 读 `/releases/latest` |
| **官方插件** | `pier.<id>-<ver>.tgz` + 签名索引 | `main` 上 `packages/plugin-*/package.json` 变更，或 `Release Plugin` 手动恢复 | **prerelease**，tag 形如 `plugin-codex-v1.3.1`，**不得**占 Latest | 拉官方索引 `index.v1.json` → 按条目下载 tgz |

```text
宿主:  v0.1.2  ──publish──►  GitHub Latest  ──►  electron-updater
插件:  plugin-codex-v1.3.1 ──prerelease──►  plugins/index.v1.json ──►  GitHub Pages ──► Pier 校验安装
```

详细运维分别见：

- 宿主：[`docs/app-release.md`](./app-release.md)
- 插件开发与发布：[`docs/plugins.md`](./plugins.md)

---

## 1. 宿主应用怎么发

### 常规

1. PR 合入 `main`
2. 在 `main` 上把 `package.json` 的 `version` bump 到目标版本（不带 `v`）
3. 打 tag 并推送：

```bash
git tag v0.1.2
git push origin v0.1.2
```

4. Actions **Release App** 自动：校验版本 → 签名公证 → `pnpm build:dist --publish=always` → 上传 Latest

### 验收

```bash
gh api repos/runloom/pier/releases/latest --jq '{tag:.tag_name,assets:[.assets[].name]}'
curl -fsSL https://github.com/runloom/pier/releases/latest/download/latest-mac.yml
```

Latest 必须非 draft，且含 `latest-mac.yml` 与对应 arch 的 mac zip。

### 用户侧

生产包装好后约 30s 检查 → 有更新后台下载 → 右上角 / Settings → Updates → 用户点「重启并安装」（或退出时安装）。

---

## 2. 官方插件怎么发

### 常规（自动）

1. 在 PR 里同时 bump：
   - `packages/plugin-<tail>/package.json` 的 `version`
   - 同目录 `plugin.json` 的 `version`（必须一致）
2. 本地至少跑：

```bash
pnpm plugin:<tail>:pack    # 例如 plugin:codex:pack
pnpm plugins:index         # 可选：预览索引
pnpm check:plugin-index    # 校验索引与资产约定
```

3. PR 合入 `main`，且本次 push 改动了 `packages/plugin-*/package.json`
4. Actions **Release Plugin** 自动：
   1. 解析本次变更的可发布插件（必须有 `plugin.json`；`plugin-api` 等共享包会跳过）
   2. 按 tail 排序串行：`build:package` → 创建/校验 GitHub Release  
      tag：`plugin-<tail>-v<version>`  
      资产：`pier.<id>-<version>.tgz`（及校验信息）  
      **强制** `--latest=false --prerelease`
   3. 全部成功后只重新生成并签名提交一次 `plugins/index.v1.json`
5. 索引提交到 `main` 的 `plugins/**` 触发 **Publish Plugin Index**
6. GitHub Pages 更新：  
   `https://runloom.github.io/pier/plugins/index.v1.json`

### 手动恢复（非日常）

Actions → **Release Plugin** → `workflow_dispatch`：

- `plugin`：id tail，如 `codex`（对应 `pier.codex`）
- `version`：必须等于该包 `package.json` 当前 version

### 客户端如何装/更

```text
Pier 启动/检查更新
  → 拉官方索引（Ed25519 签名 + sequence 防回滚）
  → 比对已装版本
  → 下载 allowlist 内 GitHub Release tgz
  → size/sha256/解压/bundle 校验
  → 原子装到 {userData}/plugins/installed/<id>/<version>/
  → 多数变更 next-start 生效（pending restart）
```

生产忽略 `PIER_OFFICIAL_PLUGIN_INDEX_URL` 和本地 dev override。

---

## 3. 为什么必须拆两条通道

| 风险 | 规则 |
|---|---|
| 插件 tag 变成 Latest | electron-updater 会去插件 release 找 `latest-mac.yml`，宿主更新全挂 |
| 宿主 release 做成 draft | `/releases/latest` 404，客户端检不到包 |
| 同 version 改二进制 | 索引/更新元数据按不可变版本；修 bug 必须 bump |
| 未签名索引 | 客户端拒绝；不会覆盖磁盘最近有效缓存 |

---

## 4. 维护者速查

### 只发宿主

```bash
# main 上 version=0.1.2 后
git tag v0.1.2 && git push origin v0.1.2
```

### 只发插件（例：codex）

```bash
# 改 packages/plugin-codex/{package.json,plugin.json} version
pnpm plugin:codex:pack
# PR 合入 main → Release Plugin 自动跑
```

### 同一次合入多插件

可以；workflow 按 tail 串行发布，最后只写一次索引。

### 本地应急发宿主

```bash
export GH_TOKEN="$(gh auth token)"
pnpm build:dist --publish=always
# CSC_LINK 路径还需：PIER_DIST_ALLOW_CSC_LINK_PUBLISH=1
```

### 本地应急验插件索引

```bash
pnpm plugins:pack
pnpm plugins:index
pnpm check:plugin-index
```

索引签名密钥与 Pages 部署权限只在官方 CI/维护者环境，不是第三方上架入口。

---

## 5. 文档地图

| 文档 | 内容 |
|---|---|
| **本文** | 双通道总览、边界、速查 |
| [`app-release.md`](./app-release.md) | 宿主 tag/CI/secrets/本地兜底/客户端行为 |
| [`plugins.md`](./plugins.md) | 插件范围、开发、打包校验、索引、安装回滚 |
| `docs/superpowers/specs/2026-07-18-app-auto-update-design.md` | 宿主自动更新设计 |
| `docs/superpowers/specs/2026-07-15-multi-plugin-release-design.md` | 多插件自动发布设计 |

---

## 6. 明确不做

- 第三方插件 marketplace / 任意 git/local 安装
- 用户自定义官方索引（生产）
- 用插件 release 充当应用 Latest
- 宿主与插件共用同一套“热更新”语义（宿主可下载安装；插件多为 next-start）
