import { createLogger } from "@shared/logger.ts";
import electronUpdater from "electron-updater";
import {
  feedConfigForTarget,
  type HostUpdateTarget,
  resolveHostUpdateTarget,
} from "./candidate-feed.ts";
import type { AppUpdaterAdapter } from "./service.ts";

const log = createLogger("app-updater");

export function createElectronAppUpdaterAdapter(options?: {
  readonly currentVersion?: string;
  /** 每次检查前读取「接收候选版本」偏好；缺省视为关闭。 */
  readonly getReceiveCandidates?: () => Promise<boolean>;
}): AppUpdaterAdapter {
  // electron-updater 的 autoUpdater 是 getter，取值即构造 MacUpdater 并读取
  // electron app 信息——必须推迟到工厂调用时（仅 production 走到这里），
  // 否则任何 import 链在测试环境都会因 app 未就绪而崩。
  const { autoUpdater } = electronUpdater;
  // Service owns post-check download (single-flight + progress mapping).
  // Keep autoDownload false so checkForUpdates does not start a second download.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // electron-updater 构造期对 rc 运行版本会自动 allowPrerelease=true
  // （AppUpdater 构造函数 hasPrereleaseComponents(currentVersion)）：GitHub
  // provider 会沿 rc channel 扫 Atom feed——跳过晋升后的稳定版、关闭候选开关
  // 也退不回 Latest。候选一律由 candidate-feed 自行解析，这里必须永远关闭。
  autoUpdater.allowPrerelease = false;
  // 打包版没有 devtools console：updater 日志转发进结构化 logger，
  // 更新失败才能落盘排查。
  autoUpdater.logger = {
    debug: (message: string) => log.debug(message),
    error: (message: unknown) => log.error(String(message)),
    info: (message: unknown) => log.info(String(message)),
    warn: (message: unknown) => log.warn(String(message)),
  };

  // 候选 feed 是 per-check 覆盖：一旦切到过 generic，回稳定路径时必须显式
  // 还原为 github provider，否则 updater 会一直钉在旧候选 tag 上。
  let feedOverridden = false;

  async function resolveTarget(): Promise<HostUpdateTarget> {
    let wantCandidates = false;
    try {
      wantCandidates = (await options?.getReceiveCandidates?.()) ?? false;
    } catch (err) {
      log.warn(`read candidate preference failed: ${String(err)}`);
    }
    if (!wantCandidates) {
      return { kind: "latest" };
    }
    try {
      return await resolveHostUpdateTarget({
        currentVersion:
          options?.currentVersion ?? autoUpdater.currentVersion.version,
      });
    } catch (err) {
      // 候选解析失败降级 Latest：稳定通道自身的错误仍由正常检查路径上报。
      log.warn(
        `candidate resolve failed; falling back to Latest: ${String(err)}`
      );
      return { kind: "latest" };
    }
  }

  async function applyFeedTarget(): Promise<void> {
    const target = await resolveTarget();
    if (target.kind === "candidate") {
      autoUpdater.setFeedURL(feedConfigForTarget(target));
      feedOverridden = true;
      log.info(`update feed pinned to candidate ${target.tag}`);
      return;
    }
    if (feedOverridden) {
      autoUpdater.setFeedURL(feedConfigForTarget(target));
      feedOverridden = false;
      log.info("update feed restored to GitHub Latest");
    }
  }

  return {
    checkForUpdates: async () => {
      await applyFeedTarget();
      return autoUpdater.checkForUpdates();
    },
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    on: (event, cb) => {
      autoUpdater.on(event, cb);
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}
