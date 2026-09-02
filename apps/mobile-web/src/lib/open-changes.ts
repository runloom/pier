/**
 * S2 变更入口统一动作：先请宿主在桌面 show-or-focus 审查面板
 * （git.openReviewPanel，与 PC 状态栏/命令面板同语义），手机随即进入
 * 同一作用域的只读投影。宿主开面板失败（旧配对缺 panel:open、无窗口等）
 * 不阻断手机侧投影——导航本身就是本次点击的主反馈。
 */
import { navigate, type SessionOrigin } from "./routes.ts";
import { getMobileClient } from "./session.ts";

export function openChangesSynced(
  gitRoot: string | null,
  from?: SessionOrigin
): void {
  const origin = from === undefined ? {} : { from };
  if (gitRoot === null) {
    navigate({ page: "changes", ...origin });
    return;
  }
  try {
    getMobileClient()
      .command({ cwd: gitRoot, type: "git.openReviewPanel" })
      .catch((error: unknown) => {
        console.warn("[mobile] open review panel on desktop failed", error);
      });
  } catch (error) {
    console.warn("[mobile] open review panel on desktop failed", error);
  }
  navigate({ page: "changes", cwd: gitRoot, ...origin });
}
