# Canvas 三轴方法论设计

> 状态：实现中（Phase 0–1）  
> 日期：2026-08-08  
> 入口：系统技能 `pier-canvas`（`/pier-canvas` · `$pier-canvas`）  
> 非目标：CLI 主路径、远程 skill marketplace、多个平行系统 skill

## 1. 目标

Canvas 是 Pier **产品核心总览面**：方案/设计打开后应先看到可扫读的结论与路径，再按需下钻。

`/pier-canvas` 在显式调用时支持三个可选参数（方法论轴），并提供官方默认：

| 参数 | 含义 | 默认 |
|------|------|------|
| `content` | 写什么（章节、门禁、内容模型） | `design-doc` |
| `presentation` | 总览如何组织（导航、绑定、图种） | 由 content 解析：`design-doc`→`decision_nav_4`，`closed-loop`→`primary_nav_5` |
| `ui` | 如何绘制（组件词表、密度、反模式） | `pier-default` |
| `mode` | `methodology`（默认）或 `freeform` | `methodology` |

人话：用户调用 `/pier-canvas`，可选带上 `content=… presentation=…`；未带则用默认；产物是 `.pier/canvases/<slug>/` 下的总览 Canvas + 数据。

## 2. 非目标

- **CLI 主路径**（如 `pier canvas new --content`）。若未来加 CLI，仅为同一协议的薄封装，不作为本设计验收条件。
- 远程 skill 安装 / marketplace。
- 将 content / presentation 拆成多个系统 skill 抢 `/` 发现列表。
- 强制所有 Canvas 走方法论（保留 `mode=freeform` 与 blank 模板）。
- 内建编排器、任务台账。

## 3. 产品定位

| 概念 | 定位 |
|------|------|
| **Canvas** | 产品核心：**方案总览 + 可交互说明面** |
| **`/pier-canvas`** | **唯一官方创作入口**（系统 skill，`disable-model-invocation: true`） |
| **content / presentation / ui** | 调用参数，不是三条 slash 命令 |
| **data.json** | 内容真源（可 restyle 换皮） |
| **instance.json** | pin 三轴 + status + role |

### 总览义务（methodology 模式）

1. 第一屏：BLUF/结论 + 目标/非目标摘要 + ≤1 主图或关键路径。
2. 导航有序且有 **primary**；默认入口 **≤5**。
3. 实现 DAG、竞品长文、过程审查 **不得**作为默认首页。

## 4. 决策：Packs as resources（否决多系统 skill）

### 4.1 采纳

方法论以 **`pier-canvas` 包内资源** 存在：

```text
resources/system-skills/pier-canvas/
  SKILL.md
  packs/
    content/<id>/pack.json
    presentation/<id>/pack.json
    ui/<id>/pack.json
  references/methodology.md
```

项目可覆盖（后做，约定先行）：

```text
.pier/canvas-packs/{content,presentation,ui}/<id>/pack.json
```

解析优先级：**项目 pack > 内置 pack**。未知 id → hard fail，不猜。

### 4.2 否决

| 方案 | 原因 |
|------|------|
| 每方法论一个系统 skill | 发现噪声；入口碎；与唯一 `/pier-canvas` 冲突 |
| 全靠社区 skill 拼装 | 无默认、无总览义务 |
| 宿主硬编码 Reader 代替 canvas | 与 Live Module「项目内 canvas」模型冲突 |

### 4.3 与业界 skill 关系

- ADR / Diátaxis / PRD / Design Doc：内容 **pack 对齐结构**，不注册第二 slash。
- C4 / Mermaid：作为 presentation 图种或后续 pack，不是独立系统 skill。
- frontend-design：可作项目 ui pack；默认 `pier-default`。

## 5. 调用约定（非 shell）

```text
/pier-canvas content=closed-loop presentation=primary_nav_5
  生成/更新方案总览 Canvas

/pier-canvas content=design-doc presentation=one_pager
  一页纸设计总览

/pier-canvas mode=freeform
  自由创作（不读 methodology packs）
```

文档与 skill 正文中的 `content=` **是 skill 调用参数**，不是 `pier` CLI 子命令。

## 6. 契约

### 6.1 instance.json

