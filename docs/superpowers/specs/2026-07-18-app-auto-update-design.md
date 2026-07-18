# Pier 生产自动更新设计

日期：2026-07-18  
状态：已定稿  
范围：macOS 宿主应用自动更新（P0 发布流水线 + P1 客户端检查/下载/入口）

## 1. 背景与目标

仓库已具备主体更新客户端骨架（`electron-updater`、`AppUpdateService`、Settings → Updates、broadcast），以及 mac 打包发布配置（`dmg` + `zip`、`publish.github = runloom/pier`）。缺口是：

1. 没有 App Release CI，用户端检不到稳定的 GitHub Latest 资产。
2. 只有手动检查；无启动/周期检查。
3. `autoDownload = false`，发现更新后仍需手动下载。
4. 无 Settings 以外的可见入口。

本设计补齐「发得出、检得到、下得下、装得上」，并给出右上角入口 + 设置页双通道。

### 1.1 非目标

- Win / Linux 自动更新
- 强制更新 / 最低版本拒跑
- beta / alpha channel、灰度 `stagingPercentage`
- 发行注记富文本页
- 开发态 HMR（`hmrPort` 接入）——独立小修
- 插件更新（继续 managed plugin 官方索引；插件 release 不得占 Latest）

## 2. 业界基线与决策

| 决策 | 选择 | 依据 |
|---|---|---|
| 分发 | 公开 GitHub Latest（`runloom/pier`） | 与现有 `electron-builder.yml` / electron-updater 对齐 |
| mac 产物 | zip 必备（updater）+ dmg（手装） | electron-builder auto-update：Squirrel.Mac 依赖 zip |
| 发布 | tag `v*` → CI `build:dist --publish=always` | 业界默认；本地 publish 仅兜底 |
| 检查 | 启动延迟 + 每 24h + 回前台过期补检 | 对齐 VS Code 类「启动/后台检查」 |
| 下载 | check 发现更新后由 `AppUpdateService` 后台自动下载；adapter 保持 `autoDownload=false` 防双下 | 发现后静默拉包；service 单飞并映射进度 |
| 安装 | 不自动 `quitAndInstall`；用户确认或退出时 `autoInstallOnAppQuit` | 开发者工具有终端/agent，禁止静默杀进程 |
| 入口 | 右上角状态芯片 + Settings → Updates | 产品要求；对齐现有 TitleBar Agent 芯片 |
| Dev | `state: disabled`，不打真网 | 避免 dev 误升、与 electron-vite relaunch 冲突 |

## 3. 架构

```text
tag vX.Y.Z
  → GitHub Actions (macOS)
  → 签名 + 公证 + electron-builder publish
  → GitHub Release Latest
       latest-mac.yml + arm64/x64 zip + dmg
              │
              ▼
   production: electron-updater
              │
   AppUpdateService（单飞状态机 + 调度）
              │ broadcast APP_UPDATE_CHANGED
              ▼
   renderer app-update store
       ├─ TitleBar / 非 mac 顶栏 UpdateControl
       └─ Settings → Updates
```

### 3.1 域边界

- 宿主更新与插件更新分离：插件继续官方索引与 prerelease tag，且必须 `--latest=false`。
- 仅 `runtimeMode === "production"` 且打包运行时启用 updater。
- 现有 IPC / 命令保持：`appUpdate.status|check|download|quitAndInstall` + `pier://app-update:changed`。

### 3.2 状态机

```text
disabled          非 production / 无 updater
idle              初始
checking          检查中
available         已知新版本（自动下载开启后通常很短）
downloading       下载中（带 progress.percent）
downloaded        可安装
not-available     已是最新
error             可重试；不崩溃
```

自动路径：`check` →（有更新）自动下载 → `downloaded`。  
禁止自动 `quitAndInstall`。

## 4. 发布流水线（P0）

### 4.1 触发

- `push` tags：`v*`（主路径）
- `workflow_dispatch`：输入 version/tag（补发、演练）

### 4.2 版本对齐

- tag 去掉 `v` 后必须等于 `package.json` 的 `version`
- CI 第一步校验；不一致直接失败
- 避免 `latest-mac.yml` 与 `app.getVersion()` 不一致导致「永远有更新」或「永远没有」

### 4.3 Job

1. macOS runner
2. 注入签名 / 公证 / GitHub publish 凭证（secrets；名称在实施计划钉死）
3. 复用 `scripts/build-dist.sh --publish=always`，不复制打包逻辑
4. 发布后校验 GitHub Latest 存在 `latest-mac.yml`，且 yml 内路径指向本 release 的 zip

### 4.4 产物

- `latest-mac.yml`（electron-updater 入口）
- arm64 / x64 mac zip（updater 实际下载）
- dmg（手装；可挂同一 Latest）

### 4.5 与插件发布隔离

- `release-plugin.yml` 继续 `--latest=false --prerelease`
- App release 必须成为（或更新）repo Latest
- 验收：`https://github.com/runloom/pier/releases/latest` 可取得 `latest-mac.yml`

### 4.6 失败与重跑

- 构建 / 签名 / 公证失败：不上传残缺 Latest
- 允许对同一 version tag 重跑以修复失败发布
- 成功发布后该 version 二进制语义不可变（修 bug 必须 bump version）

### 4.7 本地兜底

```bash
pnpm build:dist --publish=always
```

运维短文说明：CI 为主、本地为应急；secrets 与 tag 版本对齐要求。

## 5. 客户端（P1）

### 5.1 electron-updater 配置变更

| 项 | 现值 | 目标 |
|---|---|---|
| `autoDownload` | `false` | 保持 `false`（由 service 在 check 后显式 download，避免双下载） |
| `autoInstallOnAppQuit` | 默认 true | 保持 true |
| 调用面 | 仅手动 check/download | 调度器自动 check；service 自动 download |
| `quitAndInstall` | Settings 手动 | Settings 或右上角「重启安装」明确操作 |

