# 项目技能管理 — 手工验证清单

> 对应项目技能管理设计 v9 §9–§11  
> 分支：`skill-management`（同步 `origin/main` 后实现，执行期未提交）  
> 日期：2026-07-19

## 自动化走查（2026-07-20 起）

`node scripts/project-skills/qa-walkthrough.mjs`（先 `pnpm build:electron`）：Playwright 驱动真实
Electron，对着一次性夹具（`/tmp/pier-skills-qa`：含非托管技能的 Git 项目 + 假 HOME 用户全局技能 +
预置环境索引）走完项目列表 → 收编 → 启用/冲突阻断 → 新建模板 → 启用即投影 → 漂移完整性采用 →
删除确认 → 详情/编辑/筛选/空态全流程，产出约 25 张截图（`/tmp/pier-skills-qa/shots/` +
`manifest.json`，附中文注释与 renderer 控制台错误采集），供三路审查（产品逻辑 / UI / 代码）复用。
下面的手工清单继续覆盖自动化不可达的部分（真实 agent 安装发现、跨 profile、系统权限）。

## 前置

- macOS 本机
- `pnpm setup:worktree`（如需要）后 `pnpm dev`
- 准备一个临时 Git 项目目录（可丢弃）
- 可选：已安装 `claude` / `codex` / `opencode` / `cursor` CLI 以便验证发现

## 检查表

### A. 导入与投影

1. [ ] 设置 → **技能** 可见（在「环境」之后）
2. [ ] 选择/打开当前项目 → 进入详情
3. [ ] **从文件夹导入** 本地技能目录（含 `SKILL.md`）
4. [ ] 导入默认**停用**；添加后未出现投影
5. [ ] 打开启用开关后立即提交，`.agents/skills/<id>` 为**相对**符号链接，指向 `../../.pier/skills/library/<id>`
6. [ ] 关闭开关后立即提交，并在 ownership 匹配时删除受管投影链接
7. [ ] 用户级 `~/.agents/skills` / `~/.claude/skills` / `~/.codex/skills` / `~/.cursor/skills` **无** Pier 新增项

### B. 启用即投影与完整性

8. [ ] 模拟新 clone：仅有 `.pier/skills/manifest.json` + `library/**`，清单含 `enabled: true`
9. [ ] apply 或受管启动前 `ensureReady` 自动创建对应投影，不要求任何本机内容状态
10. [ ] 受管启动（Claude/Codex 终端）在投影收敛后继续；不存在「未批准内容」阻断
11. [ ] 修改库内容导致摘要变化后显示完整性漂移；不把旧摘要继续当作当前内容
12. [ ] 点击「采用当前文件」后更新清单摘要；内容未再次变化时漂移消失，已启用技能继续投影

### C. 启动门

13. [ ] 终端启动适用智能体前走 `ManagedAgentLaunchGate`（阻断时不创建可用 PTY 会话）
14. [ ] `ai.generateText`（如 worktree 分支名生成）在未就绪项目返回结构化失败，不静默 spawn
15. [ ] 降级策略：
    - `allowed`：可「仍然启动」
    - `denied`：无「仍然启动」
16. [ ] SPAWN_INTENT 后不自动重放同一 attempt

### D. 冲突与安全

17. [ ] 目标位置已有非托管同名目录/链接时不覆盖、不删除
18. [ ] 手动改写受管 symlink 目标后，应用/修复不认领删除
19. [ ] Claude 适配开启时，OpenCode/Cursor 健康区可出现重复发现提示（有安装时）

### E. 设置 UI

20. [ ] 状态 Alert 在 **Card 内**，无裸 Alert
21. [ ] 编辑器有未保存正文时切换栏目/关闭：`showAppChoice` 为 `size: default` + `intent: destructive`
22. [ ] 删除技能在当前动作内给出破坏性确认；取消不改变磁盘事实
23. [ ] 窄宽布局无横向溢出；文案走 i18n

### F. 自动化回归（开发机）

```bash
pnpm exec vitest run \
  tests/unit/main/project-skills- \
  tests/unit/renderer/project-skills- \
  tests/unit/renderer/settings-dialog-skills \
  tests/unit/main/ai-service-skills-gate.test.ts
```

记录：日期 / 提交基线 / 通过与否 / 失败项。

## 已知限制（v1）

- 不写用户级技能目录
- 不认领/自动迁移既有发现根内容（仅只读复制导入）
- 不对不合作外部写者提供强 CAS；采用最终检查 + 原子发布 + 复核
- 不承诺撤回已进入会话的技能正文

## 结果记录

| 项 | 结果 | 备注 |
| --- | --- | --- |
| 自动化单测 | 待填 | |
| A 导入投影 | 待填 | |
| B 启用与完整性 | 待填 | |
| C 启动门 | 待填 | |
| D 冲突安全 | 待填 | |
| E UI | 待填 | |