```json
{
  "schemaVersion": 1,
  "content": "design-doc",
  "presentation": "decision_nav_4",
  "ui": "pier-default",
  "status": "draft",
  "role": "overview"
}
```

### 6.2 pack.json（content）

必填概念字段：`id`、`axis: "content"`、`title`、`required`（字段列表）、`gates`、`agentPrompt`（短指令）。  
可选：`preferredPresentation`（省略 `presentation=` 时的解析目标）。

### 6.3 pack.json（presentation）

必填：`id`、`axis: "presentation"`、`title`、`views[]`（含 `primary`）、`antiPatterns[]`、`requiredContentFields[]`、`agentPrompt`。  
可选：`fitsContent[]`（声明适合哪些 content pack）。

### 6.4 pack.json（ui）

必填：`id`、`axis: "ui"`、`title`、`rules[]`、`forbidden[]`、`agentPrompt`。

### 6.5 默认

```text
content      = design-doc
presentation = resolved (design-doc→decision_nav_4; closed-loop→primary_nav_5)
ui           = pier-default
mode         = methodology
```

闭环 / 运行控制方案：`closed-loop` + `primary_nav_5`（含**首日**配方）。  
设计决策方案：`design-doc` + `decision_nav_4`（无首日 Tab）。

## 7. 工作流（methodology）

1. 解析参数；缺省填默认；校验 pack 存在。
2. 读 content pack → 填/更新 `data.json`（`schemaVersion` + 内容模型）。
3. Content gates（缺必填则停并列出缺项）。
4. 读 presentation pack → 生成/更新总览 `<slug>.canvas.tsx`（只用 `pier/canvas`）。
5. 套用 ui pack 纪律。
6. 写 `instance.json`（`role: overview`）。
7. 跑现有 pier-canvas verification。

`mode=freeform`：跳过 2–5 的 pack 路径，走既有自由创作工作流。

## 8. 兼容矩阵（P0）

| content \\ presentation | decision_nav_4 | primary_nav_5 | one_pager |
|-------------------------|----------------|---------------|-----------|
| design-doc | 默认 | 仅当确有 Day-1 配方 | 允许 |
| closed-loop | 不推荐（缺首日槽） | 默认 | 允许 |
| adr（后续） | 可用 | 否 | 更贴 |

不兼容时 fail 并提示合法组合，不静默降级。

## 9. 验收

- [ ] 规格与 `SKILL.md` 一致：唯一入口 `/pier-canvas`，无 CLI 主叙事
- [ ] 内置 packs：design-doc、closed-loop、decision_nav_4、primary_nav_5、one_pager、pier-default
- [ ] 未传参使用三默认
- [ ] freeform 路径不回归
- [ ] 至少一份狗粮总览：`closed-loop` + `primary_nav_5`，入口 ≤5 且有 BLUF
- [ ] `bundledSystemSkillContributions` 仍只注册 `pier-canvas`

## 10. 实现分期

| 阶段 | 内容 |
|------|------|
| Phase 0 | 本规格 |
| Phase 1 | packs 骨架 + 升级 SKILL.md + methodology.md |
| Phase 2 | 狗粮总览 Canvas |
| Phase 3 | 宿主三轴选择器、项目 canvas-packs 覆盖（可选） |
| Phase 4 | adr / diataxis / recipe_first 等扩展 pack |

## 11. 相关路径

- 系统 skill：`resources/system-skills/pier-canvas/`
- 项目样例：`.pier/canvases/`
- 技能管理（复用，不重做）：`docs/archive/superpowers/specs/2026-07-14-project-skills-management-design.md`

## 12. Canvas 预览内容根（与写作默认分离）

| 角色 | 路径 |
|------|------|
| **写作默认**（`/pier-canvas`） | 仍默认 `.pier/canvases/**`（与预览列表独立，除非用户改 skill 行为） |
| **预览目录列表** | **设置 → 项目 → 常规 → 画布预览目录**；**整表可编辑**（含原默认项） |
| **未配置时** | 工厂初始值：`.pier/canvases`、`docs` |
| **落盘** | `.pier/live-modules.json` → `contentDirectories`（完整列表） |

产品入口是**项目常规设置**。旧字段 `extraContentDirectories` 读取时迁移为「工厂默认 ∪ extras」。禁止任意无配置的 `src/**` 作为 live 入口。