`createElectronAppUpdaterAdapter`：

- 懒取 `autoUpdater`（保持，避免测试环境构造崩溃）
- `autoDownload = false`，`autoInstallOnAppQuit = true`
- 订阅 `download-progress` 与错误事件并映射到 service
- 可选接入 main logger，便于现场排障

Service API 保持：`check | download | getStatus | quitAndInstall`。  
`check()` 发现新版本后自动走 `download()`；`download()` 亦可作手动重试。自动路径不调用 `quitAndInstall`。

### 5.2 调度

仅 production：

| 触发 | 行为 |
|---|---|
| 启动 | app ready / 主窗稳定后延迟 30s 首次 `check()` |
| 周期 | 每 24h |
| 回前台 | 窗口 focus 且距上次 check ≥ 24h → 补一次 |
| 手动 | Settings / 芯片相关操作 → 立即 check |

约束：

- check / download 单飞；in-flight 复用同一 Promise
- 自动路径绝不 `quitAndInstall`
- 错误写入 snapshot `error`，不抛到 uncaught；按间隔重试

### 5.3 可选契约扩展

现有 `AppUpdateSnapshot` 足够落地。若实施需要，可增加可选字段：

- `lastCheckedAt?: number`（调试与 UI）

非必须，不阻塞主路径。

## 6. UI

### 6.1 右上角 `UpdateControl`

位置：mac `TitleBar` 与非 mac `AgentIndexChromeBar` 右侧槽，与 `AgentIndexCountsControl` 并列。

建议顺序：`[ AgentIndexCounts ] [ UpdateControl ]`，Update 靠最右。

| 状态 | 显示 | 外观 | 点击 |
|---|---|---|---|
| disabled / idle / checking / not-available | 否 | — | — |
| available | 是 | 「更新」或版本号 | 打开 Settings → `updates` |
| downloading | 是 | 进度 % 或 indeterminate | 打开 Settings → `updates` |
| downloaded | 是 | 强调「重启安装」 | 主操作 = `quitAndInstall` |
| error | 是 | warning 点 | 打开 Settings 看错误 / 重试 |

规则：

- `app-no-drag`，高度遵循 28px 交互密度
- 图标按钮有 `aria-label`，文案全部 i18n
- `downloaded` 主色用 `action-accent`，不用 success 绿当普通导航
- 下载中不在芯片触发安装

### 6.2 Settings → Updates

保留完整控制面：

- 当前版本 / 可用版本 / 进度 / 错误
- 检查更新 | 重试下载 | 重启安装
- 与芯片共用 renderer store，状态一致
- 侧栏「更新」在 `available | downloading | downloaded | error` 时显示小圆点

### 6.3 通知策略

- 自动发现更新：不弹窗
- 进入 `downloaded`：同一 `availableVersion` 只 toast 一次；action 为「重启安装」或「查看」
- 自动 check 失败：静默（snapshot error + 芯片）；手动 check 失败：`showAppAlert`
- 手动 check `not-available`：仅页面内文案，不加成功 toast
- 遵守操作反馈规范：有强自然 UI 时不叠 toast；详情错误走 `showAppAlert`

### 6.4 i18n

- `settings.appUpdate.*` 扩展 titlebar / toast / aria
- 禁止硬编码用户可见字符串

## 7. 测试与验收

### 7.1 自动化

- Service：dev disabled；生产 check → 自动下载进度 → downloaded；单飞；`quitAndInstall` 仅 downloaded
- Scheduler：30s / 24h / focus 补检（fake timer）
- `UpdateControl` 可见性矩阵；downloaded 点击 install；其它状态 `openSection("updates")`
- Settings 与 store 同步
- workflow 文件存在且含 tag 触发、`build:dist --publish`
- 治理：插件 release 仍不占 Latest

### 7.2 手工（签过名的包）

1. 发布 `vX.Y.Z` → Latest 有 yml + zip
2. 安装旧版 → 30s 内出现下载 / 芯片
3. 下完 → toast 一次 + 芯片「重启安装」
4. 重启后版本号变更
5. 再 check → not-available
6. 断网 → error 可恢复

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 自动下载抢带宽 | 延迟 30s；仅 production |
| 重启丢掉终端 / agent | 不自动 `quitAndInstall`；退出时 `autoInstallOnAppQuit` |
| Latest 被插件污染 | prerelease 约束 + 测试钉死 |
| 签名 / 公证 CI 复杂 | 复用 `build-dist.sh`；secrets 文档化 |
| 用户从 dmg 直接跑未装进 `/Applications` | 错误可见；运维说明 |

## 9. 实施切片

1. **P0** Release workflow + 版本校验 + 运维短文
2. **P1a** adapter `autoDownload=true` + service 自动下载状态 / 单飞 / 事件补全
3. **P1b** 生产调度器（30s / 24h / focus）
4. **P1c** renderer store + `UpdateControl` + Settings 接线 + 一次 toast
5. **验收** 单测 + 手工 Latest 一轮

## 10. 现状锚点（实施时以仓库为准）

- `src/main/services/app-updates/app-update-service.ts`
- `src/main/services/app-updates/electron-updater-adapter.ts`
- `src/renderer/pages/settings/components/app-update-section.tsx`
- `src/shared/contracts/app-update.ts`
- `electron-builder.yml`（mac zip/dmg + github publish）
- `scripts/build-dist.sh`
- `.github/workflows/release-plugin.yml`（Latest 隔离先例）
- `src/renderer/components/common/title-bar.tsx`
- `src/renderer/components/common/agent-index-counts-control.tsx`
