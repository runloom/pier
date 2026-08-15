# 宿主软件清单（Host Catalog）金标准

> 日期：2026-08-14  
> 状态：终态 — detect / lifecycle 是 catalog 投影；唯一 renderer `ensureFresh` 在 host-catalog.store；preload 不再暴露 `agents.detect` / `lifecycle.probe`
> 范围：本机「装了什么、哪一版、能不能更新」的读取与刷新。不含启动 TUI、装插件、下 dmg。

## 1. 金标准

**机器上的软件事实由宿主清单运行时拥有：上次快照立刻画，A/B/C 在 main 后台校正；页面只读镜像；点「打开」走原生命令，不先探测。**

真源在 main，renderer 是镜子，UI 不是调度器。与消息中心、前台活动、工作台刷新策略同一纪律。

### 打开 ≠ 探测

打开智能体 = `prepareLaunch` → 原生 TUI。清单不启动进程，打开路径不跑 Class A/B/C。

## 2. 统一管理面，不统一数据堆

要统一运行时（注册、新鲜度、调度、广播、hydrate）。

禁止：

- 一个 `freshness.json` / `catalog-all.json` 混放 CLI + 插件签名索引 + electron-updater + 账号 token
- `src/main/services/freshness/` 泛型中台
- 设置页 `useEffect` 当全目录网络探测调度器
- 账号凭据迁回宿主

各域继续自己的 L1 文件：

| 域 | 文件 |
| --- | --- |
| agent-cli | `{userData}/agent-inventory.json` |
| managed-plugin | 安装真源 `{userData}/plugins/index.json` + `official-index-cache.json`；上次 UI 快照 `{userData}/managed-plugin-catalog.json` |
| pier-app | `{userData}/app-update-last-check.json`（仅上次检查，不自动下载） |

## 3. 架构

```
renderer host-catalog.store  ← snapshot + pier://host-catalog:changed
   detect / lifecycle 只读投影
                ↑
        HostCatalogRuntime（唯一调度器）
           /        |         \
    AgentCli     Plugin      PierApp
    Provider     Provider    Provider
    detect+probe index+http  app-updates
```

Runtime 只允许 `readPersisted` / `probe*` / `persist`。装软件、跑智能体、下载更新走已有 mutator / launch。

## 4. 三级工作

| 级 | class | 含义 |
| --- | --- | --- |
| A | local | 文件系统 / PATH / index / `app.getVersion()` |
| B | derived | `--version` 等 spawn；仅 agent-cli |
| C | remote | npm/brew / 官方索引 / electron-updater |

`ensureFresh`：TTL 内 no-op；`force` 跳过 TTL。C 过期不得计入「更新全部」。

账号保持 `pier.codex` 私有，合同同构但不注册进宿主 Runtime。

## 5. IPC

- `pier://host-catalog:snapshot`
- `pier://host-catalog:ensureFresh`
- 广播 `pier://host-catalog:changed`（按 domain）

设置打开只 `ensureFresh`。工具栏刷新才 `force`。
